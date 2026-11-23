import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

/**
 * Caixa (migration 0157). Financeiro e Diretoria.
 *   { acao: "movimento", conta_bancaria_id, natureza, valor, data, historico, conta_id? }
 *   { acao: "transferencia", de, para, valor, data, historico? }
 */
const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function POST(request: Request) {
  const a = await ator();
  if (!temSetor(a, "financeiro", "diretoria")) return erro("Restrito ao Financeiro.", 403);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = supabaseAdmin();
  const valor = Math.round(Number(String(b.valor ?? "").replace(",", ".")) * 100) / 100;
  if (!Number.isFinite(valor) || valor <= 0) return erro("Informe um valor maior que zero.");
  const data = DATA.test(String(b.data ?? "")) ? String(b.data) : new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  if (b.acao === "movimento") {
    if (!UUID.test(String(b.conta_bancaria_id))) return erro("Escolha a conta do caixa.");
    if (!["entrada", "saida"].includes(String(b.natureza))) return erro("Entrada ou saída?");
    const historico = String(b.historico ?? "").trim().slice(0, 300);
    if (!historico) return erro("Descreva o movimento.");
    const { error } = await admin.from("lancamentos_contabeis").insert({
      data, historico, natureza: b.natureza, valor, conta_bancaria_id: b.conta_bancaria_id,
      conta_id: UUID.test(String(b.conta_id ?? "")) ? b.conta_id : null, origem: "manual", criado_por: a!.userId,
    });
    if (error) return erro(/conta_bancaria/.test(error.message) ? "Falta rodar a migration 0157." : "Não foi possível lançar.", 503);
    await logAudit({ user_id: a!.userId, acao: "caixa_movimento", entidade: "lancamentos_contabeis", dados_depois: { natureza: b.natureza, valor } });
    return NextResponse.json({ ok: true });
  }

  if (b.acao === "transferencia") {
    if (!UUID.test(String(b.de)) || !UUID.test(String(b.para)) || b.de === b.para) return erro("Escolha duas contas diferentes.");
    const { data: contas } = await admin.from("contas_bancarias").select("id, nome").in("id", [b.de, b.para]);
    if ((contas ?? []).length !== 2) return erro("Conta não encontrada.");
    const nome = (id: unknown) => contas!.find((c) => c.id === id)?.nome;
    const { data: plano } = await admin.from("plano_contas").select("id").eq("codigo", "1.2").maybeSingle();
    const historico = String(b.historico ?? "").trim().slice(0, 200) || `Transferência ${nome(b.de)} → ${nome(b.para)}`;
    // as duas pernas com o mesmo id de origem, para estornar juntas
    const ref = randomUUID();
    const { error } = await admin.from("lancamentos_contabeis").insert([
      { data, historico, natureza: "saida", valor, conta_bancaria_id: b.de, conta_id: plano?.id ?? null, origem: "transferencia", criado_por: a!.userId },
      { data, historico, natureza: "entrada", valor, conta_bancaria_id: b.para, conta_id: plano?.id ?? null, origem: "transferencia", criado_por: a!.userId },
    ].map((l) => ({ ...l, historico: `${l.historico} · ${ref.slice(0, 8)}` })));
    if (error) return erro("Não foi possível transferir.", 503);
    await logAudit({ user_id: a!.userId, acao: "caixa_transferencia", entidade: "lancamentos_contabeis", dados_depois: { de: b.de, para: b.para, valor } });
    return NextResponse.json({ ok: true });
  }
  return erro("Ação desconhecida.");
}
