import "server-only";
import { randomUUID } from "node:crypto";
import type { Ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerConfiguracoes } from "@/lib/settings";
import { modeloIa } from "./config";

export type OperacaoAri = "chat" | "imagem" | "matricula" | "cadastro";
export type SaldoAri = { plano: number; comprados: number; cortesia: number; total: number };
export const uuidAri = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function saldoAri(userId: string, nicho: string | null) {
  const { data, error } = await supabaseAdmin().rpc("fn_ari_saldo", { p_titular: userId, p_nicho: nicho ?? "" });
  if (error || !data) throw new Error("Não foi possível consultar os créditos da Ari.");
  return data as SaldoAri;
}

export async function reservarAri(a: Ator, request: Request, operacao: OperacaoAri) {
  const cfg = await lerConfiguracoes();
  const configurado = cfg["ari_modelo_" + operacao];
  const modeloPadrao = operacao === "matricula" ? process.env.ARINI_IA_MODELO_MATRICULA?.trim() || "claude-sonnet-5-5" : modeloIa();
  const modelo = typeof configurado === "string" && configurado.trim() ? configurado.trim() : modeloPadrao;
  if (a.ehArini) return { modelo, restante: null, estornar: async () => {}, concluir: async () => {} };
  const chave = request.headers.get("Idempotency-Key") ?? randomUUID();
  if (!uuidAri.test(chave)) return { erro: falha(400, "chave_invalida", "Identificador da chamada inválido.") };
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("fn_ari_debitar", { p_titular: a.userId, p_nicho: a.nicho ?? "", p_id: chave, p_operacao: operacao, p_modelo: modelo });
  if (error) {
    if (error.code === "P8901") return { erro: falha(402, "saldo_insuficiente", "Você não tem créditos suficientes para esta operação.", { solucao: "Consulte sua carteira em /conta/creditos." }) };
    if (error.code === "P8902") return { erro: falha(429, "teto_diario", "Você atingiu o limite diário de créditos da Ari.") };
    if (error.code === "23505") return { erro: falha(409, "chamada_repetida", "Esta chamada já foi processada.") };
    if (error.code === "42501" || error.code === "P0002") return { erro: falha(409, "perfil_alterado", "Seu perfil mudou. Atualize a página.") };
    console.error("Reserva de créditos indisponível", error.code);
    return { erro: falha(503, "carteira_indisponivel", "Não foi possível reservar os créditos. Tente novamente.") };
  }
  const estornar = async () => {
    const { error } = await db.rpc("fn_ari_estornar", { p_titular: a.userId, p_id: chave });
    if (error) console.error("Falha na devolução de créditos da Ari", chave, error.code);
  };
  const concluir = async () => {
    const { error } = await db.rpc("fn_ari_concluir", { p_titular: a.userId, p_id: chave });
    if (error) console.error("Falha ao concluir a reserva da Ari", chave, error.code);
  };
  return { modelo, restante: Number(data), estornar, concluir };
}