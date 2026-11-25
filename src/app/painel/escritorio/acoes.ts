"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sessaoEscritorio } from "@/lib/crm-escritorio-servidor";
import {
  ETAPAS_NEGOCIO, FINALIDADES, STATUS_COMPROMISSO, STATUS_IMOVEL, TIPOS_COMPROMISSO, TIPOS_IMOVEL, TIPOS_PESSOA,
  UNIDADES_AREA, UUID_ESC,
} from "@/lib/crm-escritorio";

/**
 * Gravações do CRM do escritório. As policies e o gatilho da migration 0173
 * fazem a trava (espaço, autor, responsável da equipe, vínculos do mesmo
 * escritório); aqui só limpamos o formulário e devolvemos o aviso.
 */

const txt = (f: FormData, k: string, max = 240) => {
  const v = String(f.get(k) ?? "").trim();
  return v ? v.slice(0, max) : null;
};
const id = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return UUID_ESC.test(v) ? v : null;
};
const num = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").replace(/\./g, "").replace(",", ".").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const inteiro = (f: FormData, k: string) => {
  const n = num(f, k);
  return n === null ? null : Math.min(99, Math.trunc(n));
};
const um = <T extends Record<string, string>>(f: FormData, k: string, opcoes: T, padrao: keyof T) => {
  const v = String(f.get(k) ?? "");
  return (Object.hasOwn(opcoes, v) ? v : padrao) as string;
};
/** "2026-11-25T14:30" (horário de Brasília) → ISO. */
const quando = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const t = Date.parse(v + ":00-03:00");
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const volta = (f: FormData, padrao: string) => {
  const v = String(f.get("_volta") ?? "");
  return v.startsWith("/painel/escritorio") ? v : padrao;
};
function aviso(destino: string, chave: "ok" | "erro", valor: string) {
  const [base, query = ""] = destino.split("?");
  const q = new URLSearchParams(query);
  q.delete("ok"); q.delete("erro"); q.delete("novo"); q.delete("editar");
  q.set(chave, valor);
  return `${base}?${q}`;
}
function mensagemErro(e: { code?: string; message?: string }) {
  if (e.code === "42501") return "sem_acesso";
  if (e.code === "22023" && e.message?.includes("responsável")) return "responsavel";
  if (e.code === "22023") return "vinculo";
  return "invalido";
}
async function sessao() {
  const s = await sessaoEscritorio();
  if (s.status === 401) redirect("/entrar?volta=/painel/escritorio");
  if (s.status !== 200) redirect("/painel/escritorio");
  return s;
}
function responsavel(f: FormData, membros: { user_id: string }[]) {
  const r = id(f, "responsavel");
  return r && membros.some((m) => m.user_id === r) ? r : undefined;
}

export async function salvarPessoa(f: FormData) {
  const s = await sessao();
  const destino = volta(f, "/painel/escritorio/pessoas");
  const nome = txt(f, "nome", 140);
  if (!nome) redirect(aviso(destino, "erro", "nome"));
  const dados = {
    tipo: um(f, "tipo", TIPOS_PESSOA, "cliente"), nome, telefone: txt(f, "telefone", 40), email: txt(f, "email", 254),
    documento: txt(f, "documento", 30), cidade: txt(f, "cidade", 120), origem: txt(f, "origem", 60),
    observacoes: txt(f, "observacoes", 4000), responsavel: responsavel(f, s.membros),
  };
  const alvo = id(f, "id");
  const { error } = alvo
    ? await s.banco.from("crm_esc_pessoas").update(dados).eq("id", alvo)
    : await s.banco.from("crm_esc_pessoas").insert(dados);
  revalidatePath("/painel/escritorio", "layout");
  redirect(aviso(destino, error ? "erro" : "ok", error ? mensagemErro(error) : "pessoa"));
}

