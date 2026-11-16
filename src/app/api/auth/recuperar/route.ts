import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/notify";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";
import { registrarEvento } from "@/lib/seguranca/eventos";

/**
 * Pedido de recuperação de senha.
 *
 * A resposta é SEMPRE a mesma, exista a conta ou não — dizer "e-mail não
 * cadastrado" entrega a lista de quem tem conta. O link é de uso único e
 * expira (token do Supabase Auth); a senha antiga nunca é enviada nem exibida.
 *
 * Com Resend configurado, o e-mail sai pelo nosso remetente, com link direto
 * para /redefinir-senha (funciona em qualquer navegador). Sem Resend, cai no
 * e-mail padrão do Supabase, que tem cota pequena — serve para o piloto.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }

  const ip = ipDoPedido(request);
  const [porIp, porEmail] = await Promise.all([
    limitar(`recuperar:ip:${ip}`, 10, 3600),
    limitar(`recuperar:email:${email}`, 3, 3600),
  ]);
  if (!porIp.permitido || !porEmail.permitido) {
    return respostaLimite(!porIp.permitido ? porIp : porEmail, "recuperação de senha");
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const destino = `${site}/redefinir-senha`;

  if (process.env.RESEND_API_KEY) {
    const { data } = await supabaseAdmin().auth.admin.generateLink({ type: "recovery", email });
    const token = data?.properties?.hashed_token;
    if (token) {
      await sendEmail(
        email,
        "Redefinição de senha — ARINI",
        "Recebemos um pedido para redefinir a senha da sua conta.\n\n" +
        "Abra o link abaixo para criar uma senha nova. Ele vale por 1 hora e só funciona uma vez:\n\n" +
        `${destino}?token_hash=${token}\n\n` +
        "Se não foi você, ignore este e-mail: sua senha continua a mesma."
      );
    }
  } else {
    const supabase = await supabaseServer();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: destino });
  }

  await registrarEvento(request, "recuperacao_pedida", { email });
  return NextResponse.json({
    ok: true,
    mensagem: "Se existir uma conta com este e-mail, enviamos um link para criar uma senha nova. Confira também a caixa de spam.",
  });
}
