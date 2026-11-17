import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

const UUID = /^[0-9a-f-]{36}$/i;
const inteiro = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(100000, Math.round(Number(v))) : 0);

/** Meta mensal de um corretor (migration 0147). Só a Diretoria define. */
export async function PUT(request: Request) {
  const a = await ator();
  if (!temSetor(a, "diretoria")) return NextResponse.json({ error: "Só a Diretoria define metas." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = String(b.user_id ?? "");
  const mes = String(b.mes ?? "");
  if (!UUID.test(userId) || !/^\d{4}-\d{2}-01$/.test(mes)) return NextResponse.json({ error: "Corretor ou mês inválido." }, { status: 400 });
  const vgv = Number(String(b.vgv ?? "0").replace(/\./g, "").replace(",", "."));
  const meta = {
    user_id: userId, mes,
    atendimentos: inteiro(b.atendimentos), visitas: inteiro(b.visitas), propostas: inteiro(b.propostas), vendas: inteiro(b.vendas),
    vgv: Number.isFinite(vgv) && vgv >= 0 ? Math.round(vgv * 100) / 100 : 0,
    definida_por: a!.userId, updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin().from("crm_metas").upsert(meta, { onConflict: "user_id,mes" });
  if (error) return NextResponse.json({ error: "Falta rodar a migration 0147 ou o banco recusou." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: "crm_meta_definida", entidade: "crm_metas", entidade_id: userId, dados_depois: meta });
  return NextResponse.json({ ok: true });
}
