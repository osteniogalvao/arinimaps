import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { temSetor, type Ator } from "@/lib/authz";
import { telefoneWhatsapp } from "@/lib/meta";
import { canalDoContato, contatoSocial, enviarPeloCanal } from "@/lib/meta-mensagens";
import { notificar } from "@/lib/notificacoes";
import type { SetorId } from "@/lib/setores";
import { canalDoContatoRotulo, contatoRotulo, nomeSetor, PERFIL_LABEL } from "@/lib/atendimento-rotulos";
export { canalDoContatoRotulo, contatoRotulo, nomeSetor, PERFIL_LABEL, SETORES_ATENDIMENTO, STATUS_LABEL } from "@/lib/atendimento-rotulos";

/**
 * Atendimento por setores (migration 0156), no molde do CRM da Arini
 * Negócios Imobiliários: um número de WhatsApp, uma conversa por telefone,
 * menu automático que encaminha para a fila do setor, caixa central para o
 * que não foi triado e histórico de cada passo.
 *
 * Regra de acesso (a mesma em toda rota e tela):
 *   diretoria → tudo · recepção → caixa central e tudo que foi triado ·
 *   atendente → fila dos setores em que atua + o que foi atribuído a ele.
 */

export type Conversa = {
  id: string; codigo: string; telefone: string; nome: string | null;
  perfil_user_id: string | null; perfil_tipo: string | null;
  setor: string | null; responsavel: string | null;
  status: "aberta" | "pendente" | "resolvida"; etiquetas: string[];
  opportunity_id: string | null; crm_item_id: string | null;
  nao_lidas: number; ultima_mensagem_em: string; ultima_entrada_em: string | null; ultima_saida_em: string | null;
  ultimo_texto: string | null; triada_em: string | null; resolvida_em: string | null;
  menu_enviado_em: string | null; menu_tentativas: number; menu_respondido_em: string | null;
  created_at: string;
};

export type PapelAtendimento = "administrador" | "recepcao" | "atendente";

export function falta0156(msg: string | undefined) {
  return !!msg && /atendimento_|conversa_id|atendimento_recepcao|42P01|does not exist/.test(msg);
}

export async function papelAtendimento(a: Ator): Promise<PapelAtendimento> {
  if (temSetor(a, "diretoria")) return "administrador";
  const { data } = await supabaseAdmin().from("profiles").select("atendimento_recepcao").eq("user_id", a.userId).maybeSingle();
  return data?.atendimento_recepcao ? "recepcao" : "atendente";
}

export function podeVer(a: Ator, papel: PapelAtendimento, c: Pick<Conversa, "setor" | "responsavel">) {
  if (!a.ehArini) return false;
  if (papel === "administrador" || papel === "recepcao") return true;
  if (c.responsavel === a.userId) return true;
  return !!c.setor && a.setores.includes(c.setor as SetorId);
}

/** Pode tirar da caixa central (triar) e devolver para ela. */
export const podeTriar = (papel: PapelAtendimento) => papel !== "atendente";

export async function eventoAtendimento(e: {
  conversa_id: string; acao: string; texto?: string | null; autor?: string | null;
  de_setor?: string | null; para_setor?: string | null; de_user?: string | null; para_user?: string | null;
}) {
  await supabaseAdmin().from("atendimento_eventos").insert({
    conversa_id: e.conversa_id, acao: e.acao, texto: e.texto ?? null, autor: e.autor ?? null,
    de_setor: e.de_setor ?? null, para_setor: e.para_setor ?? null, de_user: e.de_user ?? null, para_user: e.para_user ?? null,
  });
}

// ---------------------------------------------------------------------------
// Expediente (o mesmo do rodízio: settings rodizio_expediente_*)
// ---------------------------------------------------------------------------
async function dentroDoExpediente(agora = new Date()) {
  const { data } = await supabaseAdmin().from("settings").select("chave, valor")
    .in("chave", ["rodizio_expediente_inicio", "rodizio_expediente_fim", "rodizio_sabado", "rodizio_domingo"]);
  const v = Object.fromEntries((data ?? []).map((l) => [l.chave, l.valor]));
  const hora = (x: unknown, padrao: string) => (typeof x === "string" && /^\d{2}:\d{2}$/.test(x) ? x : padrao);
  const ini = hora(v.rodizio_expediente_inicio, "08:00"), fim = hora(v.rodizio_expediente_fim, "18:00");
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(agora);
  const dia = partes.find((p) => p.type === "weekday")?.value;
  const hm = `${partes.find((p) => p.type === "hour")?.value}:${partes.find((p) => p.type === "minute")?.value}`;
  if (dia === "Sat" && v.rodizio_sabado === false) return false;
  if (dia === "Sun" && v.rodizio_domingo !== true) return false;
  return hm >= ini && hm < fim;
}

