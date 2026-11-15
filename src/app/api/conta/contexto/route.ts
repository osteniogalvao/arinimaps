import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { assinatura } from "@/lib/juridico";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Entre para escolher um perfil." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.entrada !== "string") return NextResponse.json({ error: "Escolha uma entrada." }, { status: 400 });
  const versao = assinatura("termos-de-uso", "privacidade");
  if (body.aceite === true && body.versao !== versao) return NextResponse.json(
    { error: "Os termos foram atualizados. Recarregue a página e confira a versão vigente." }, { status:409 });
  const { error } = await supabaseAdmin().rpc("fn_trocar_contexto", { p_titular: a.userId,
    p_entrada: body.entrada, p_aceite: body.aceite === true ? versao : null });
  if (error) return NextResponse.json({ error: error.code.startsWith("P86") ? error.message : "Não foi possível trocar de perfil." },
    { status: error.code.startsWith("P86") ? 403 : 503 });
  return NextResponse.json({ ok: true });
}
