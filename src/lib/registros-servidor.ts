import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { temSetor, type Ator } from "@/lib/authz";
import type { Campo, Recurso } from "@/lib/registros";

/**
 * Validação e ações dos cadastros da Central (src/lib/registros.ts).
 * Cada módulo registra as suas ações em ACOES_REGISTRO (ver os arquivos em
 * src/lib/modulos/), e a rota /api/admin/registros/[recurso] só despacha.
 */

export class ErroRegistro extends Error {
  constructor(public mensagem: string, public status = 400) { super(mensagem); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

function valorCampo(c: Campo, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || v === "") {
    if (c.obrigatorio) throw new ErroRegistro(`Preencha "${c.rotulo}".`);
    return c.tipo === "bool" ? false : null;
  }
  switch (c.tipo) {
    case "numero":
    case "dinheiro": {
      const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(n)) throw new ErroRegistro(`"${c.rotulo}" precisa ser um número.`);
      if (c.tipo === "dinheiro" && n < 0) throw new ErroRegistro(`"${c.rotulo}" não pode ser negativo.`);
      return c.tipo === "dinheiro" ? Math.round(n * 100) / 100 : n;
    }
    case "data":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new ErroRegistro(`Data inválida em "${c.rotulo}".`);
      return String(v);
    case "datahora": {
      const d = new Date(String(v));
      if (Number.isNaN(+d)) throw new ErroRegistro(`Data e hora inválidas em "${c.rotulo}".`);
      return d.toISOString();
    }
    case "bool":
      return v === true || v === "true" || v === "on";
    case "select":
      if (c.opcoes && !c.opcoes.some(([k]) => k === String(v))) throw new ErroRegistro(`Opção inválida em "${c.rotulo}".`);
      return String(v);
    case "membro":
    case "ref":
      if (!ehUuid(v)) throw new ErroRegistro(`Escolha uma opção em "${c.rotulo}".`);
      return v;
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) throw new ErroRegistro(`E-mail inválido em "${c.rotulo}".`);
      return String(v).trim().toLowerCase().slice(0, 200);
    default:
      return String(v).trim().slice(0, c.tipo === "textarea" ? 5000 : 300);
  }
}

/** Monta a linha a gravar a partir do corpo, só com os campos do cadastro. */
export function validarRegistro(r: Recurso, corpo: Record<string, unknown>, criando: boolean) {
  const linha: Record<string, unknown> = {};
  for (const c of r.campos) {
    if (c.sistema) continue;
    if (!criando && c.soCriar) continue;
    let v = corpo[c.nome];
    if (criando && v === undefined && c.padrao !== undefined) v = c.padrao;
    if (criando && v === undefined && c.obrigatorio) throw new ErroRegistro(`Preencha "${c.rotulo}".`);
    const valor = valorCampo(c, v);
    if (valor !== undefined) linha[c.nome] = valor;
  }
  return linha;
}

export type ContextoAcao = {
  ator: Ator;
  recurso: Recurso;
  id: string;
  linha: Record<string, unknown>;
  motivo: string;
  admin: ReturnType<typeof supabaseAdmin>;
};
/** Devolve o que gravar na linha (ou null quando a ação já gravou sozinha). */
export type Executor = (ctx: ContextoAcao) => Promise<Record<string, unknown> | null>;

const ACOES: Record<string, Record<string, Executor>> = {};
const DEPOIS_CRIAR: Record<string, (ator: Ator, linha: Record<string, unknown>) => Promise<void>> = {};
const ANTES_CRIAR: Record<string, (ator: Ator, linha: Record<string, unknown>) => Promise<void>> = {};

export function registrarAcoes(recurso: string, acoes: Record<string, Executor>) {
  ACOES[recurso] = { ...(ACOES[recurso] ?? {}), ...acoes };
}
export function registrarAntesCriar(recurso: string, fn: (ator: Ator, linha: Record<string, unknown>) => Promise<void>) {
  ANTES_CRIAR[recurso] = fn;
}
export function registrarDepoisCriar(recurso: string, fn: (ator: Ator, linha: Record<string, unknown>) => Promise<void>) {
  DEPOIS_CRIAR[recurso] = fn;
}
export const executorDe = (recurso: string, acao: string) => ACOES[recurso]?.[acao] ?? null;
export const antesCriar = (recurso: string) => ANTES_CRIAR[recurso] ?? null;
export const depoisCriar = (recurso: string) => DEPOIS_CRIAR[recurso] ?? null;

export const podeLer = (a: Ator | null, r: Recurso) => temSetor(a, ...r.ler);
export const podeEscrever = (a: Ator | null, r: Recurso) => temSetor(a, ...r.escrever);
