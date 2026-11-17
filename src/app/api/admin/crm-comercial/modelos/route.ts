import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { ETAPAS } from "@/lib/funil";

const UUID = /^[0-9a-f-]{36}$/i;

function dados(b: Record<string, unknown>) {
  const titulo = typeof b.titulo === "string" ? b.titulo.trim().slice(0, 80) : "";
  const texto = typeof b.texto === "string" ? b.texto.trim().slice(0, 4000) : "";
  if (!titulo || !texto) return "Preencha o título e o texto.";
  return {
    titulo, texto,
    canal: ["whatsapp", "email", "ambos"].includes(String(b.canal)) ? String(b.canal) : "whatsapp",
    assunto: typeof b.assunto === "string" ? b.assunto.trim().slice(0, 150) || null : null,
    etapa: ETAPAS.includes(b.etapa as never) ? String(b.etapa) : null,
    ativo: b.ativo !== false,
    ordem: Number.isInteger(b.ordem) ? Number(b.ordem) : 0,
  };
}

/** Modelos de mensagem do Comercial (migration 0147). POST cria, PATCH altera, DELETE apaga. */
export async function POST(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  const d = dados(await request.json().catch(() => ({})));
  if (typeof d === "string") return NextResponse.json({ error: d }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("crm_modelos_mensagem").insert({ ...d, criado_por: a!.userId }).select("id").single();
  if (error) return NextResponse.json({ error: "Falta rodar a migration 0147 ou o banco recusou." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: "crm_modelo_criado", entidade: "crm_modelos_mensagem", entidade_id: data.id });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!UUID.test(String(b.id))) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const d = dados(b);
  if (typeof d === "string") return NextResponse.json({ error: d }, { status: 400 });
  const { error } = await supabaseAdmin().from("crm_modelos_mensagem").update(d).eq("id", String(b.id));
  if (error) return NextResponse.json({ error: "Não foi possível salvar." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: "crm_modelo_alterado", entidade: "crm_modelos_mensagem", entidade_id: String(b.id) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const { error } = await supabaseAdmin().from("crm_modelos_mensagem").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Não foi possível apagar." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: "crm_modelo_apagado", entidade: "crm_modelos_mensagem", entidade_id: id });
  return NextResponse.json({ ok: true });
}
