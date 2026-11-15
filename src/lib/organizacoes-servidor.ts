import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { Plano } from "@/lib/planos";
import type { MembroOrg, Organizacao } from "@/lib/organizacoes";

/** Vínculo ativo da conta com uma organização (no máximo um, índice único). */
export async function organizacaoDoUsuario(userId: string): Promise<{ org: Organizacao; membro: MembroOrg } | null> {
  const admin = supabaseAdmin();
  const { data: membro } = await admin.from("organization_members")
    .select("id, org_id, user_id, email, papel_org, status, convidado_em, aceito_em, nicho_vinculo")
    .eq("user_id", userId).eq("status", "ativo").maybeSingle();
  if (!membro) return null;
  const { data: org } = await admin.from("organizations")
    .select("id, nome, cnpj, tipo, plan_id, plan_valido_ate, region_id, ativo").eq("id", membro.org_id).maybeSingle();
  if (!org) return null;
  return { org: org as Organizacao, membro: membro as MembroOrg };
}

/**
 * Plano que a organização empresta à conta. Só vale quando: a conta é membro
 * ativo; a organização está ativa; o plano existe, está ativo, tem escopo
 * "organizacao" e não venceu. Quem decide se ele vence o plano pessoal é
 * `acessoDe()`/`ator()` — só quando o pessoal é o padrão do nicho.
 */
export async function planoDaOrganizacao(userId: string): Promise<{ plano: Plano; validoAte: string | null; orgNome: string } | null> {
  const [vinculo, {data:contexto}] = await Promise.all([organizacaoDoUsuario(userId),
    supabaseAdmin().from("profiles").select("nicho").eq("user_id",userId).maybeSingle()]);
  if (!contexto || vinculo?.membro.nicho_vinculo && vinculo.membro.nicho_vinculo!==contexto.nicho) return null;
  if (!vinculo || !vinculo.org.ativo || !vinculo.org.plan_id) return null;
  const venceu = vinculo.org.plan_valido_ate && new Date(vinculo.org.plan_valido_ate).getTime() < Date.now();
  if (venceu) return null;
  const { data: plano } = await supabaseAdmin().from("plans").select("*").eq("id", vinculo.org.plan_id).maybeSingle();
  if (!plano || !plano.ativo || plano.escopo !== "organizacao") return null;
  return { plano: plano as Plano, validoAte: vinculo.org.plan_valido_ate, orgNome: vinculo.org.nome };
}

/** Convites pendentes para este e-mail (organização ativa). */
export async function convitesPendentes(email: string | null | undefined) {
  if (!email) return [];
  const { data } = await supabaseAdmin().from("organization_members")
    .select("id, org_id, papel_org, convidado_em, org:organizations(nome, tipo, ativo)")
    .eq("status", "pendente").eq("email", email.trim().toLowerCase())
    .order("convidado_em");
  return (data ?? [])
    .map((c) => ({ ...c, org: c.org as unknown as { nome: string; tipo: string; ativo: boolean } | null }))
    .filter((c) => c.org?.ativo);
}

/**
 * Aceita um convite: liga a conta à organização. Falha se a conta já é membro
 * ativo de outra (uma por vez). Devolve o nome da organização ou o motivo.
 */
export async function aceitarConvite(conviteId: string, userId: string, email: string): Promise<{ ok: true; org: string } | { ok: false; erro: string }> {
  const admin = supabaseAdmin();
  const { data: c } = await admin.from("organization_members")
    .select("id, org_id, email, status, org:organizations(nome, ativo)").eq("id", conviteId).maybeSingle();
  const org = c?.org as unknown as { nome: string; ativo: boolean } | null;
  if (!c || c.status !== "pendente" || c.email.toLowerCase() !== email.toLowerCase() || !org?.ativo) {
    return { ok: false, erro: "Convite não encontrado ou não é mais válido." };
  }
  const atual = await organizacaoDoUsuario(userId);
  if (atual) return { ok: false, erro: `Você já faz parte de ${atual.org.nome}. Saia dela antes de aceitar outro convite.` };

  const { error } = await admin.from("organization_members")
    .update({ user_id: userId, status: "ativo", aceito_em: new Date().toISOString() }).eq("id", c.id).eq("status", "pendente");
  if (error) return { ok: false, erro: "Não foi possível aceitar o convite agora." };
  await logAudit({ user_id: userId, acao: "organizacao_convite_aceito", entidade: "organization_members", entidade_id: c.id, dados_depois: { org_id: c.org_id } });
  return { ok: true, org: org.nome };
}

/**
 * Chamado no login (fire-and-forget): se a conta ainda não está em nenhuma
 * organização e há convite pendente para o e-mail dela, aceita o mais antigo.
 * Os demais continuam pendentes e aparecem em /conta. Nunca lança.
 */
export async function vincularConvites(userId: string, email: string | null | undefined) {
  try {
    if (!email) return;
    const pendentes = await convitesPendentes(email);
    if (!pendentes.length) return;
    if (await organizacaoDoUsuario(userId)) return;
    await aceitarConvite(pendentes[0].id, userId, email);
  } catch (e) {
    console.error("vincularConvites falhou:", e);
  }
}
