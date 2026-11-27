import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { provedorWhatsapp } from "@/lib/meta";
import { CorpoMuitoGrande, limitarFluxo } from "@/lib/seguranca/corpo-limitado";
import { statusEvolution, telefoneDoJid, tokenWebhookEvolutionOk } from "@/lib/whatsapp/evolution";
import { processarValorWhatsapp, type ValorWhatsapp } from "@/lib/whatsapp/receber";

/**
 * Webhook da Evolution API (instância na VPS). Autenticado pelo segredo
 * EVOLUTION_WEBHOOK_TOKEN, que vai na URL (?token=) e no cabeçalho
 * x-arini-token. Traduz o evento para o formato da Cloud API e segue pelo
 * mesmo caminho da Meta (lib/whatsapp/receber.ts): autosserviço, CRM e status.
 *
 * Eventos usados: MESSAGES_UPSERT (mensagens), MESSAGES_UPDATE (entregue,
 * lida, falhou) e CONNECTION_UPDATE (só registra quando o número cai).
 */

type ChaveEvolution = { id?: string; remoteJid?: string; remoteJidAlt?: string; senderPn?: string; participant?: string; fromMe?: boolean };
type ConteudoEvolution = {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    locationMessage?: { degreesLatitude?: number; degreesLongitude?: number };
    liveLocationMessage?: { degreesLatitude?: number; degreesLongitude?: number };
    buttonsResponseMessage?: { selectedDisplayText?: string };
    listResponseMessage?: { title?: string };
    templateButtonReplyMessage?: { selectedDisplayText?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string; fileName?: string };
    [outro: string]: unknown;
};
type MensagemEvolution = {
  key?: ChaveEvolution;
  pushName?: string;
  messageType?: string;
  messageTimestamp?: number | string | { low?: number };
  message?: ConteudoEvolution;
};
type AtualizacaoEvolution = { keyId?: string; messageId?: string; key?: { id?: string }; status?: string };

const TIPOS: Record<string, string> = {
  imageMessage: "image", videoMessage: "video", audioMessage: "audio", documentMessage: "document",
  documentWithCaptionMessage: "document", stickerMessage: "sticker", contactMessage: "contacts", reactionMessage: "reaction",
};

/**
 * Eventos que o WhatsApp manda como "mensagem" mas que o cliente não escreveu:
 * reação, mensagem apagada/editada (protocolMessage), troca de chaves, voto em
 * enquete, fixar mensagem etc. Antes eles entravam no menu como "[reaction]" ou
 * "[protocolMessage]": disparavam o menu sozinho e contavam como opção errada,
 * até mandar a conversa para a caixa central sem o cliente ter digitado nada
 * (print do Stenio, 27/11/2026).
 */
const IGNORAR = new Set([
  "protocolMessage", "reactionMessage", "encReactionMessage", "senderKeyDistributionMessage", "messageContextInfo",
  "pollUpdateMessage", "encEventResponseMessage", "keepInChatMessage", "pinInChatMessage", "editedMessage",
  "deviceSentMessage", "botInvokeMessage", "callLogMesssage", "callLogMessage", "scheduledCallEditMessage",
  "requestPhoneNumberMessage", "appStateSyncKeyShare", "appStateSyncKeyRequest", "initialSecurityNotificationSettingSync",
  "peerDataOperationRequestMessage", "peerDataOperationRequestResponseMessage", "secretEncryptedMessage",
]);
/** Envelopes que só embrulham a mensagem de verdade (mensagens temporárias, visualização única, documento com legenda). */
const ENVELOPES = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"];

function desembrulhar(m: ConteudoEvolution | undefined): ConteudoEvolution {
  let atual: ConteudoEvolution = m ?? {};
  for (let i = 0; i < 4; i++) {
    const env = ENVELOPES.find((k) => (atual[k] as { message?: ConteudoEvolution } | undefined)?.message);
    if (!env) break;
    atual = (atual[env] as { message: ConteudoEvolution }).message;
  }
  return atual;
}

/** Tipo do conteúdo, ignorando campos de controle que vêm junto (messageContextInfo). */
function tipoDoConteudo(m: ConteudoEvolution, informado?: string) {
  if (informado && !ENVELOPES.includes(informado) && informado !== "messageContextInfo") return informado;
  return Object.keys(m).find((k) => k !== "messageContextInfo" && m[k] != null) ?? informado ?? "";
}

function carimbo(t: MensagemEvolution["messageTimestamp"]) {
  const n = typeof t === "object" && t ? Number(t.low) : Number(t);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n > 1e12 ? n / 1000 : n)) : undefined;
}

