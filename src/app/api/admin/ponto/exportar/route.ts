import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { JORNADA_PADRAO, horaSP, minutosEmHoras, montarEspelho, type Jornada, type Marcacao } from "@/lib/ponto";

/**
 * Espelho de ponto do mês em CSV (?mes=AAAA-MM&user=<id>) e, com
 * ?formato=marcacoes, a lista crua de marcações com NSR e hash para conferência.
 * O colaborador baixa o próprio; a Diretoria baixa o de qualquer um.
 */
export async function GET(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const u = new URL(request.url);
  const mes = /^\d{4}-\d{2}$/.test(u.searchParams.get("mes") ?? "") ? u.searchParams.get("mes")! : new Date().toISOString().slice(0, 7);
  const alvo = u.searchParams.get("user") ?? a.userId;
  if (alvo !== a.userId && !temSetor(a, "diretoria")) return NextResponse.json({ error: "Só a Diretoria baixa o ponto de outra pessoa." }, { status: 403 });

  const admin = supabaseAdmin();
  const inicio = new Date(`${mes}-01T00:00:00-03:00`);
  const fim = new Date(inicio); fim.setMonth(fim.getMonth() + 1);
  const [{ data: perfil }, { data: jornada }, { data: marcacoes }, { data: ajustes }] = await Promise.all([
    admin.from("profiles").select("nome, cpf_cnpj").eq("user_id", alvo).maybeSingle(),
    admin.from("ponto_jornadas").select("*").eq("user_id", alvo).maybeSingle(),
    admin.from("ponto_marcacoes").select("id, nsr, marcado_em, origem, hash").eq("user_id", alvo)
      .gte("marcado_em", inicio.toISOString()).lt("marcado_em", fim.toISOString()).order("marcado_em"),
    admin.from("ponto_ajustes").select("tipo, marcacao_id, data").eq("user_id", alvo).eq("status", "aprovado"),
  ]);
  const cel = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  let linhas: string[];
  if (u.searchParams.get("formato") === "marcacoes") {
    linhas = ["NSR;Data;Hora;Origem;Hash", ...((marcacoes ?? []) as Marcacao[]).map((m) =>
      [m.nsr, new Date(m.marcado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }), horaSP(m.marcado_em), m.origem, m.hash].join(";"))];
  } else {
    const desc = new Set((ajustes ?? []).filter((x) => x.tipo === "desconsiderar").map((x) => String(x.marcacao_id)));
    const abonos = new Set((ajustes ?? []).filter((x) => x.tipo === "abono").map((x) => String(x.data)));
    const dias = montarEspelho(mes, (marcacoes ?? []) as Marcacao[], (jornada as Jornada | null) ?? JORNADA_PADRAO, desc, abonos).reverse();
    linhas = [`Espelho de ponto;${cel(perfil?.nome)};${mes}`, "Dia;Marcações;Trabalhado;Previsto;Saldo;Observação"];
    for (const d of dias) {
      linhas.push([new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-BR"), d.marcacoes.map((m) => horaSP(m.marcado_em)).join(" "),
        minutosEmHoras(d.trabalhado), minutosEmHoras(d.previsto), minutosEmHoras(d.saldo),
        d.abonado ? "Abonado" : d.incompleto ? "Incompleto" : ""].join(";"));
    }
    linhas.push(`Total;;${minutosEmHoras(dias.reduce((s, d) => s + d.trabalhado, 0))};${minutosEmHoras(dias.reduce((s, d) => s + d.previsto, 0))};${minutosEmHoras(dias.reduce((s, d) => s + d.saldo, 0))};`);
  }
  await logAudit({ user_id: a.userId, acao: "ponto_exportado", entidade: "ponto_marcacoes", entidade_id: alvo, dados_depois: { mes } });
  return new NextResponse("﻿" + linhas.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ponto-${mes}.csv"` },
  });
}
