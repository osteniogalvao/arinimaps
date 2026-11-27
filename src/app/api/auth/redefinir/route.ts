import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { registrarEvento } from "@/lib/seguranca/eventos";
import { validarSenha } from "@/lib/seguranca/senha";
import { avisarRecuperacaoEquipe, segundaEtapaRecuperacao, sessaoPorSenha } from "@/lib/seguranca/recuperacao";

/**
 * Grava a senha nova. Vale para duas situações, e nas duas exige sessão:
 *  · recuperação — a sessão veio do link de uso único (/redefinir-senha);
 *  · troca voluntária — o usuário logado informa também a senha atual.
 * Ao trocar, as OUTRAS sessões da conta são encerradas: quem tinha a senha
 * antiga aberta em outro aparelho cai fora.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const senha = String(body?.senha ?? "");
  const senhaAtual = body?.senha_atual ? String(body.senha_atual) : null;

  const erroSenha = validarSenha(senha);
  if (erroSenha) return NextResponse.json({ error: erroSenha }, { status: 400 });

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "O link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”." },
      { status: 401 }
    );
  }

  // Sem a senha atual, só vale a sessão aberta pelo LINK de recuperação. Uma
  // sessão de login comum (talvez roubada) não troca a senha sem saber a atual.
  if (senhaAtual === null && (await sessaoPorSenha(supabase))) {
    return NextResponse.json({ error: "Informe a senha atual para trocar a senha." }, { status: 400 });
  }

  // 6.7: conta da equipe recuperando a senha passa pela etapa extra
  // (código do autenticador ou código no e-mail)
  const etapa = senhaAtual === null
    ? await segundaEtapaRecuperacao(supabase, user, body?.codigo ? String(body.codigo) : null)
    : null;
  if (etapa && !etapa.ok) return etapa.resposta;

  if (senhaAtual !== null) {
    const { error: reauth } = await supabase.auth.signInWithPassword({ email: user.email!, password: senhaAtual });
    if (reauth) return NextResponse.json({ error: "A senha atual não confere." }, { status: 400 });
  }

  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) {
    const msg = /different from the old/i.test(error.message)
      ? "A senha nova precisa ser diferente da atual."
      : /aal2/i.test(error.message)
        ? "Confirme o segundo fator antes de trocar a senha."
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  await supabase.auth.signOut({ scope: "others" });

  await registrarEvento(request, senhaAtual !== null ? "senha_alterada" : "senha_redefinida", {
    userId: user.id, email: user.email, detalhe: etapa?.ok && etapa.equipe ? { equipe: true, via: etapa.via } : undefined,
  });
  if (etapa?.ok && etapa.equipe && etapa.via === "convite") {
    // senha criada: o próximo link já é recuperação comum, com a etapa extra
    await supabaseAdmin().auth.admin.updateUserById(user.id, { app_metadata: { primeiro_acesso: null } }).catch(() => undefined);
  } else if (etapa?.ok && etapa.equipe) await avisarRecuperacaoEquipe(request, user, etapa);
  return NextResponse.json({ ok: true });
}
