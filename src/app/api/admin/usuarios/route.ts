import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator } from "@/lib/authz";
import { SETOR_IDS } from "@/lib/setores";
import { validarSenha } from "@/lib/seguranca/senha";
import { NICHO_IDS, nichoPadrao } from "@/lib/planos";

const setoresValidos = (v: unknown) =>
  Array.isArray(v) ? v.map(String).filter((s) => s !== "diretoria" && (SETOR_IDS as string[]).includes(s)) : [];

const PAPEIS_EQUIPE = ["admin_central", "analista_arini"];
const ORIGENS = ["padrao", "manual", "assinatura"];

/** Cria membro da equipe Arini (login pronto para usar). */
export async function POST(request: Request) {
  const a = await ator();
  if (a?.role !== "admin_central") {
    return NextResponse.json({ error: "Só a diretoria cria acessos da equipe." }, { status: 403 });
  }
  const { email, senha, nome, role, setores } = await request.json().catch(() => ({}));
  if (!email?.trim() || !senha || !nome?.trim()) {
    return NextResponse.json({ error: "Preencha nome, e-mail e senha." }, { status: 400 });
  }
  const erroSenha = validarSenha(String(senha));
  if (erroSenha) return NextResponse.json({ error: erroSenha }, { status: 400 });
  if (!PAPEIS_EQUIPE.includes(role)) {
    return NextResponse.json({ error: "Papel inválido para a equipe." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(), password: senha, email_confirm: true,
    user_metadata: { nome: nome.trim(), role },
  });
  if (error) {
    const msg = /already/i.test(error.message) ? "Já existe conta com este e-mail." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { error: erroPerfil } = await admin.from("profiles").update({
    role, nome: nome.trim(),
    setores: role === "admin_central" ? [] : setoresValidos(setores),
  }).eq("user_id", data.user.id).select("user_id").single();
  if (erroPerfil) {
    const { error: erroDesfazer } = await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({
      error: erroDesfazer
        ? "O login foi criado, mas houve falha ao confirmar o perfil. Confira a conta em Equipe e usuários."
        : "Não foi possível salvar o perfil da equipe. Tente criar a conta novamente.",
    }, { status: 500 });
  }
  await logAudit({
    user_id: a.userId, acao: "usuario_equipe_criado", entidade: "profiles",
    entidade_id: data.user.id, dados_depois: { email, role, setores: role === "admin_central" ? [] : setoresValidos(setores) },
  });
  return NextResponse.json({ ok: true });
}

/**
 * Altera nicho/plano de uma conta externa (planos por nicho, 05/10/2026).
 * O gatilho fn_profile_plano só dispara em update de role/nicho/plan_origem;
 * por isso o nicho vai sempre no mesmo update, mesmo quando não mudou.
 */
async function alterarPlano(a: { userId: string }, perfil: { user_id: string; role: string; nicho: string | null; plan_id: string | null; plan_origem: string; plan_valido_ate: string | null }, body: Record<string, unknown>) {
  const admin = supabaseAdmin();
  const patch: Record<string, unknown> = {};

  let nicho: string | null = perfil.nicho;
  if (body.nicho !== undefined) {
    if (body.nicho === null || body.nicho === "") nicho = nichoPadrao(perfil.role);
    else if (!(NICHO_IDS as string[]).includes(String(body.nicho))) {
      return NextResponse.json({ error: "Nicho inválido." }, { status: 400 });
    } else nicho = String(body.nicho);
  }
  patch.nicho = nicho;

  const origem = body.plan_origem !== undefined ? String(body.plan_origem) : perfil.plan_origem;
  if (!ORIGENS.includes(origem)) return NextResponse.json({ error: "Origem do plano inválida." }, { status: 400 });
  patch.plan_origem = origem;

  if (origem === "padrao") {
    // o gatilho recalcula o plano a partir do nicho
    patch.plan_id = null;
    patch.plan_valido_ate = null;
  } else {
    const planId = body.plan_id !== undefined ? (body.plan_id ? String(body.plan_id) : null) : perfil.plan_id;
    if (!planId) {
      return NextResponse.json({ error: "Escolha o plano.", solucao: "Para voltar ao plano do nicho, use a origem “Padrão do nicho”." }, { status: 400 });
    }
    const { data: plano } = await admin.from("plans").select("id, ativo").eq("id", planId).maybeSingle();
    if (!plano) return NextResponse.json({ error: "Plano não encontrado." }, { status: 400 });
    if (!plano.ativo && planId !== perfil.plan_id) {
      return NextResponse.json({ error: "Este plano está inativo.", solucao: "Reative o plano em Planos e nichos ou escolha outro." }, { status: 400 });
    }
    patch.plan_id = planId;
    if (body.plan_valido_ate !== undefined) {
      if (body.plan_valido_ate === null || body.plan_valido_ate === "") patch.plan_valido_ate = null;
      else {
        const d = new Date(String(body.plan_valido_ate));
        if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Data de validade inválida." }, { status: 400 });
        // fim do dia informado, para o plano valer o dia inteiro
        d.setHours(23, 59, 59, 999);
        patch.plan_valido_ate = d.toISOString();
      }
    }
  }

  const { data: depois, error } = await admin.from("profiles").update(patch).eq("user_id", perfil.user_id)
    .select("nicho, plan_id, plan_origem, plan_valido_ate").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await logAudit({
    user_id: a.userId, acao: "usuario_plano_alterado", entidade: "profiles", entidade_id: perfil.user_id,
    dados_antes: { nicho: perfil.nicho, plan_id: perfil.plan_id, plan_origem: perfil.plan_origem, plan_valido_ate: perfil.plan_valido_ate },
    dados_depois: depois,
  });
  return NextResponse.json({ ok: true, ...depois });
}

/** Muda papel ou ativa/desativa um membro; nicho/plano de uma conta externa. */
export async function PATCH(request: Request) {
  const a = await ator();
  if (a?.role !== "admin_central") {
    return NextResponse.json({ error: "Só a diretoria altera acessos." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const { user_id, role, ativo, setores } = body;
  if (!user_id) return NextResponse.json({ error: "Informe a conta." }, { status: 400 });
  if (user_id === a.userId && (role === "analista_arini" || ativo === false)) {
    return NextResponse.json({ error: "Você não pode remover o próprio acesso de diretoria." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // campos de plano: só para contas externas (a equipe tem tudo pelo papel)
  const mexePlano = ["nicho", "plan_id", "plan_origem", "plan_valido_ate"].some((k) => body[k] !== undefined);
  if (mexePlano) {
    const { data: perfil } = await admin.from("profiles")
      .select("user_id, role, nicho, plan_id, plan_origem, plan_valido_ate").eq("user_id", user_id).maybeSingle();
    if (!perfil) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
    if (PAPEIS_EQUIPE.includes(perfil.role)) {
      return NextResponse.json({ error: "A equipe da Arini não usa plano: o papel libera tudo." }, { status: 400 });
    }
    return alterarPlano(a, perfil, body);
  }

  const patch: Record<string, unknown> = {};
  if (role) {
    if (!PAPEIS_EQUIPE.includes(role)) return NextResponse.json({ error: "Papel inválido." }, { status: 400 });
    patch.role = role;
  }
  if (typeof ativo === "boolean") patch.ativo = ativo;
  if (setores !== undefined) patch.setores = setoresValidos(setores);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });

  const { error } = await admin.from("profiles").update(patch).eq("user_id", user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await logAudit({
    user_id: a.userId, acao: "usuario_equipe_alterado", entidade: "profiles",
    entidade_id: user_id, dados_depois: patch,
  });
  return NextResponse.json({ ok: true });
}
