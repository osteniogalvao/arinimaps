import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";

/**
 * Define o território de um parceiro. Com território, o parceiro passa a ser
 * franqueado daquela região; sem território, volta ao tipo com que se cadastrou
 * (guardado no histórico da auditoria). Só a diretoria concede franquia.
 */
export async function PATCH(request: Request) {
  const a = await ator();
  if (!a || !temSetor(a, "diretoria")) {
    return NextResponse.json({ error: "Só a diretoria define território de franquia." }, { status: 403 });
  }
  const { id, region_id } = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();
  const { data: p } = await admin.from("partners").select("id, tipo, region_id, profile_id, status").eq("id", id).single();
  if (!p) return NextResponse.json({ error: "Parceiro não encontrado." }, { status: 404 });
  if (!["aprovado", "ativo"].includes(p.status)) {
    return NextResponse.json({ error: "Aprove o cadastro antes de conceder território." }, { status: 400 });
  }

  let tipo = p.tipo as string;
  if (region_id) {
    const { data: r } = await admin.from("regions").select("id").eq("id", region_id).maybeSingle();
    if (!r) return NextResponse.json({ error: "Região inválida." }, { status: 400 });
    tipo = "franqueado";
  } else if (p.tipo === "franqueado") {
    // perdeu o território: volta ao tipo que tinha antes da franquia, lido da
    // auditoria (a concessão grava `dados_antes.tipo`). Trocar de região grava
    // "franqueado" como antes, por isso vale a concessão mais recente que veio
    // de outro tipo. Sem registro (franquia anterior à auditoria): imobiliária.
    const { data: concessoes } = await admin.from("audit_log").select("dados_antes")
      .eq("entidade", "partners").eq("entidade_id", id).eq("acao", "franquia_concedida")
      .neq("dados_antes->>tipo", "franqueado").order("created_at", { ascending: false }).limit(1);
    const anterior = (concessoes?.[0]?.dados_antes as { tipo?: unknown } | null)?.tipo;
    const PERMITIDOS = ["imobiliaria", "corretor", "engenheiro", "leiloeiro"];
    tipo = typeof anterior === "string" && PERMITIDOS.includes(anterior) ? anterior : "imobiliaria";
  }

  const { error } = await admin.from("partners").update({ region_id: region_id || null, tipo }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await admin.from("profiles").update({ role: tipo }).eq("user_id", p.profile_id);

  await logAudit({
    user_id: a.userId, acao: region_id ? "franquia_concedida" : "franquia_retirada", entidade: "partners", entidade_id: id,
    dados_antes: { tipo: p.tipo, region_id: p.region_id }, dados_depois: { tipo, region_id: region_id || null },
  });
  return NextResponse.json({ ok: true });
}
