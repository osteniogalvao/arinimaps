import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";

/** Revoga um link exclusivo (só quem o gerou, ou a equipe). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Entre na sua conta." }, { status: 401 });
  const { token } = await params;
  if (!ehUuid(token)) return NextResponse.json({ error: "Link inválido." }, { status: 400 });
  let q = supabaseAdmin().from("links_exclusivos").update({ revogado_em: new Date().toISOString() }).eq("token", token);
  if (!a.ehArini) q = q.eq("criado_por", a.userId);
  const { data } = await q.select("token");
  if (!data?.length) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
