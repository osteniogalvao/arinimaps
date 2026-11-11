import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

/** Capacidade de trabalho de um membro da equipe (Diretoria). */
export async function PATCH(request: Request) {
  const a = await ator();
  if (!temSetor(a, "diretoria")) return NextResponse.json({ error: "Só a Diretoria define capacidade." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const cap = Math.round(Number(b.capacidade));
  if (!Number.isFinite(cap) || cap < 1 || cap > 200) return NextResponse.json({ error: "Capacidade entre 1 e 200." }, { status: 400 });
  const { error } = await supabaseAdmin().from("profiles").update({ capacidade_tarefas: cap }).eq("user_id", String(b.user_id ?? ""));
  if (error) return NextResponse.json({ error: "Falta a migration 0067." }, { status: 503 });
  await logAudit({ user_id: a!.userId, acao: "capacidade_definida", entidade: "profiles", entidade_id: String(b.user_id), dados_depois: { capacidade: cap } });
  return NextResponse.json({ ok: true });
}
