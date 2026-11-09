import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  bloqueioAtivo, caminhoLivre, cookieValido, COOKIE_BLOQUEIO, pedidoDePrevia, respostaPrevia,
} from "@/lib/seguranca/bloqueio";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { opcoesCookieSessao } from "@/lib/seguranca/cookies";

// Trava o site com a senha de bloqueio (SITE_SENHA) e mantém a sessão do
// Supabase viva (refresh de token via cookies).
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // CSRF: POST/PUT/PATCH/DELETE nas APIs só a partir do próprio site (webhook do Asaas isento)
  if (pathname.startsWith("/api/")) {
    const origem = conferirOrigem(request, pathname);
    if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  }
  if (bloqueioAtivo() && !caminhoLivre(pathname) &&
      !(await cookieValido(request.cookies.get(COOKIE_BLOQUEIO)?.value))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Site em acesso restrito." }, { status: 401 });
    }
    // SITE_SENHA_PREVIA=1: robô de prévia de link recebe só as metatags (ver bloqueio.ts)
    const ua = request.headers.get("user-agent");
    if (pedidoDePrevia(request.method, pathname, ua)) {
      const previa = await respostaPrevia(pathname, search, ua!);
      if (previa) return previa;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/acesso";
    url.search = pathname === "/" ? "" : "?volta=" + encodeURIComponent(pathname + search);
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: opcoesCookieSessao(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // `api/admin/cartografia` fica de fora de propósito: o proxy precisa segurar o
  // corpo inteiro da requisição para renovar a sessão, e planta de cidade passa
  // de 100 MB. A rota confere a sessão por conta própria (ator()) e lê o arquivo
  // em fluxo, sem nunca carregá-lo inteiro na memória.
  // `api/tiles` e `api/geo` também ficam de fora: são dezenas de pedidos por
  // movimento do mapa e nenhum precisa de sessão — passar cada um pelo refresh
  // do token (uma ida ao Supabase Auth) era parte da lentidão do zoom.
  matcher: [
    "/((?!api/admin/cartografia|api/tiles|api/geo|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|pbf)).*)",
  ],
};