export async function salvarImovel(f: FormData) {
  const s = await sessao();
  const destino = volta(f, "/painel/escritorio/imoveis");
  const titulo = txt(f, "titulo", 180);
  if (!titulo) redirect(aviso(destino, "erro", "titulo"));
  const dados = {
    tipo: um(f, "tipo", TIPOS_IMOVEL, "casa"), finalidade: um(f, "finalidade", FINALIDADES, "venda"), titulo,
    cidade: txt(f, "cidade", 120), bairro: txt(f, "bairro", 120), endereco: txt(f, "endereco", 240),
    link_mapa: txt(f, "link_mapa", 600), valor: num(f, "valor"), area: num(f, "area"),
    area_unidade: um(f, "area_unidade", UNIDADES_AREA, "m2"), quartos: inteiro(f, "quartos"), vagas: inteiro(f, "vagas"),
    proprietario_id: id(f, "proprietario_id"), status: um(f, "status", STATUS_IMOVEL, "captacao"),
    observacoes: txt(f, "observacoes", 4000), responsavel: responsavel(f, s.membros),
  };
  if (dados.link_mapa && !/^https:\/\//i.test(dados.link_mapa)) dados.link_mapa = null;
  const alvo = id(f, "id");
  const { error } = alvo
    ? await s.banco.from("crm_esc_imoveis").update(dados).eq("id", alvo)
    : await s.banco.from("crm_esc_imoveis").insert({ ...dados, codigo: "novo" });
  revalidatePath("/painel/escritorio", "layout");
  redirect(aviso(destino, error ? "erro" : "ok", error ? mensagemErro(error) : "imovel"));
}

export async function salvarNegocio(f: FormData) {
  const s = await sessao();
  const destino = volta(f, "/painel/escritorio");
  let pessoa = id(f, "pessoa_id");
  // atalho do funil: cadastrar o cliente junto com o negócio
  const novoCliente = txt(f, "novo_cliente", 140);
  if (!pessoa && novoCliente) {
    const r = await s.banco.from("crm_esc_pessoas").insert({ nome: novoCliente, tipo: "cliente", telefone: txt(f, "novo_telefone", 40), origem: txt(f, "origem", 60) })
      .select("id").single();
    if (r.error) redirect(aviso(destino, "erro", mensagemErro(r.error)));
    pessoa = r.data.id;
  }
  const titulo = txt(f, "titulo", 180) ?? novoCliente;
  if (!titulo) redirect(aviso(destino, "erro", "titulo"));
  const dados = {
    titulo, etapa: um(f, "etapa", ETAPAS_NEGOCIO, "novo"), pessoa_id: pessoa, imovel_id: id(f, "imovel_id"),
    valor: num(f, "valor"), origem: txt(f, "origem", 60), proxima_acao: txt(f, "proxima_acao", 240),
    proxima_acao_em: quando(f, "proxima_acao_em"), motivo_perda: txt(f, "motivo_perda", 500),
    observacoes: txt(f, "observacoes", 4000), responsavel: responsavel(f, s.membros),
  };
  const alvo = id(f, "id");
  const { error } = alvo
    ? await s.banco.from("crm_esc_negocios").update(dados).eq("id", alvo)
    : await s.banco.from("crm_esc_negocios").insert(dados);
  revalidatePath("/painel/escritorio", "layout");
  redirect(aviso(destino, error ? "erro" : "ok", error ? mensagemErro(error) : "negocio"));
}

/** Botões do funil: muda só a etapa. */
export async function moverNegocio(f: FormData) {
  const s = await sessao();
  const destino = volta(f, "/painel/escritorio");
  const alvo = id(f, "id");
  const etapa = String(f.get("etapa") ?? "");
  if (!alvo || !Object.hasOwn(ETAPAS_NEGOCIO, etapa)) redirect(aviso(destino, "erro", "invalido"));
  const { error } = await s.banco.from("crm_esc_negocios").update({ etapa }).eq("id", alvo);
  revalidatePath("/painel/escritorio", "layout");
  if (error) redirect(aviso(destino, "erro", mensagemErro(error)));
  redirect(destino);
}

export async function salvarCompromisso(f: FormData) {
  const s = await sessao();
  const destino = volta(f, "/painel/escritorio/agenda");
  const titulo = txt(f, "titulo", 180);
  const inicio = quando(f, "inicio");
  if (!titulo || !inicio) redirect(aviso(destino, "erro", "data"));
  let fim = quando(f, "fim");
  if (fim && fim < inicio) fim = null;
  const dados = {
    tipo: um(f, "tipo", TIPOS_COMPROMISSO, "visita"), titulo, inicio, fim, dia_inteiro: f.get("dia_inteiro") === "on",
    local: txt(f, "local", 240), pessoa_id: id(f, "pessoa_id"), imovel_id: id(f, "imovel_id"), negocio_id: id(f, "negocio_id"),
    status: um(f, "status", STATUS_COMPROMISSO, "agendado"), observacoes: txt(f, "observacoes", 2000),
    responsavel: responsavel(f, s.membros),
  };
  const alvo = id(f, "id");
  const { error } = alvo
    ? await s.banco.from("crm_esc_agenda").update(dados).eq("id", alvo)
    : await s.banco.from("crm_esc_agenda").insert(dados);
  revalidatePath("/painel/escritorio", "layout");
  redirect(aviso(destino, error ? "erro" : "ok", error ? mensagemErro(error) : "compromisso"));
}

/** Marcar compromisso como feito/cancelado direto da lista. */
export async function statusCompromisso(f: FormData) {
  const s = await sessao();
  const destino = volta(f, "/painel/escritorio/agenda");
  const alvo = id(f, "id");
  const status = String(f.get("status") ?? "");
  if (!alvo || !Object.hasOwn(STATUS_COMPROMISSO, status)) redirect(aviso(destino, "erro", "invalido"));
  const { error } = await s.banco.from("crm_esc_agenda").update({ status }).eq("id", alvo);
  revalidatePath("/painel/escritorio", "layout");
  if (error) redirect(aviso(destino, "erro", mensagemErro(error)));
  redirect(destino);
}

const TABELAS = { pessoa: "crm_esc_pessoas", imovel: "crm_esc_imoveis", negocio: "crm_esc_negocios", compromisso: "crm_esc_agenda" } as const;

export async function excluirRegistro(f: FormData) {
  const s = await sessao();
  const tipo = String(f.get("tipo") ?? "") as keyof typeof TABELAS;
  const destino = volta(f, "/painel/escritorio");
  const alvo = id(f, "id");
  if (!alvo || !Object.hasOwn(TABELAS, tipo)) redirect(aviso(destino, "erro", "invalido"));
  const { data, error } = await s.banco.from(TABELAS[tipo]).delete().eq("id", alvo).select("id");
  revalidatePath("/painel/escritorio", "layout");
  if (error) redirect(aviso(destino, "erro", mensagemErro(error)));
  redirect(aviso(destino, data?.length ? "ok" : "erro", data?.length ? "excluido" : "excluir"));
}
