import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * WhatsApp pela Evolution API (v2), instância própria na VPS. Liga sozinha
 * quando as variáveis existem e passa a ser o provedor do WhatsApp da ARINI
 * no lugar da Cloud API da Meta (ver provedorWhatsapp em lib/meta.ts).
 *
 *   EVOLUTION_API_URL              endereço da Evolution (ex.: https://evolution.arinibrasil.com.br)
 *   EVOLUTION_API_KEY              chave global (AUTHENTICATION_API_KEY da Evolution)
 *   EVOLUTION_INSTANCE             nome da instância do número principal (ex.: arini)
 *   EVOLUTION_WEBHOOK_TOKEN        segredo do webhook; vai na URL (?token=) e no cabeçalho x-arini-token
 *   EVOLUTION_COTACOES_INSTANCE    opcional: instância do número só de cotações
 *   EVOLUTION_NUMERO               opcional: número da instância, se a Evolution não informar
 *
 * Diferenças da Meta: não há modelo aprovado nem janela de 24 h. Os avisos que
 * na Meta usam modelo vão como texto da ARINI (ver textoModelo em lib/meta.ts).
 */

export class EvolutionErro extends Error {
  constructor(public mensagem: string, public status?: number, public entregaIncerta = false) { super(mensagem); }
}

export const evolutionConfigurada = () =>
  !!process.env.EVOLUTION_API_URL && !!process.env.EVOLUTION_API_KEY && !!process.env.EVOLUTION_INSTANCE;

const base = () => process.env.EVOLUTION_API_URL!.replace(/\/+$/, "");
const instancia = (canal?: string) => canal || process.env.EVOLUTION_INSTANCE!;

async function chamar<T>(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown, prazo = 20_000): Promise<T> {
  const r = await fetch(base() + caminho, {
    method: metodo,
    headers: { apikey: process.env.EVOLUTION_API_KEY!, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(prazo),
    cache: "no-store",
  }).catch(() => null);
  if (!r) throw new EvolutionErro("A Evolution API não respondeu a tempo.", undefined, true);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`Evolution ${metodo} ${caminho} → ${r.status}:`, JSON.stringify(j).slice(0, 400));
    const msg = j?.response?.message ?? j?.message ?? j?.error;
    const texto = Array.isArray(msg) ? msg.map((m: unknown) => (typeof m === "string" ? m : JSON.stringify(m))).join("; ") : msg;
    throw new EvolutionErro(typeof texto === "string" && texto ? texto : `A Evolution recusou (HTTP ${r.status}).`, r.status, r.status >= 500);
  }
  return j as T;
}

type Enviada = { key?: { id?: string } };
function idDaEnviada(j: Enviada) {
  const id = j?.key?.id;
  if (typeof id !== "string" || !id) throw new EvolutionErro("A Evolution não confirmou o envio.", undefined, true);
  return id;
}

export async function evolutionTexto(numero: string, texto: string, canal?: string) {
  return idDaEnviada(await chamar<Enviada>("POST", `/message/sendText/${encodeURIComponent(instancia(canal))}`, {
    number: numero, text: texto.slice(0, 4000),
  }));
}

/** Mídia por link público ou base64 puro. */
export async function evolutionMidia(numero: string, m: { tipo: "image" | "document"; midia: string; mimetype: string; nome?: string; legenda?: string }, canal?: string) {
  return idDaEnviada(await chamar<Enviada>("POST", `/message/sendMedia/${encodeURIComponent(instancia(canal))}`, {
    number: numero, mediatype: m.tipo, mimetype: m.mimetype, media: m.midia,
    caption: m.legenda?.slice(0, 1000), fileName: m.nome,
  }, 40_000));
}

/** Estado da conexão: open (conectado), connecting (aguardando QR) ou close. */
export async function evolutionEstado(canal?: string) {
  const j = await chamar<{ instance?: { state?: string }; state?: string }>("GET", `/instance/connectionState/${encodeURIComponent(instancia(canal))}`, undefined, 8_000);
  return String(j?.instance?.state ?? j?.state ?? "desconhecido");
}

