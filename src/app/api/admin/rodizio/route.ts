import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";

/**
 * Liga ou desliga um membro da equipe no rodízio de leads (migration 0065).
 * Com { regras: {...} }, grava as regras do corretor (migration 0147): peso,
 * tipos de imóvel, UFs, limite por dia e pausa (férias).
 */
export async function PATCH(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Só o Comercial cuida do rodízio." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const userId = String(b.user_id ?? "");
  if (b.regras && typeof b.regras === "object") return regras(a!.userId, userId, b.regras as Record<string, unknown>);
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

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

async function regras(autor: string, userId: string, r: Record<string, unknown>) {
  const admin = supabaseAdmin();
  const { data: membro } = await admin.from("profiles").select("role").eq("user_id", userId).maybeSingle();
  if (!membro || !["admin_central", "analista_arini"].includes(membro.role)) {
    return NextResponse.json({ error: "Só a equipe tem regras de rodízio." }, { status: 400 });
  }
  const peso = Math.min(10, Math.max(1, Math.round(Number(r.peso) || 1)));
  const tipos = (Array.isArray(r.tipos) ? r.tipos : []).filter((t): t is string => t === "urbano" || t === "rural");
  const ufs = (Array.isArray(r.ufs) ? r.ufs : typeof r.ufs === "string" ? r.ufs.split(/[\s,;]+/) : [])
    .map((u) => String(u).trim().toUpperCase()).filter((u) => UFS.includes(u));
  const limite = Number(r.limite_dia) > 0 ? Math.min(500, Math.round(Number(r.limite_dia))) : null;
  const pausa = typeof r.pausa_ate === "string" && r.pausa_ate ? new Date(`${r.pausa_ate}T23:59:00-03:00`) : null;
  if (pausa && Number.isNaN(+pausa)) return NextResponse.json({ error: "Data da pausa inválida." }, { status: 400 });
  const mud = { rodizio_peso: peso, rodizio_tipos: [...new Set(tipos)], rodizio_ufs: [...new Set(ufs)], rodizio_limite_dia: limite,
    rodizio_pausa_ate: pausa ? pausa.toISOString() : null };
  const { error } = await admin.from("profiles").update(mud).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "Falta rodar a migration 0147 (CRM comercial)." }, { status: 400 });
  await logAudit({ user_id: autor, acao: "rodizio_regras", entidade: "profiles", entidade_id: userId, dados_depois: mud });
  return NextResponse.json({ ok: true });
}
