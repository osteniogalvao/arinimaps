import { NextResponse } from "next/server";
import { BLOQUEIO_DIAS, COOKIE_BLOQUEIO, fichaDeAcesso, senhaConfere } from "@/lib/seguranca/bloqueio";
import { destinoSeguro } from "@/lib/seguranca/destino";
import { consultarLimite, ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";

// Confere a senha de bloqueio do site e libera o navegador por 30 dias.
// Só a senha ERRADA conta no limite: a equipe inteira sai pelo mesmo IP do
// escritório, e 10 acertos em 15 minutos não podem trancar o 11º colega.
// Depois de 10 erros, nem a senha certa passa até a janela virar.
export async function POST(request: Request) {
  const chave = `acesso:erro:${ipDoPedido(request)}`;
  const atual = await consultarLimite(chave, 10, 15 * 60);
  if (!atual.permitido) return respostaLimite(atual, "senha");

  const body = await request.json().catch(() => null);
  const senha = typeof body?.senha === "string" ? body.senha : "";
  if (!(await senhaConfere(senha))) {
    const limite = await limitar(chave, 10, 15 * 60);
    if (!limite.permitido) return respostaLimite(limite, "senha");
    return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, volta: destinoSeguro(body?.volta) });
  res.cookies.set(COOKIE_BLOQUEIO, await fichaDeAcesso(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BLOQUEIO_DIAS * 24 * 60 * 60,
  });
  return res;
}