/** Número conectado na instância (só dígitos), ou EVOLUTION_NUMERO. */
export async function evolutionNumero(canal?: string) {
  const fixo = String(process.env.EVOLUTION_NUMERO ?? "").replace(/\D/g, "");
  if (fixo && !canal) return fixo;
  const nome = instancia(canal);
  const j = await chamar<unknown>("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(nome)}`, undefined, 8_000);
  const lista = (Array.isArray(j) ? j : [j]) as Record<string, unknown>[];
  for (const it of lista) {
    const v1 = (it?.instance ?? {}) as Record<string, unknown>;
    if ((it?.name ?? v1.instanceName) !== nome) continue;
    const jid = String(it?.ownerJid ?? v1.owner ?? it?.number ?? "");
    const d = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (d.length >= 10) return d;
  }
  return fixo || null;
}

/** QR Code para conectar o celular (data URL) ou código de pareamento. */
export async function evolutionConectar(canal?: string) {
  const j = await chamar<{ base64?: string; code?: string; pairingCode?: string; instance?: { state?: string } }>(
    "GET", `/instance/connect/${encodeURIComponent(instancia(canal))}`, undefined, 15_000);
  return { qr: typeof j.base64 === "string" ? j.base64 : null, pareamento: j.pairingCode ?? null, estado: j.instance?.state ?? null };
}

export const EVENTOS_WEBHOOK = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"];

export function urlWebhookEvolution(site: string) {
  const u = new URL("/api/webhooks/whatsapp/evolution", site);
  if (process.env.EVOLUTION_WEBHOOK_TOKEN) u.searchParams.set("token", process.env.EVOLUTION_WEBHOOK_TOKEN);
  return u.href;
}

/** Cria a instância (se faltar) e aponta o webhook para a ARINI. */
export async function evolutionPreparar(site: string, canal?: string) {
  const nome = instancia(canal);
  const url = urlWebhookEvolution(site);
  const webhook = {
    enabled: true, url, byEvents: false, base64: false, events: EVENTOS_WEBHOOK,
    headers: { "x-arini-token": process.env.EVOLUTION_WEBHOOK_TOKEN ?? "" },
  };
  let criada = false;
  try {
    await evolutionEstado(nome);
  } catch (e) {
    if (!(e instanceof EvolutionErro) || e.status !== 404) throw e;
    await chamar("POST", "/instance/create", { instanceName: nome, integration: "WHATSAPP-BAILEYS", qrcode: true, webhook }, 30_000);
    criada = true;
  }
  if (!criada) await chamar("POST", `/webhook/set/${encodeURIComponent(nome)}`, { webhook });
  return { instancia: nome, criada, webhook: url.replace(/token=[^&]+/, "token=…") };
}

/** Confere o segredo do webhook (query ?token= ou cabeçalho x-arini-token). */
export function tokenWebhookEvolutionOk(request: Request) {
  const segredo = process.env.EVOLUTION_WEBHOOK_TOKEN;
  if (!segredo || segredo.length < 16) return false;
  const recebido = new URL(request.url).searchParams.get("token") ?? request.headers.get("x-arini-token") ?? "";
  const a = Buffer.from(recebido), b = Buffer.from(segredo);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Telefone do remetente: o JID normal ou, quando o WhatsApp manda LID, o número alternativo. */
export function telefoneDoJid(key: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; participant?: string } | undefined) {
  if (!key?.remoteJid) return null;
  const jid = key.remoteJid;
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return null;
  const candidato = jid.endsWith("@lid") ? (key.senderPn ?? key.remoteJidAlt ?? "") : jid;
  if (!candidato.endsWith("@s.whatsapp.net")) return null;
  const d = candidato.split("@")[0].split(":")[0].replace(/\D/g, "");
  return d.length >= 10 ? d : null;
}

/** Status da Evolution no vocabulário da Meta, que o CRM já usa. */
export function statusEvolution(s: unknown) {
  switch (String(s ?? "").toUpperCase()) {
    case "SERVER_ACK": return "sent";
    case "DELIVERY_ACK": return "delivered";
    case "READ": case "PLAYED": return "read";
    case "ERROR": return "failed";
    default: return null;
  }
}