// ---------------------------------------------------------------------------
// Menu automático
// ---------------------------------------------------------------------------
type Menu = {
  ativo: boolean; saudacao: string; confirmacao: string; nao_entendi: string; fora_expediente: string;
  max_tentativas: number; setor_escape: string | null; expira_minutos: number; reenviar_apos_horas: number;
};
type Opcao = { id: string; ordem: number; chave: string; rotulo: string; setor: string | null; responsavel: string | null; etiqueta: string | null; confirmacao: string | null; ativo: boolean };

export async function lerMenu() {
  const admin = supabaseAdmin();
  const [m, o] = await Promise.all([
    admin.from("atendimento_menu").select("*").eq("id", 1).maybeSingle(),
    admin.from("atendimento_menu_opcoes").select("*").order("ordem").order("chave"),
  ]);
  return { menu: (m.data as Menu | null) ?? null, opcoes: (o.data as Opcao[] | null) ?? [], erro: m.error?.message ?? o.error?.message };
}

const variaveis = (t: string, nome: string | null, setor?: string | null) =>
  t.replaceAll("{{nome}}", nome ? `, ${nome.split(/\s+/)[0]}` : "").replaceAll("{{setor}}", nomeSetor(setor ?? null));

function textoDoMenu(menu: Menu, opcoes: Opcao[], nome: string | null, cabecalho?: string) {
  const linhas = opcoes.filter((o) => o.ativo).map((o) => `*${o.chave}* - ${o.rotulo}`);
  return `${variaveis(cabecalho ?? menu.saudacao, nome)}\n\n${linhas.join("\n")}`;
}

/** "1", "1.", "opção 1", "1 - comprar" → "1". Só lê a resposta se for curta: frase longa não é escolha de menu. */
function lerEscolha(texto: string, opcoes: Opcao[]) {
  const t = texto.trim().toLowerCase();
  if (!t || t.length > 40) return null;
  const n = t.match(/^(?:op[cç][aã]o\s*)?(\w{1,3})\b/)?.[1];
  return opcoes.find((o) => o.ativo && (o.chave.toLowerCase() === n || o.rotulo.toLowerCase() === t)) ?? null;
}

/** Mensagem enviada pelo robô: entra no histórico da conversa, mas não conta como resposta humana. */
async function enviarDoRobo(c: Pick<Conversa, "id" | "telefone">, texto: string, canal?: string) {
  try {
    const waId = await enviarPeloCanal(c.telefone, texto, canal);
    const linha: Record<string, unknown> = { wa_id: waId || null, telefone: c.telefone, direcao: "saida", texto, conversa_id: c.id, status: "sent" };
    const social = contatoSocial(c.telefone);
    const { error } = await supabaseAdmin().from("whatsapp_mensagens").insert(social ? { ...linha, canal: canalDoContato(c.telefone) } : linha);
    if (error) console.error("atendimento: gravar saída do robô", error.message);
  } catch (e) {
    console.error("atendimento: robô não conseguiu enviar", e instanceof Error ? e.message : e);
  }
}

async function encaminhar(c: Conversa, setor: string | null, responsavel: string | null, acao: string, texto: string, autor: string | null) {
  const mud: Record<string, unknown> = { setor, responsavel, triada_em: setor ? new Date().toISOString() : null };
  await supabaseAdmin().from("atendimento_conversas").update(mud).eq("id", c.id);
  await eventoAtendimento({ conversa_id: c.id, acao, texto, autor, de_setor: c.setor, para_setor: setor, de_user: c.responsavel, para_user: responsavel });
  Object.assign(c, mud);
  if (responsavel && responsavel !== autor) {
    await notificar(responsavel, "atencao", `Atendimento ${c.codigo} com você`, `${c.nome || contatoRotulo(c.telefone)}: ${c.ultimo_texto ?? ""}`.slice(0, 200), `/admin/atendimento?conversa=${c.id}`);
  }
}

// ---------------------------------------------------------------------------
// Reconhecimento pelo telefone
// ---------------------------------------------------------------------------
async function perfilPeloTelefone(telefone: string) {
  const final = telefone.slice(-8);
  const { data } = await supabaseAdmin().from("profiles").select("user_id, nome, role, telefone")
    .ilike("telefone", `%${final.slice(0, 4)}%${final.slice(4)}%`).limit(10);
  return data?.find((p) => telefoneWhatsapp(p.telefone) === telefone) ?? null;
}

