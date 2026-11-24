import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  bloqueioAtivo, caminhoLivre, cookieValido, COOKIE_BLOQUEIO, pedidoDePrevia, respostaPrevia,
} from "@/lib/seguranca/bloqueio";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { opcoesCookieSessao } from "@/lib/seguranca/cookies";
import { fetchComLimite } from "@/lib/supabase/fetchComLimite";
import { somenteLeituraEquipe, escritaLiberadaParaLeitura, mfaObrigatoriaEquipe } from "@/lib/seguranca/equipe";

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
      !(await cookieValido(request.cookies.get(COOKIE_BLOQUEIO)?.value, pathname, request.method))) {
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
      // banco travado não pode segurar toda navegação
      global: { fetch: fetchComLimite(6_000) },
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

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && !escritaLiberadaParaLeitura(pathname, request.method)) {
      const lerPerfil = (colunas: string) => supabase.from("profiles").select(colunas).eq("user_id", user.id).maybeSingle();
      let r = await lerPerfil("role,equipe_acesso,setores_gestor");
      // sem a 0165 ainda não existe perfil de leitura: só o papel basta
      if (r.error?.code === "42703") r = await lerPerfil("role");
      const { error } = r;
      const perfil = r.data as { role?: string; equipe_acesso?: string | null; setores_gestor?: string[] | null } | null;
      if (error || !perfil) return NextResponse.json({ error: "Não foi possível conferir as permissões." }, { status: 503 });
      if (somenteLeituraEquipe(perfil)) return NextResponse.json({ error: "Seu acesso é somente de leitura. Peça a alteração à Diretoria." }, { status: 403 });
      if (mfaObrigatoriaEquipe(perfil)) {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.currentLevel !== "aal2") return NextResponse.json({ error: "Confirme o segundo fator para continuar.", solucao: "/conta/seguranca?obrigatorio=1" }, { status: 403 });
      }
    }
  } catch {
    if (!escritaLiberadaParaLeitura(pathname, request.method)) return NextResponse.json({ error: "Não foi possível conferir a sessão." }, { status: 503 });
    // Supabase fora do ar: segue sem renovar a sessão em vez de travar a página
  }
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
    // O webhook autentica a Meta e mede o corpo em fluxo. O proxy copiaria o corpo antes dessa validação.
    "/((?!api/admin/cartografia|api/webhooks/(?:whatsapp|meta-mensagens)(?:/|$)|api/tiles|api/geo|_next/static|_next/image|favicon.ico|aguardar-documento\\.js$|.*\\.(?:png|jpg|jpeg|svg|webp|pbf)).*)",
  ],
};
