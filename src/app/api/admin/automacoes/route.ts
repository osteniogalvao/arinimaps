import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";

/** Roda as regras da Central agora (o worker roda sozinho a cada 10 min). */
export async function POST() {
  const a = await ator();
  if (!temSetor(a, "diretoria")) return NextResponse.json({ error: "Só a Diretoria roda as automações." }, { status: 403 });
  const { data, error } = await supabaseAdmin().rpc("fn_central_automacoes");
  if (error) return NextResponse.json({ error: "A Central ainda não foi atualizada (migration 0065)." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: "automacoes_rodadas", entidade: "tasks", dados_depois: data });
  return NextResponse.json({ ok: true, resultado: data });
}
