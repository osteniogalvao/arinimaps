import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { temSetor, type Ator } from "@/lib/authz";
import { telefoneWhatsapp } from "@/lib/meta";
import { canalDoContato, contatoSocial, enviarPeloCanal } from "@/lib/meta-mensagens";
import { notificar } from "@/lib/notificacoes";
import type { SetorId } from "@/lib/setores";
import { after } from "next/server";
import { ariLigada, buscaClaraDeImovel, codigoNoTexto, pedeHumano, responderComAri } from "@/lib/atendimento-ari";
import { canalDoContatoRotulo, contatoRotulo, nomeSetor, PERFIL_LABEL } from "@/lib/atendimento-rotulos";
import { dentroDoHorario, type HorarioSetor } from "@/lib/atendimento-horario";
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
  // 0170: Ari no WhatsApp (ausentes antes da migration)
  ari_ativa_em?: string | null; ari_dia?: string | null; ari_respostas_dia?: number | null; ari_ultimo_imovel?: string | null;
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

/**
 * A conversa está só com o robô: recebeu o menu e ainda não escolheu, ou está
 * consultando imóveis com a Ari. Ninguém da equipe precisa agir, então ela fica
 * na caixa "Automático" e não na triagem (áudio do Stenio ao Carlos, 25/11/2026:
 * "o CRM não vai ficar bagunçado"; só vai para uma pessoa quando escolhe um setor).
 */
