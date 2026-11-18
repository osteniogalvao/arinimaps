import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { ipDoPedido, limitar } from "@/lib/seguranca/limite";
import { COOKIE_APARELHO, assinarPasse, cookiePasse } from "@/lib/links/exclusivo";

const MENSAGEM: Record<string, string> = {
  usado: "Este link é exclusivo e já foi aberto em outro aparelho. Peça um link novo a quem enviou.",
  expirado: "Este link exclusivo expirou. Peça um link novo a quem enviou.",
  revogado: "Quem enviou cancelou este link.",
};

/**
 * Abre o link exclusivo neste aparelho. É um POST disparado pela página /x/…
 * no navegador: a prévia do WhatsApp (que só lê o HTML) não gasta o link.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!ehUuid(token)) return NextResponse.json({ error: "Link inválido." }, { status: 404 });
  const l = await limitar("links-exclusivos-abrir:" + ipDoPedido(req), 40, 600);
  if (!l.permitido) return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });

  const jar = await cookies();
  const atual = jar.get(COOKIE_APARELHO)?.value;
  const aparelho = ehUuid(atual) ? atual : randomUUID();
  const { data, error } = await supabaseAdmin().rpc("link_exclusivo_abrir", { p_token: token, p_dispositivo: aparelho }).maybeSingle();
  if (error) return NextResponse.json({ error: "Não foi possível abrir o link agora." }, { status: 503 });
  const r = data as { situacao: string; codigo: string; destino: string; expira_em: string } | null;
  if (!r) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });
  if (r.situacao !== "ok" && r.situacao !== "mesmo") {
    return NextResponse.json({ error: MENSAGEM[r.situacao] ?? "Link indisponível.", situacao: r.situacao }, { status: 410 });
  }
  const exp = new Date(r.expira_em).getTime();
  const passe = assinarPasse(r.codigo, token, exp);
  if (!passe) return NextResponse.json({ error: "Link exclusivo indisponível no servidor (falta o segredo)." }, { status: 503 });
  const destino = r.destino === "ficha" ? `/imovel/${r.codigo}` : `/imovel/${r.codigo}/tour`;
  const res = NextResponse.json({ destino });
  const seguro = new URL(req.url).protocol === "https:" || process.env.NODE_ENV === "production";
  const maxAge = Math.max(60, Math.floor((exp - Date.now()) / 1000));
  res.cookies.set(COOKIE_APARELHO, aparelho, { path: "/", httpOnly: true, sameSite: "lax", secure: seguro, maxAge: 365 * 86400 });
  res.cookies.set(cookiePasse(r.codigo), passe, { path: "/imovel/" + r.codigo, httpOnly: true, sameSite: "lax", secure: seguro, maxAge });
  return res;
}
