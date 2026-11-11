import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

/**
 * Arquivo do contador: lançamentos do período em CSV (ponto e vírgula, vírgula
 * decimal, como o Excel brasileiro abre). ?de=AAAA-MM-DD&ate=AAAA-MM-DD;
 * sem datas, o mês anterior inteiro.
 */
export async function GET(request: Request) {
  const a = await ator();
  if (!temSetor(a, "financeiro", "diretoria")) return NextResponse.json({ error: "Restrito ao Financeiro." }, { status: 403 });
  const u = new URL(request.url);
  const ok = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const hoje = new Date();
  const de = ok(u.searchParams.get("de")) ? u.searchParams.get("de")! : new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString().slice(0, 10);
  const ate = ok(u.searchParams.get("ate")) ? u.searchParams.get("ate")! : new Date(hoje.getFullYear(), hoje.getMonth(), 0).toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin().from("lancamentos_contabeis")
    .select("data, historico, natureza, valor, origem, estornado, conta:plano_contas(codigo, nome), centro:centros_custo(nome)")
    .gte("data", de).lte("data", ate).order("data");
  if (error) return NextResponse.json({ error: "Falta a migration 0066." }, { status: 503 });

  const cel = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [["Data", "Histórico", "Conta", "Nome da conta", "Centro de custo", "Natureza", "Valor", "Origem", "Estornado"].join(";")];
  for (const l of data ?? []) {
    const conta = l.conta as unknown as { codigo: string; nome: string } | null;
    const centro = l.centro as unknown as { nome: string } | null;
    linhas.push([
      new Date(l.data + "T12:00:00").toLocaleDateString("pt-BR"), cel(l.historico), conta?.codigo ?? "", cel(conta?.nome), cel(centro?.nome),
      l.natureza === "entrada" ? "Entrada" : "Saída", Number(l.valor).toFixed(2).replace(".", ","), l.origem, l.estornado ? "Sim" : "Não",
    ].join(";"));
  }
  await logAudit({ user_id: a!.userId, acao: "contabil_exportado", entidade: "lancamentos_contabeis", dados_depois: { de, ate, linhas: data?.length ?? 0 } });
  return new NextResponse("﻿" + linhas.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lancamentos-${de}-a-${ate}.csv"`,
    },
  });
}
