import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

const UUID = /^[0-9a-f-]{36}$/i;

/** Motivos de perda (migration 0147). POST cria; PATCH liga/desliga ou renomeia. */
export async function POST(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const nome = typeof b.nome === "string" ? b.nome.trim().slice(0, 80) : "";
  if (!nome) return NextResponse.json({ error: "Escreva o motivo." }, { status: 400 });
  const { error } = await supabaseAdmin().from("crm_motivos_perda").insert({ nome, ordem: 50 });
  if (error?.code === "23505") return NextResponse.json({ error: "Esse motivo já existe." }, { status: 409 });
  if (error) return NextResponse.json({ error: "Falta rodar a migration 0147 ou o banco recusou." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: "crm_motivo_criado", entidade: "crm_motivos_perda", dados_depois: { nome } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!UUID.test(String(b.id))) return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });
  const mud: Record<string, unknown> = {};
  if (typeof b.ativo === "boolean") mud.ativo = b.ativo;
  if (typeof b.nome === "string" && b.nome.trim()) mud.nome = b.nome.trim().slice(0, 80);
  if (!Object.keys(mud).length) return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
  const { error } = await supabaseAdmin().from("crm_motivos_perda").update(mud).eq("id", String(b.id));
  if (error) return NextResponse.json({ error: "Não foi possível salvar." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: "crm_motivo_alterado", entidade: "crm_motivos_perda", entidade_id: String(b.id), dados_depois: mud });
  return NextResponse.json({ ok: true });
}
