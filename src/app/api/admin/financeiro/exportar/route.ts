import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { lerEmLotes } from "@/lib/supabase/lotes";

/**
 * Planilha do Financeiro para a contabilidade: vendas com comissão e faturas
 * de mensalidade, num CSV que o Excel abre direto (separador ";" e BOM, que é
 * o que o Excel em português espera).
 *
 * Lê em lotes de 1000 (`.range()`) até acabar: o PostgREST corta cada pedido em
 * 1000 linhas sem avisar, e a planilha da contabilidade saía incompleta.
 */
export async function GET() {
  const a = await ator();
  if (!a || !temSetor(a, "financeiro")) {
    return NextResponse.json({ error: "Restrito ao setor Financeiro." }, { status: 403 });
  }
  const admin = supabaseAdmin();
  const [{ data: comissoes, error: e1 }, { data: faturas, error: e2 }] = await Promise.all([
    lerEmLotes((de, ate) => admin.from("commissions")
      .select("valor, percentual, base_calculo, status, pago_em, sale:sales(data_venda, valor_final, opportunity:opportunities(codigo), property:properties(codigo, titulo))")
      .order("created_at").order("id").range(de, ate)),
    lerEmLotes((de, ate) => admin.from("invoices")
      .select("competencia, valor, status, pago_em, subscription:subscriptions(property:properties(codigo, titulo))")
      .order("competencia").order("id").range(de, ate)),
  ]);
  // planilha pela metade é pior que nenhuma: a contabilidade não teria como saber
  if (e1 || e2) {
    return NextResponse.json({ error: "Não foi possível ler tudo para a planilha.", motivo: (e1 ?? e2)!.message }, { status: 500 });
  }

  const num = (v: unknown) => Number(v ?? 0).toFixed(2).replace(".", ",");
  const txt = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [["tipo", "data", "imovel_codigo", "imovel", "referencia", "base", "percentual", "valor", "status", "pago_em"].join(";")];

  for (const c of comissoes ?? []) {
    const s = c.sale as unknown as {
      data_venda: string; valor_final: number;
      opportunity: { codigo: string } | null; property: { codigo: string; titulo: string } | null;
    } | null;
    linhas.push([
      "comissao", s?.data_venda ?? "", s?.property?.codigo ?? "", txt(s?.property?.titulo), s?.opportunity?.codigo ?? "",
      num(c.base_calculo), num(c.percentual), num(c.valor), c.status, c.pago_em ?? "",
    ].join(";"));
  }
  for (const f of faturas ?? []) {
    const p = (f.subscription as unknown as { property: { codigo: string; titulo: string } | null } | null)?.property;
    linhas.push([
      "mensalidade", f.competencia, p?.codigo ?? "", txt(p?.titulo), "", "", "", num(f.valor), f.status, f.pago_em ?? "",
    ].join(";"));
  }

  await logAudit({ user_id: a.userId, acao: "financeiro_exportado", entidade: "commissions", dados_depois: { linhas: linhas.length - 1 } });
  return new NextResponse("﻿" + linhas.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="arini-maps-financeiro-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