/** Uma mensagem da Evolution no formato da Cloud API, ou null para ignorar (grupo, enviada por nós, etc.). */
function traduzirMensagem(d: MensagemEvolution): { msg: NonNullable<ValorWhatsapp["messages"]>[number]; nome: string } | null {
  if (!d?.key?.id || d.key.fromMe) return null;
  const from = telefoneDoJid(d.key);
  if (!from) return null;
  const m = desembrulhar(d.message);
  const tipoBruto = tipoDoConteudo(m, d.messageType);
  // nada que a pessoa escreveu: não grava, não abre conversa, não mexe no menu
  if (!tipoBruto || IGNORAR.has(tipoBruto)) return null;
  const base = { id: d.key.id, from, timestamp: carimbo(d.messageTimestamp) };
  const local = m.locationMessage ?? m.liveLocationMessage;
  let msg: NonNullable<ValorWhatsapp["messages"]>[number];
  if (local && Number.isFinite(local.degreesLatitude) && Number.isFinite(local.degreesLongitude)) {
    msg = { ...base, type: "location", location: { latitude: local.degreesLatitude, longitude: local.degreesLongitude } };
  } else {
    const texto = m.conversation ?? m.extendedTextMessage?.text ?? m.buttonsResponseMessage?.selectedDisplayText
      ?? m.listResponseMessage?.title ?? m.templateButtonReplyMessage?.selectedDisplayText;
    if (typeof texto === "string" && texto.trim()) msg = { ...base, type: "text", text: { body: texto } };
    else {
      const tipo = TIPOS[tipoBruto] ?? (tipoBruto || "unknown");
      const legenda = m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.documentMessage?.caption;
      // mídia com legenda entra no CRM com o texto da legenda; o resto como [tipo], igual à Meta
      msg = legenda ? { ...base, type: tipo, text: { body: legenda } } : { ...base, type: tipo };
    }
  }
  return { msg, nome: d.pushName ?? "" };
}

export async function POST(request: Request) {
  if (!tokenWebhookEvolutionOk(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (provedorWhatsapp() !== "evolution") return NextResponse.json({ ok: true, ignorado: "evolution desligada" });
  const limite = 8 * 1024 * 1024;
  const grande = () => NextResponse.json({ error: "O evento excedeu o limite de tamanho." }, { status: 413 });
  if (Number(request.headers.get("content-length")) > limite) return grande();
  let corpo: string;
  try {
    corpo = await new Response(request.body && limitarFluxo(request.body, limite)).text();
  } catch (e) {
    if (e instanceof CorpoMuitoGrande) return grande();
    throw e;
  }
  let evento: { event?: string; instance?: string; data?: unknown };
  try { evento = JSON.parse(corpo || "{}"); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const tipo = String(evento.event ?? "").toLowerCase().replace(/_/g, ".");
  const instancia = String(evento.instance ?? "");
  const principal = instancia === process.env.EVOLUTION_INSTANCE;
  const cotacoes = !!process.env.EVOLUTION_COTACOES_INSTANCE && instancia === process.env.EVOLUTION_COTACOES_INSTANCE;
  if (!principal && !cotacoes) return NextResponse.json({ ok: true, ignorado: "instância desconhecida" });
  const canal = { id: instancia, principal, cotacoes };
  const itens = (Array.isArray(evento.data) ? evento.data : [evento.data]).filter(Boolean);

  if (tipo === "messages.upsert") {
    const v: ValorWhatsapp = { messages: [], contacts: [] };
    for (const d of itens as MensagemEvolution[]) {
      const t = traduzirMensagem(d);
      if (!t) continue;
      v.messages!.push(t.msg);
      if (t.nome) v.contacts!.push({ wa_id: t.msg.from, profile: { name: t.nome } });
    }
    if (v.messages!.length && !(await processarValorWhatsapp(v, canal))) return NextResponse.json({ ok: false }, { status: 503 });
  } else if (tipo === "messages.update") {
    const statuses: NonNullable<ValorWhatsapp["statuses"]> = [];
    for (const d of itens as AtualizacaoEvolution[]) {
      const id = d.keyId ?? d.key?.id ?? d.messageId;
      const status = statusEvolution(d.status);
      if (typeof id === "string" && id && status) statuses.push({ id, status, ...(status === "failed" ? { errors: [{ title: "Falha informada pela Evolution" }] } : {}) });
    }
    if (statuses.length && !(await processarValorWhatsapp({ statuses }, canal))) return NextResponse.json({ ok: false }, { status: 503 });
  } else if (tipo === "connection.update") {
    const d = itens[0] as { state?: string; statusReason?: number } | undefined;
    if (d?.state === "close") {
      // o número caiu (celular desconectado ou sessão encerrada): vira tarefa para reconectar
      await logAudit({ acao: "whatsapp_desconectado", entidade: "whatsapp", dados_depois: { instancia, motivo: d.statusReason ?? null } }).catch(() => {});
      await supabaseAdmin().rpc("fn_tarefa_automatica", {
        p_chave: `whatsapp_desconectado:${instancia}:${new Date().toISOString().slice(0, 10)}`, p_regra: "whatsapp_desconectado", p_setor: "comercial",
        p_titulo: "WhatsApp da ARINI desconectado",
        p_descricao: `A instância ${instancia} da Evolution saiu do ar. Reconecte em Central > WhatsApp > Conexão (ler o QR Code no celular do número).`,
        p_responsavel: null, p_prazo: new Date().toISOString().slice(0, 10), p_prioridade: "alta",
      });
    }
  }
  return NextResponse.json({ ok: true });
}