export function naAutomatica(c: Pick<Conversa, "setor" | "responsavel" | "menu_enviado_em" | "menu_respondido_em"> & { ari_ativa_em?: string | null }) {
  if (c.setor || c.responsavel) return false;
  return !!c.ari_ativa_em || (!!c.menu_enviado_em && !c.menu_respondido_em);
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
/** Horário próprio do setor (0171). null = setor sem horário próprio ou migration ausente. */
export async function horarioDoSetor(setor: string | null): Promise<HorarioSetor | null> {
  if (!setor) return null;
  const { data, error } = await supabaseAdmin().from("atendimento_setores_horario")
    .select("setor, dias, inicio, fim, prazo_minutos, mensagem_fora").eq("setor", setor).maybeSingle();
  if (error || !data) return null;
  return { ...data, inicio: String(data.inicio).slice(0, 5), fim: String(data.fim).slice(0, 5) } as HorarioSetor;
}

async function dentroDoExpediente(agora = new Date(), horario?: HorarioSetor | null) {
  if (horario) return dentroDoHorario(horario, agora);
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
/** Mensagem mais velha que isso (fila de reconexão) não recebe menu nem Ari. */
const ATRASO_MAXIMO_MS = 2 * 3_600_000;
type Menu = {
  ativo: boolean; saudacao: string; confirmacao: string; nao_entendi: string; fora_expediente: string;
  max_tentativas: number; setor_escape: string | null; expira_minutos: number; reenviar_apos_horas: number;
  ari_ativo?: boolean; ari_limite_dia?: number;
};
type Opcao = { id: string; ordem: number; chave: string; rotulo: string; setor: string | null; responsavel: string | null; etiqueta: string | null; confirmacao: string | null; ativo: boolean; acao?: "setor" | "ari" };

export async function lerMenu() {
  const admin = supabaseAdmin();
  const [m, o] = await Promise.all([
    admin.from("atendimento_menu").select("*").eq("id", 1).maybeSingle(),
    admin.from("atendimento_menu_opcoes").select("*").order("ordem").order("chave"),
  ]);
  return { menu: (m.data as Menu | null) ?? null, opcoes: (o.data as Opcao[] | null) ?? [], erro: m.error?.message ?? o.error?.message };
}

/** O menu por setores está ligado e tem opção ativa? (sem a 0156: false) */
export async function menuDoAtendimentoAtivo() {
  const { menu, opcoes } = await lerMenu();
  return !!menu?.ativo && opcoes.some((o) => o.ativo);
}

/** "menu", "atendimento", "ajuda", "arini", "opções", "início": o cliente quer ver as opções de novo. */
export function pedeMenu(texto: string) {
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  return /^(menu|atendimento|ajuda|arini|opcoes|opcao|inicio)$/.test(t);
}

const variaveis = (t: string, nome: string | null, setor?: string | null) =>
  t.replaceAll("{{nome}}", nome ? `, ${nome.split(/\s+/)[0]}` : "").replaceAll("{{setor}}", nomeSetor(setor ?? null));

/**
 * Opções que o cliente vê. Duas opções ativas com o mesmo texto (ex.: "0" e "9"
 * com "Falar com a equipe de atendimento", print do Stenio 27/11) aparecem uma
 * vez só, a primeira pela ordem; a tecla da outra continua valendo.
 */
export function opcoesVisiveis<T extends Pick<Opcao, "ativo" | "rotulo">>(opcoes: T[]) {
  const vistos = new Set<string>();
  return opcoes.filter((o) => {
    if (!o.ativo) return false;
    const k = o.rotulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

function textoDoMenu(menu: Menu, opcoes: Opcao[], nome: string | null, cabecalho?: string) {
  const linhas = opcoesVisiveis(opcoes).map((o) => `*${o.chave}* - ${o.rotulo}`);
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

/**
 * Envia o menu. O menu é uma resposta: marca ultima_saida_em para a conversa
 * não virar "sem resposta" (tarefa do worker, relatório) enquanto o cliente não
 * escolhe. Quando ele escolhe, a mensagem dele reabre o relógio no setor.
 */
async function enviarMenu(c: Pick<Conversa, "id" | "telefone">, texto: string, canal?: string) {
  await enviarDoRobo(c, texto, canal);
  await supabaseAdmin().from("atendimento_conversas").update({ ultima_saida_em: new Date().toISOString() }).eq("id", c.id);
}

/**
 * Avisa no sino quem precisa pegar a conversa que entrou sem responsável:
 * as pessoas do setor ou, na caixa central, a recepção (sem recepção marcada,
 * a Diretoria). Antes ninguém era avisado e o cliente ouvia "um atendente vai
 * continuar em instantes" sem ninguém saber que ele estava esperando.
 */
async function avisarFila(c: Conversa, setor: string | null) {
  try {
    const { data } = await supabaseAdmin().from("profiles").select("user_id, role, setores, atendimento_recepcao")
      .in("role", ["admin_central", "analista_arini"]).eq("ativo", true).limit(200);
    const equipe = data ?? [];
    let alvo = setor
      ? equipe.filter((p) => p.role !== "admin_central" && ((p.setores as string[] | null) ?? []).includes(setor))
      : equipe.filter((p) => p.atendimento_recepcao);
    if (!alvo.length) alvo = equipe.filter((p) => p.role === "admin_central" || ((p.setores as string[] | null) ?? []).includes("diretoria"));
    const onde = setor ? nomeSetor(setor) : "caixa central";
    const dia = new Date().toISOString().slice(0, 10);
    await Promise.all(alvo.slice(0, 30).map((p) => notificar(p.user_id as string, "atencao",
      `${canalDoContatoRotulo(c.telefone)} na ${onde}: ${c.nome || contatoRotulo(c.telefone)}`,
      (c.ultimo_texto ?? "").slice(0, 200), `/admin/atendimento?conversa=${c.id}`, `atendimento_fila:${c.id}:${setor ?? "central"}:${dia}`)));
  } catch (e) {
    console.error("atendimento: aviso da fila", e instanceof Error ? e.message : e);
  }
}

async function encaminhar(c: Conversa, setor: string | null, responsavel: string | null, acao: string, texto: string, autor: string | null) {
  const mud: Record<string, unknown> = { setor, responsavel, triada_em: setor ? new Date().toISOString() : null };
  await supabaseAdmin().from("atendimento_conversas").update(mud).eq("id", c.id);
  await eventoAtendimento({ conversa_id: c.id, acao, texto, autor, de_setor: c.setor, para_setor: setor, de_user: c.responsavel, para_user: responsavel });
  Object.assign(c, mud);
  if (responsavel && responsavel !== autor) {
    await notificar(responsavel, "atencao", `Atendimento ${c.codigo} com você`, `${c.nome || contatoRotulo(c.telefone)}: ${c.ultimo_texto ?? ""}`.slice(0, 200), `/admin/atendimento?conversa=${c.id}`);
  } else if (!responsavel && !autor) {
    await avisarFila(c, setor);
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
  /** tipo da mensagem (text, audio, image, sticker…) e quando o cliente enviou */
  tipo?: string; recebidaEm?: string | null;
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
      if (c.ari_ativa_em !== undefined) mud.ari_ativa_em = null;
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

  // mensagem que chegou atrasada (número reconectado, fila do WhatsApp): não
  // responde menu/Ari horas depois; a conversa fica na caixa central para a equipe
  if (p.recebidaEm && Date.now() - Date.parse(p.recebidaEm) > ATRASO_MAXIMO_MS) {
    await eventoAtendimento({ conversa_id: c.id, acao: "menu", texto: "Mensagem chegou com atraso: sem resposta automática, fica para a equipe." });
    return true;
  }

  // 3. conversa com a Ari (consulta de imóveis) até alguém da equipe assumir
  if (c.ari_ativa_em) {
    await conversaComAri(c, p, menu, false);
    return true;
  }

  // 4. menu automático
  if (!menu?.ativo || !opcoes.some((o) => o.ativo)) return true;
  // na caixa central (ninguém assumiu), pedir "menu" mostra as opções de novo, sem contar tentativa
  if (pedeMenu(p.texto)) {
    await admin.from("atendimento_conversas").update({ menu_enviado_em: agora, menu_tentativas: 0, menu_respondido_em: null }).eq("id", c.id);
    Object.assign(c, { menu_enviado_em: agora, menu_tentativas: 0, menu_respondido_em: null });
    await eventoAtendimento({ conversa_id: c.id, acao: "menu", texto: "O cliente pediu o menu: opções enviadas de novo." });
    await enviarMenu(c, textoDoMenu(menu, opcoes, c.nome), p.canal);
    return true;
  }
  if (c.menu_respondido_em) return true;
  const aberto = c.menu_enviado_em && Date.now() - Date.parse(c.menu_enviado_em) < menu.expira_minutos * 60_000;
  // primeira mensagem que já é uma busca clara de imóvel: a Ari responde, sem menu
  if (!aberto && !c.menu_enviado_em && buscaClaraDeImovel(p.texto) && await ariLigada(menu)) {
    await conversaComAri(c, p, menu, true);
    return true;
  }
  if (!aberto) {
    await admin.from("atendimento_conversas").update({ menu_enviado_em: agora, menu_tentativas: 0 }).eq("id", c.id);
    await eventoAtendimento({ conversa_id: c.id, acao: "menu", texto: "Menu automático enviado." });
    await enviarMenu(c, textoDoMenu(menu, opcoes, c.nome), p.canal);
    return true;
  }
  // figurinha e tipo desconhecido com o menu aberto: não é resposta, não conta tentativa
  if (p.tipo && ["sticker", "unknown"].includes(p.tipo)) return true;
  const escolha = lerEscolha(p.texto, opcoes);
  // horário do setor escolhido (0171); sem horário próprio, vale o expediente geral
  const confirmar = async (setor: string | null, base: string) => {
    const horario = await horarioDoSetor(setor);
    const fora = !(await dentroDoExpediente(new Date(), horario));
    const aviso = (horario?.mensagem_fora || menu.fora_expediente || "").trim();
    const texto = variaveis(base, c.nome, setor) + (fora && aviso ? `\n\n${aviso}` : "");
    await enviarDoRobo(c, texto, p.canal);
  };
  if (escolha?.acao === "ari" && await ariLigada(menu)) {
    await conversaComAri(c, p, menu, true, escolha.confirmacao || "Me conte o que você procura: tipo, cidade, tamanho e faixa de valor. Para falar com um corretor, responda *0*.");
    return true;
  }
  // com o menu aberto, uma busca clara em vez do número também vai para a Ari
  if (!escolha && buscaClaraDeImovel(p.texto) && opcoes.some((o) => o.ativo && o.acao === "ari") && await ariLigada(menu)) {
    await conversaComAri(c, p, menu, true);
    return true;
  }
  if (escolha) {
    const etiquetas = escolha.etiqueta && !c.etiquetas.includes(escolha.etiqueta) ? [...c.etiquetas, escolha.etiqueta] : c.etiquetas;
    await admin.from("atendimento_conversas").update({ menu_respondido_em: agora, etiquetas }).eq("id", c.id);
    c.etiquetas = etiquetas;
    if (escolha.setor || escolha.responsavel) {
      await encaminhar(c, escolha.setor, escolha.responsavel, "menu", `Cliente escolheu "${escolha.chave} - ${escolha.rotulo}".`, null);
    } else {
      await eventoAtendimento({ conversa_id: c.id, acao: "menu", texto: `Cliente escolheu "${escolha.chave} - ${escolha.rotulo}": fica na caixa central.` });
      await avisarFila(c, null);
    }
    await confirmar(escolha.setor, escolha.confirmacao || menu.confirmacao);
    return true;
  }
  const tentativas = (c.menu_tentativas ?? 0) + 1;
  if (tentativas >= menu.max_tentativas) {
    await admin.from("atendimento_conversas").update({ menu_respondido_em: agora, menu_tentativas: tentativas }).eq("id", c.id);
    if (menu.setor_escape) await encaminhar(c, menu.setor_escape, null, "menu", `Sem opção válida no menu (última resposta: "${p.texto.slice(0, 80)}"): encaminhado ao setor de escape.`, null);
    else {
      await eventoAtendimento({ conversa_id: c.id, acao: "menu", texto: `Sem opção válida no menu (última resposta: "${p.texto.slice(0, 80)}"): ficou na caixa central para triagem.` });
      await avisarFila(c, null);
    }
    // diz ao cliente por que foi passado adiante, em vez de um "Certo!" solto
    await confirmar(menu.setor_escape, "Não consegui identificar a opção, então passei sua conversa para a nossa equipe. Um atendente continua por aqui assim que possível.");
    return true;
  }
  await admin.from("atendimento_conversas").update({ menu_tentativas: tentativas }).eq("id", c.id);
  await enviarMenu(c, textoDoMenu(menu, opcoes, c.nome, menu.nao_entendi), p.canal);
  return true;
}

/**
 * Conversa com a Ari (0170). `entrando`: marca o início (menu respondido) e,
 * com `boasVindas`, só apresenta a Ari sem chamar a IA. A resposta roda depois
 * do 200 do webhook (after), porque a IA leva alguns segundos.
 */
async function conversaComAri(c: Conversa, p: { texto: string; mensagemId: string; canal?: string }, menu: Menu | null, entrando: boolean, boasVindas?: string) {
  const admin = supabaseAdmin();
  const agora = new Date().toISOString();
  const enviar = (texto: string) => enviarDoRobo(c, texto, p.canal);
  if (entrando) {
    const etiquetas = c.etiquetas.includes("busca-imoveis") ? c.etiquetas : [...c.etiquetas, "busca-imoveis"];
    const { error } = await admin.from("atendimento_conversas").update({ ari_ativa_em: agora, menu_respondido_em: agora, etiquetas }).eq("id", c.id);
    if (error) { console.error("atendimento: ari", error.message); return; }
    Object.assign(c, { ari_ativa_em: agora, menu_respondido_em: agora, etiquetas });
    await eventoAtendimento({ conversa_id: c.id, acao: "automatica", texto: "Ari (IA) começou a atender: consulta de imóveis." });
    if (boasVindas) { await enviar(variaveis(boasVindas, c.nome)); return; }
  } else if (pedeHumano(p.texto)) {
    await passarParaEquipe(c, p, menu, "O cliente pediu para falar com um corretor.");
    return;
  }
  after(async () => {
    const r = await responderComAri(c, p.texto, p.mensagemId, enviar, p.canal, menu?.ari_limite_dia ?? 40)
      .catch(() => "falha" as const);
    if (r === "limite") await passarParaEquipe(c, p, menu, "Limite diário de respostas da Ari atingido.");
    else if (r === "falha") await passarParaEquipe(c, p, menu, "A Ari não conseguiu responder.");
  });
}

/** Sai da Ari para o Comercial; com imóvel de interesse, cria o lead (rodízio). */
async function passarParaEquipe(c: Conversa, p: { texto: string; canal?: string }, menu: Menu | null, motivo: string) {
  const admin = supabaseAdmin();
  await admin.from("atendimento_conversas").update({ ari_ativa_em: null }).eq("id", c.id);
  c.ari_ativa_em = null;
  const codigo = codigoNoTexto(p.texto) ?? c.ari_ultimo_imovel ?? null;
  let lead: { id: string; codigo: string; responsavel: string | null } | null = null;
  if (codigo && !c.opportunity_id && !contatoSocial(c.telefone)) {
    const { data, error } = await admin.rpc("fn_crm_lead_manual", {
      p_autor: null, p_codigo_imovel: codigo, p_nome: c.nome || "Cliente do WhatsApp", p_telefone: "+" + c.telefone, p_email: null,
      p_mensagem: `Conversa com a Ari (WhatsApp). Último pedido: ${p.texto.slice(0, 400)}`, p_origem: "whatsapp", p_temperatura: null,
      p_etiquetas: c.etiquetas, p_responsavel: null, p_rodizio: true,
    });
    if (error) console.error("atendimento: lead da Ari", error.message);
    else lead = data as { id: string; codigo: string; responsavel: string | null };
  }
  if (lead) {
    await admin.from("atendimento_conversas").update({ opportunity_id: lead.id }).eq("id", c.id);
    await admin.from("whatsapp_mensagens").update({ opportunity_id: lead.id }).eq("conversa_id", c.id);
    c.opportunity_id = lead.id;
    await eventoAtendimento({ conversa_id: c.id, acao: "lead", para_setor: "comercial", para_user: lead.responsavel, texto: `Lead criado pela Ari na negociação ${lead.codigo} (rodízio), imóvel ${codigo}.` });
  }
  await encaminhar(c, "comercial", lead?.responsavel ?? null, "automatica", `${motivo}${codigo ? ` Imóvel de interesse: ${codigo}.` : ""}`, null);
  const fora = !(await dentroDoExpediente()) && menu?.fora_expediente ? `\n\n${menu.fora_expediente}` : "";
  await enviarDoRobo(c, `Certo! Vou te passar para um corretor da ARINI${codigo ? ` sobre o imóvel *${codigo}*` : ""}. Ele continua a conversa por aqui.${fora}`, p.canal);
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
