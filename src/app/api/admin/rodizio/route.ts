import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";

/** Liga ou desliga um membro da equipe no rodízio de leads (migration 0065). */
export async function PATCH(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Só o Comercial cuida do rodízio." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const userId = String(b.user_id ?? "");
  const ligado = b.ligado === true;
  const admin = supabaseAdmin();
  const { data: membro } = await admin.from("profiles").select("role, setores, ativo").eq("user_id", userId).maybeSingle();
  if (!membro || !["admin_central", "analista_arini"].includes(membro.role)) {
    return NextResponse.json({ error: "Só entra no rodízio quem é da equipe." }, { status: 400 });
  }
  if (ligado && membro.role !== "admin_central" && !(membro.setores ?? []).includes("comercial")) {
    return NextResponse.json({ error: "Coloque a pessoa no setor Comercial antes (Equipe e usuários)." }, { status: 400 });
  }
  const { error } = await admin.from("profiles").update({ rodizio_leads: ligado }).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "A Central ainda não foi atualizada (migration 0065)." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: ligado ? "rodizio_entrou" : "rodizio_saiu", entidade: "profiles", entidade_id: userId });
  return NextResponse.json({ ok: true });
}