function setorDoPerfil(role: string): string | null {
  if (role === "proprietario") return "operacoes";
  if (["corretor", "imobiliaria", "engenheiro", "franqueado", "leiloeiro"].includes(role)) return "comercial";
  return null;
}

// ---------------------------------------------------------------------------
// Entrada: chamada por lib/whatsapp/receber.ts depois de gravar a mensagem
// ---------------------------------------------------------------------------
/**
 * Põe a mensagem recebida na conversa do telefone e decide o caminho:
 * negociação aberta ou perfil conhecido → setor certo; senão, menu.
 * Devolve false quando a migration 0156 ainda não rodou (quem chamou mantém
 * o comportamento antigo).
 */
export async function entradaAtendimento(p: {
  telefone: string; nome: string; texto: string; mensagemId: string;
  opp: { id: string; codigo: string; responsavel_user_id: string | null } | null; canal?: string;
}): Promise<boolean> {
  const admin = supabaseAdmin();
  const agora = new Date().toISOString();
  const social = contatoSocial(p.telefone);
  // conversa das redes (Instagram/Messenger) só existe com a 0157; no WhatsApp a coluna canal fica no padrão
  await admin.from("atendimento_conversas").upsert(
    social ? { telefone: p.telefone, nome: p.nome || null, canal: canalDoContato(p.telefone) } : { telefone: p.telefone, nome: p.nome || null },
    { onConflict: "telefone", ignoreDuplicates: true });
  const { data, error } = await admin.from("atendimento_conversas").select("*").eq("telefone", p.telefone).maybeSingle();
  if (error || !data) {
    if (!falta0156(error?.message)) console.error("atendimento: conversa", error?.message);
    return false;
  }
  const c = data as Conversa;
  await admin.from("whatsapp_mensagens").update({ conversa_id: c.id }).eq("id", p.mensagemId);
  const { menu, opcoes } = await lerMenu();

  // reabre a conversa resolvida; se faz tempo, ela volta para o começo (menu)
  const mud: Record<string, unknown> = {
    nao_lidas: (c.nao_lidas ?? 0) + 1, ultima_mensagem_em: agora, ultima_entrada_em: agora, ultimo_texto: p.texto.slice(0, 300),
  };
  if (!c.nome && p.nome) mud.nome = p.nome.slice(0, 120);
  if (c.status !== "aberta") {
    mud.status = "aberta"; mud.resolvida_em = null;
    const horas = menu?.reenviar_apos_horas ?? 12;
    if (c.status === "resolvida" && c.resolvida_em && Date.now() - Date.parse(c.resolvida_em) > horas * 3_600_000) {
      Object.assign(mud, { setor: null, responsavel: null, triada_em: null, menu_enviado_em: null, menu_respondido_em: null, menu_tentativas: 0 });
    }
    await eventoAtendimento({ conversa_id: c.id, acao: "reabrir", texto: "O cliente voltou a escrever." });
  }
  await admin.from("atendimento_conversas").update(mud).eq("id", c.id);
  Object.assign(c, mud);

  // 1. negociação aberta: vai direto para o Comercial, com o corretor dela
  if (p.opp) {
    if (c.opportunity_id !== p.opp.id || !c.setor) {
      await admin.from("atendimento_conversas").update({ opportunity_id: p.opp.id, perfil_tipo: c.perfil_tipo ?? "negociacao", menu_respondido_em: c.menu_respondido_em ?? agora }).eq("id", c.id);
      c.opportunity_id = p.opp.id;
      if (!c.setor) await encaminhar(c, "comercial", p.opp.responsavel_user_id, "reconhecida", `Cliente da negociação ${p.opp.codigo}: encaminhado ao corretor dela.`, null);
    }
    return true;
  }

  // 2. perfil conhecido pelo telefone (proprietário, corretor parceiro…)
  if (!c.perfil_user_id && !social) {
    const perfil = await perfilPeloTelefone(p.telefone);
    if (perfil) {
      await admin.from("atendimento_conversas").update({ perfil_user_id: perfil.user_id, perfil_tipo: perfil.role, nome: c.nome || perfil.nome }).eq("id", c.id);
      c.perfil_user_id = perfil.user_id; c.perfil_tipo = perfil.role;
      const destino = setorDoPerfil(perfil.role);
      if (destino && !c.setor) {
        await admin.from("atendimento_conversas").update({ menu_respondido_em: agora }).eq("id", c.id);
        await encaminhar(c, destino, null, "reconhecida", `${PERFIL_LABEL[perfil.role] ?? perfil.role} reconhecido pelo telefone: direto para ${nomeSetor(destino)}.`, null);
        return true;
      }
    }
  }

  if (c.setor || c.responsavel) {
    if (c.responsavel) await notificar(c.responsavel, "info", `${canalDoContatoRotulo(c.telefone)} de ${c.nome || contatoRotulo(c.telefone)}`, p.texto.slice(0, 200), `/admin/atendimento?conversa=${c.id}`);
    return true;
  }

  // 3. menu automático
  if (!menu?.ativo || !opcoes.some((o) => o.ativo) || c.menu_respondido_em) return true;
  const aberto = c.menu_enviado_em && Date.now() - Date.parse(c.menu_enviado_em) < menu.expira_minutos * 60_000;
  if (!aberto) {
    await admin.from("atendimento_conversas").update({ menu_enviado_em: agora, menu_tentativas: 0 }).eq("id", c.id);
    await eventoAtendimento({ conversa_id: c.id, acao: "menu", texto: "Menu automático enviado." });
    await enviarDoRobo(c, textoDoMenu(menu, opcoes, c.nome), p.canal);
    return true;
  }
  const escolha = lerEscolha(p.texto, opcoes);
  const foraDoHorario = !(await dentroDoExpediente());
  const confirmar = async (setor: string | null, base: string) => {
    const texto = variaveis(base, c.nome, setor) + (foraDoHorario && menu.fora_expediente ? `\n\n${menu.fora_expediente}` : "");
    await enviarDoRobo(c, texto, p.canal);
  };
  if (escolha) {
    const etiquetas = escolha.etiqueta && !c.etiquetas.includes(escolha.etiqueta) ? [...c.etiquetas, escolha.etiqueta] : c.etiquetas;
    await admin.from("atendimento_conversas").update({ menu_respondido_em: agora, etiquetas }).eq("id", c.id);
    c.etiquetas = etiquetas;
    if (escolha.setor || escolha.responsavel) {
      await encaminhar(c, escolha.setor, escolha.responsavel, "menu", `Cliente escolheu "${escolha.chave} - ${escolha.rotulo}".`, null);
    } else {
      await eventoAtendimento({ conversa_id: c.id, acao: "menu", texto: `Cliente escolheu "${escolha.chave} - ${escolha.rotulo}": fica na caixa central.` });
    }
    await confirmar(escolha.setor, escolha.confirmacao || menu.confirmacao);
    return true;
  }
  const tentativas = (c.menu_tentativas ?? 0) + 1;
  if (tentativas >= menu.max_tentativas) {
    await admin.from("atendimento_conversas").update({ menu_respondido_em: agora, menu_tentativas: tentativas }).eq("id", c.id);
    if (menu.setor_escape) await encaminhar(c, menu.setor_escape, null, "menu", "Sem opção válida no menu: encaminhado ao setor de escape.", null);
    else await eventoAtendimento({ conversa_id: c.id, acao: "menu", texto: "Sem opção válida no menu: ficou na caixa central para triagem." });
    await confirmar(menu.setor_escape, menu.setor_escape ? menu.confirmacao : "Certo! Um atendente vai continuar a conversa por aqui em instantes.");
    return true;
  }
  await admin.from("atendimento_conversas").update({ menu_tentativas: tentativas }).eq("id", c.id);
  await enviarDoRobo(c, textoDoMenu(menu, opcoes, c.nome, menu.nao_entendi), p.canal);
  return true;
}

/**
 * Saída humana (de qualquer tela que responda pelo WhatsApp): liga a mensagem
 * à conversa e zera o relógio de "sem resposta". Nunca lança.
 */
export async function saidaAtendimento(telefone: string, mensagemId: string, texto: string, autor: string) {
  try {
    const admin = supabaseAdmin();
    const { data: c } = await admin.from("atendimento_conversas").select("id, responsavel, setor").eq("telefone", telefone).maybeSingle();
    if (!c) return null;
    const agora = new Date().toISOString();
    await admin.from("whatsapp_mensagens").update({ conversa_id: c.id }).eq("id", mensagemId);
    const mud: Record<string, unknown> = { ultima_saida_em: agora, ultima_mensagem_em: agora, ultimo_texto: texto.slice(0, 300), nao_lidas: 0 };
    if (!c.responsavel) mud.responsavel = autor;
    await admin.from("atendimento_conversas").update(mud).eq("id", c.id);
    if (!c.responsavel) await eventoAtendimento({ conversa_id: c.id, acao: "assumir", autor, para_user: autor, de_setor: c.setor, para_setor: c.setor, texto: "Assumiu ao responder." });
    return c.id as string;
  } catch {
    return null;
  }
}
