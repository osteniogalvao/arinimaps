import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

/**
 * Parcelas de aluguel (migration 0157). Financeiro e Diretoria.
 *   { id, acao: "pagar", valor?, data? }      inquilino pagou (vira entrada no caixa)
 *   { id, acao: "desfazer_pagamento" }        estorna a entrada
 *   { id, acao: "repassar", data? }           repasse ao proprietário (vira saída)
 *   { id, acao: "reter", motivo }             repasse retido (pendência do proprietário)
 *   { id, acao: "cancelar", motivo }          parcela não será cobrada
 *   { acao: "gerar", contrato_id, competencia }  gera a parcela de um mês
 */
const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function POST(request: Request) {
  const a = await ator();
  if (!temSetor(a, "financeiro", "diretoria")) return erro("Restrito ao Financeiro.", 403);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = supabaseAdmin();

  if (b.acao === "gerar") {
    if (!UUID.test(String(b.contrato_id)) || !DATA.test(String(b.competencia))) return erro("Contrato ou mês inválido.");
    const { data, error } = await admin.rpc("fn_aluguel_gerar_parcela", { p_contrato: b.contrato_id, p_competencia: b.competencia });
    if (error) return erro(/fn_aluguel/.test(error.message) ? "Falta rodar a migration 0157." : "Não foi possível gerar.", 503);
    if (!data) return erro("Esse mês já tem parcela ou está fora da vigência do contrato.");
    return NextResponse.json({ ok: true });
  }

  if (!UUID.test(String(b.id))) return erro("Parcela inválida.");
  const { data: p, error } = await admin.from("alugueis_parcelas").select("*").eq("id", b.id).maybeSingle();
  if (error) return erro("Falta rodar a migration 0157 (Aluguéis).", 503);
  if (!p) return erro("Parcela não encontrada.", 404);
  const data = DATA.test(String(b.data ?? "")) ? String(b.data) : hoje();
  const motivo = String(b.motivo ?? "").trim().slice(0, 500);
  let mud: Record<string, unknown>;
  switch (b.acao) {
    case "pagar": {
      if (!["pendente", "atrasado"].includes(p.status)) return erro("Essa parcela não está em aberto.");
      const valor = b.valor === undefined || b.valor === "" ? Number(p.valor) : Number(b.valor);
      if (!Number.isFinite(valor) || valor <= 0) return erro("Valor pago inválido.");
      const { data: c } = await admin.from("contratos_locacao").select("taxa_administracao, dias_repasse").eq("id", p.contrato_id).single();
      const taxa = Number(c?.taxa_administracao ?? 0);
      const repasse = new Date(Date.parse(data + "T12:00:00Z") + Number(c?.dias_repasse ?? 0) * 86_400_000).toISOString().slice(0, 10);
      mud = { status: "pago", pago_em: data, valor_pago: valor, valor_repasse: Math.round(valor * (1 - taxa / 100) * 100) / 100, repasse_vencimento: repasse };
      break;
    }
    case "desfazer_pagamento":
      if (p.status !== "pago") return erro("A parcela não está paga.");
      if (p.repasse_status === "repassado") return erro("Desfaça o repasse antes.");
      mud = { status: p.vencimento < hoje() ? "atrasado" : "pendente", pago_em: null, valor_pago: null };
      break;
    case "repassar":
      if (p.status !== "pago") return erro("Só repassa depois que o inquilino pagou.");
      if (p.repasse_status === "repassado") return erro("Já repassado.");
      mud = { repasse_status: "repassado", repasse_em: data };
      break;
    case "desfazer_repasse":
      if (p.repasse_status !== "repassado") return erro("O repasse não foi feito.");
      mud = { repasse_status: "pendente", repasse_em: null };
      break;
    case "reter":
      if (motivo.length < 5) return erro("Explique o motivo da retenção.");
      mud = { repasse_status: "retido", observacoes: [p.observacoes, `Repasse retido: ${motivo}`].filter(Boolean).join("\n") };
      break;
    case "cancelar":
      if (p.status === "pago") return erro("Desfaça o pagamento antes de cancelar.");
      if (motivo.length < 5) return erro("Explique o motivo do cancelamento.");
      mud = { status: "cancelado", observacoes: [p.observacoes, `Cancelada: ${motivo}`].filter(Boolean).join("\n") };
      break;
    default:
      return erro("Ação desconhecida.");
  }
  const { error: e2 } = await admin.from("alugueis_parcelas").update(mud).eq("id", p.id).eq("updated_at", p.updated_at);
  if (e2) return erro("Não foi possível salvar.", 503);
  await logAudit({ user_id: a!.userId, acao: "aluguel_" + b.acao, entidade: "alugueis_parcelas", entidade_id: p.id, dados_antes: p, dados_depois: mud });
  return NextResponse.json({ ok: true });
}
