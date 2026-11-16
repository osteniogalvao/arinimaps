import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { TIPOS_ORG, emailValido } from "@/lib/organizacoes";

/**
 * Organizações pela Matriz (5.9) — setores Diretoria e Comercial.
 *
 * POST acao=criar | convidar | remover_membro | papel
 * PATCH { id, nome?, cnpj?, tipo?, plan_id?, plan_valido_ate?, region_id?, ativo?, observacoes? }
 */
async function exigir() {
  const a = await ator();
  if (!a) return { a: null, erro: falha(401, "sem_sessao", "Sessão expirada.") };
  if (!temSetor(a, "diretoria", "comercial")) {
    return { a: null, erro: falha(403, "sem_setor", "Organizações são dos setores Diretoria e Comercial.") };
  }
  return { a, erro: null };
}

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

async function validarCampos(b: Record<string, unknown>, parcial: boolean) {
  const patch: Record<string, unknown> = {};
  if (b.nome !== undefined || !parcial) {
    const nome = String(b.nome ?? "").replace(/\s+/g, " ").trim();
    if (nome.length < 2) return { erro: "Informe o nome da organização." };
    patch.nome = nome.slice(0, 160);
  }
  if (b.cnpj !== undefined) {
    const cnpj = soDigitos(b.cnpj);
    if (cnpj && cnpj.length !== 14) return { erro: "CNPJ deve ter 14 dígitos." };
    patch.cnpj = cnpj || null;
  }
  if (b.tipo !== undefined || !parcial) {
    const tipo = String(b.tipo ?? "imobiliaria");
    if (!(TIPOS_ORG as readonly string[]).includes(tipo)) return { erro: "Tipo de organização inválido." };
    patch.tipo = tipo;
  }
  if (b.plan_id !== undefined) {
    const planId = String(b.plan_id ?? "");
    if (planId) {
      const { data: plano } = await supabaseAdmin().from("plans").select("id, ativo").eq("id", planId).maybeSingle();
      if (!plano?.ativo) return { erro: "Plano inexistente ou inativo." };
    }
    patch.plan_id = planId || null;
  }
  if (b.plan_valido_ate !== undefined) {
    const v = String(b.plan_valido_ate ?? "");
    if (v && Number.isNaN(Date.parse(v))) return { erro: "Validade inválida." };
    patch.plan_valido_ate = v ? new Date(v).toISOString() : null;
  }
  if (b.region_id !== undefined) patch.region_id = b.region_id ? String(b.region_id) : null;
  if (b.ativo !== undefined) patch.ativo = b.ativo === true;
  if (b.observacoes !== undefined) patch.observacoes = String(b.observacoes ?? "").slice(0, 2000) || null;
  return { patch };
}

async function convidar(orgId: string, orgNome: string, email: string, papel: "admin" | "membro", por: string) {
  const admin = supabaseAdmin();
  const { data: existente } = await admin.from("organization_members").select("id, status")
    .eq("org_id", orgId).eq("email", email).in("status", ["pendente", "ativo"]).maybeSingle();
  if (existente) return { erro: existente.status === "ativo" ? "Esta pessoa já é membro." : "Já existe convite pendente para este e-mail." };
  const { data, error } = await admin.from("organization_members")
    .insert({ org_id: orgId, email, papel_org: papel, status: "pendente", convidado_por: por }).select("id").single();
  if (error) return { erro: error.message };
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  sendEmail(email, `Convite para ${orgNome} na ARINI`,
    `A Arini cadastrou ${orgNome} e convidou você${papel === "admin" ? " como administrador" : ""}.\n\n` +
    `Entre (ou crie a conta) com este e-mail em ${site}/entrar — o convite é aceito no login.`).catch(() => undefined);
  return { id: data.id as string };
}

export async function POST(request: Request) {
  const { a, erro } = await exigir();
  if (!a) return erro;
  const b = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();

  if (b.acao === "criar") {
    const v = await validarCampos(b, false);
    if ("erro" in v) return falha(400, "dados_invalidos", v.erro!);
    const { data: org, error } = await admin.from("organizations")
      .insert({ ...v.patch, created_by: a.userId }).select("id, nome").single();
    if (error) {
      return falha(error.code === "23505" ? 409 : 500, "erro_banco",
        error.code === "23505" ? "Já existe organização com este CNPJ." : "Não foi possível criar.", { motivo: error.message });
    }
    await logAudit({ user_id: a.userId, acao: "organizacao_criada", entidade: "organizations", entidade_id: org.id, dados_depois: v.patch });
    const emailAdmin = String(b.admin_email ?? "").trim().toLowerCase();
    if (emailAdmin && emailValido(emailAdmin)) await convidar(org.id, org.nome, emailAdmin, "admin", a.userId);
    return NextResponse.json({ ok: true, id: org.id });
  }

  if (b.acao === "convidar") {
    const { data: org } = await admin.from("organizations").select("id, nome").eq("id", String(b.org_id ?? "")).maybeSingle();
    if (!org) return falha(404, "org_nao_encontrada", "Organização não encontrada.");
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!emailValido(email)) return falha(400, "email_invalido", "Informe um e-mail válido.");
    const r = await convidar(org.id, org.nome, email, b.papel_org === "admin" ? "admin" : "membro", a.userId);
    if ("erro" in r) return falha(409, "convite_recusado", r.erro!);
    await logAudit({ user_id: a.userId, acao: "organizacao_convite", entidade: "organization_members", entidade_id: r.id, dados_depois: { org_id: org.id, email } });
    return NextResponse.json({ ok: true });
  }

  if (b.acao === "remover_membro" || b.acao === "papel") {
    const { data: m } = await admin.from("organization_members").select("id, org_id, status").eq("id", String(b.membro_id ?? "")).maybeSingle();
    if (!m) return falha(404, "membro_nao_encontrado", "Membro não encontrado.");
    const patch = b.acao === "papel"
      ? { papel_org: b.papel_org === "admin" ? "admin" : "membro" }
      : { status: "removido", removido_em: new Date().toISOString() };
    await admin.from("organization_members").update(patch).eq("id", m.id);
    await logAudit({ user_id: a.userId, acao: b.acao === "papel" ? "organizacao_papel_alterado" : "organizacao_membro_removido", entidade: "organization_members", entidade_id: m.id, dados_depois: patch });
    return NextResponse.json({ ok: true });
  }
  return falha(400, "acao_invalida", "Ação inválida.");
}

export async function PATCH(request: Request) {
  const { a, erro } = await exigir();
  if (!a) return erro;
  const b = await request.json().catch(() => ({}));
  const id = String(b.id ?? "");
  const admin = supabaseAdmin();
  const { data: antes } = await admin.from("organizations").select("*").eq("id", id).maybeSingle();
  if (!antes) return falha(404, "org_nao_encontrada", "Organização não encontrada.");
  const v = await validarCampos(b, true);
  if ("erro" in v) return falha(400, "dados_invalidos", v.erro!);
  if (!Object.keys(v.patch).length) return falha(400, "nada_para_alterar", "Nada para alterar.");
  const { error } = await admin.from("organizations").update(v.patch).eq("id", id);
  if (error) return falha(error.code === "23505" ? 409 : 500, "erro_banco", "Não foi possível salvar.", { motivo: error.message });
  await logAudit({ user_id: a.userId, acao: "organizacao_alterada", entidade: "organizations", entidade_id: id, dados_antes: antes, dados_depois: v.patch });
  return NextResponse.json({ ok: true });
}
