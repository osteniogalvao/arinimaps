import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { acessoDe } from "@/lib/planos-servidor";
import { COOKIE_APARELHO, entrarComAparelho, situacaoAparelho } from "@/lib/seguranca/uso";

/**
 * Acesso simultâneo (limites por assinatura, 26/11/2026): o navegador logado
 * pergunta de tempos em tempos se este aparelho ainda é da conta.
 *  · sem cookie (sessão de antes da regra, entrada pelo Google…): registra agora;
 *  · removido (outro aparelho entrou depois): apaga o cookie e responde
 *    `ativo: false` — a tela encerra a sessão e leva para /entrar.
 */
export async function GET(request: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const semCache = { "Cache-Control": "private, no-store" };
  if (!user) return NextResponse.json({ ativo: true, sessao: false }, { headers: semCache });
  const acesso = await acessoDe(user.id);
  const situacao = await situacaoAparelho(request, user.id, acesso);
  if (situacao === "removido") {
    const r = NextResponse.json({ ativo: false, motivo: "outro_aparelho" }, { headers: semCache });
    r.cookies.delete(COOKIE_APARELHO);
    return r;
  }
  if (situacao === "novo") {
    const aparelho = crypto.randomUUID();
    await entrarComAparelho(request, user.id, acesso, aparelho).catch(() => undefined);
    const r = NextResponse.json({ ativo: true }, { headers: semCache });
    r.cookies.set(COOKIE_APARELHO, aparelho, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 400 * 86400 });
    return r;
  }
  return NextResponse.json({ ativo: true }, { headers: semCache });
}
