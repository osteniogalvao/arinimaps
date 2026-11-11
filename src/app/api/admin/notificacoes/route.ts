import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";

/** Sino da Central: as últimas notificações da pessoa (GET) e marcar como lidas (PATCH). */
export async function GET() {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ itens: [], naoLidas: 0 });
  const admin = supabaseAdmin();
  const [{ data, error }, { count }] = await Promise.all([
    admin.from("notificacoes").select("id, nivel, titulo, texto, link, lida_em, created_at").eq("user_id", a.userId)
      .order("created_at", { ascending: false }).limit(30),
    admin.from("notificacoes").select("id", { count: "exact", head: true }).eq("user_id", a.userId).is("lida_em", null),
  ]);
  if (error) return NextResponse.json({ itens: [], naoLidas: 0 });
  return NextResponse.json({ itens: data ?? [], naoLidas: count ?? 0 });
}

export async function PATCH(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  let q = supabaseAdmin().from("notificacoes").update({ lida_em: new Date().toISOString() }).eq("user_id", a.userId).is("lida_em", null);
  if (typeof b.id === "string") q = q.eq("id", b.id);
  await q;
  return NextResponse.json({ ok: true });
}
