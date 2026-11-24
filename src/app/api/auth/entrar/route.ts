import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";
import { registrarEvento } from "@/lib/seguranca/eventos";
import { analisarEntrada, analisarFalha } from "@/lib/seguranca/alertas";
import { vincularConvites } from "@/lib/organizacoes-servidor";

/**
 * Login pelo servidor, e não direto do navegador para o Supabase, por três
 * motivos pedidos nos requisitos de segurança (01/10/2026):
 *  · contar tentativas por IP e por e-mail (força bruta e credential stuffing);
 *  · registrar toda tentativa, certa ou errada (auth_events);
 *  · ter um ponto único onde o segundo fator é exigido.
 *
 * Dois limites, de propósito diferentes: o do IP pega o robô que testa muitas
 * contas; o do e-mail pega muitos IPs testando a mesma conta. O do e-mail é
 * uma janela curta — bloquear a conta por horas viraria arma para trancar o
 * dono do lado de fora.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const senha = String(body?.senha ?? "");
  if (!email || !senha) {
    return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  const ip = ipDoPedido(request);
  const [porIp, porEmail] = await Promise.all([
    limitar(`login:ip:${ip}`, 30, 600),
    limitar(`login:email:${email}`, 8, 900),
  ]);
  if (!porIp.permitido || !porEmail.permitido) {
    await registrarEvento(request, "login_bloqueado", { email });
    return respostaLimite(!porIp.permitido ? porIp : porEmail, "login");
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) {
    await registrarEvento(request, "login_falhou", { email });
    await analisarFalha(request, email); // 6.8: excesso de falhas vira alerta
    // mesma mensagem para e-mail inexistente e senha errada: não revela quem tem conta
    return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin()
    .from("profiles").select("role, ativo, entrada_ativa").eq("user_id", data.user.id).single();
  if (profileError || !profile) {
    // A senha foi validada, mas o perfil ainda não: não inventar um papel nem
    // manter a sessão criada por esta tentativa quando o banco está indisponível.
    await supabase.auth.signOut({ scope: "local" });
    await registrarEvento(request, "login_bloqueado", { userId: data.user.id, email, detalhe: { motivo: "perfil indisponível" } });
    return NextResponse.json({ error: "Não foi possível consultar sua conta agora. Tente entrar novamente em instantes." }, { status: 503 });
  }
  if (profile.ativo === false) {
    await supabase.auth.signOut();
    await registrarEvento(request, "login_bloqueado", { userId: data.user.id, email, detalhe: { motivo: "conta desativada" } });
    return NextResponse.json({ error: "Esta conta está desativada. Fale com a Arini." }, { status: 403 });
  }

  // segundo fator: se a conta tem MFA ativo, a sessão ainda está em aal1
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const precisaMfa = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";

  // 6.8: aparelho ou local novo, ou entrada logo após várias falhas — compara
  // com os logins anteriores, por isso roda antes de gravar este
  await analisarEntrada(request, data.user.id, email);
  await registrarEvento(request, "login_ok", { userId: data.user.id, email, detalhe: { mfa_pendente: precisaMfa } });
  // 5.9: convite pendente de organização para este e-mail vira vínculo (não atrasa o login)
  void vincularConvites(data.user.id, email);
  return NextResponse.json({ ok: true, role: profile.role, entradaAtiva: profile.entrada_ativa, escolherPerfil: !profile.entrada_ativa && !["admin_central","analista_arini","franqueado"].includes(profile.role), mfa: precisaMfa });
}
