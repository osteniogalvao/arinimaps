import "server-only";
import { acessoComMatriz } from "@/lib/direitos-persona-servidor";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { setoresDe, type SetorId } from "@/lib/setores";
import { type Acesso, type Plano, type RecursoId } from "@/lib/planos";
import { planoDaOrganizacao } from "@/lib/organizacoes-servidor";
import { lerConfiguracoes } from "@/lib/settings";

export type Ator = {
  userId: string;
  role: string;
  ehArini: boolean;
  partnerId: string | null;
  parceiroAtivo?: boolean;
  ownerId: string | null;
  /** setores da Matriz em que o membro da equipe atua (diretoria: todos) */
  setores: SetorId[];
  /** nicho comercial da conta (planos por nicho, 05/10/2026) */
  nicho: string | null;
  /** plano + recursos já resolvidos; a equipe tem tudo pelo papel */
  acesso: Acesso;
};

/** O ator tem este recurso no plano (ou é da equipe)? */
export function temRecurso(a: Ator | null | undefined, recurso: RecursoId) {
  return !!a?.acesso.recursos.has(recurso);
}

/** O ator é da equipe e atua neste setor? Diretoria atua em todos. */
export function temSetor(a: Ator | null | undefined, ...setores: SetorId[]) {
  return !!a?.ehArini && setores.some((s) => a.setores.includes(s));
}

/**
 * A sessão ainda não passou pelo segundo fator exigido? Mesma regra do
 * layout da Central: conta com MFA ativo e sessão em aal1 → pendente; com
 * `seguranca_mfa_equipe` ligado, membro da equipe sem MFA → pendente.
 * Sem MFA e com a exigência desligada, nada muda.
 */
export async function mfaPendente(supabase: Awaited<ReturnType<typeof supabaseServer>>, equipe: boolean) {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") return true;
  if (equipe && aal?.nextLevel !== "aal2") {
    const cfg = await lerConfiguracoes();
    if (cfg.seguranca_mfa_equipe === true) return true;
  }
  return false;
}

/** Usuário logado + vínculos (partner/owner). null = sem sessão. */
export async function ator(): Promise<Ator | null> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const { data: profile } = await admin.from("profiles")
    .select("role, setores, ativo, nicho, entrada_ativa, plan_id, plan_valido_ate, plan_origem").eq("user_id", user.id).single();
  if (!profile || profile.ativo === false) return null;
  const equipe = ["admin_central", "analista_arini"].includes(profile.role);
  // Segundo fator também nas APIs (testes 9.5), com a mesma regra da Central
  // (src/app/admin/layout.tsx): quem tem MFA precisa tê-lo confirmado nesta
  // sessão; se a diretoria o tornou obrigatório, equipe sem MFA não opera.
  if (await mfaPendente(supabase, equipe)) return null;
  const [{ data: partner }, { data: owner }, { data: planoPessoal }, daOrg] = await Promise.all([
    ["corretor","imobiliaria","engenheiro","franqueado","leiloeiro"].includes(profile.role)
      ? admin.from("partners").select("id,status").eq("profile_id", user.id).eq("tipo",profile.role).maybeSingle() : Promise.resolve({ data:null }),
    profile.role === "proprietario" ? admin.from("owners").select("id").eq("profile_id", user.id).maybeSingle() : Promise.resolve({ data:null }),
    profile.plan_id ? admin.from("plans").select("*").eq("id", profile.plan_id).maybeSingle() : Promise.resolve({ data: null }),
    // 5.9: plano da organização vale quando o pessoal é o padrão do nicho (docs/PLANOS.md §10)
    !equipe && (profile.plan_origem ?? "padrao") === "padrao" ? planoDaOrganizacao(user.id) : Promise.resolve(null),
  ]);
  const plano = daOrg?.plano ?? planoPessoal;
  const validoAte = daOrg ? daOrg.validoAte : (profile.plan_valido_ate as string | null);
  return {
    userId: user.id,
    role: profile.role,
    ehArini: ["admin_central", "analista_arini"].includes(profile.role),
    setores: ["admin_central", "analista_arini"].includes(profile.role)
      ? setoresDe(profile.role, profile.setores as string[] | null)
      : [],
    partnerId: partner?.id ?? null,
    parceiroAtivo: !!partner && ["aprovado","ativo"].includes(partner.status),
    ownerId: owner?.id ?? null,
    nicho: (profile.nicho as string | null) ?? null,
    acesso: await acessoComMatriz(profile.role, (plano as Plano | null) ?? null, profile.nicho as string | null, validoAte, profile.entrada_ativa, user.id),
  };
}

/** Pode operar esta oportunidade? Arini nos setores Comercial/Jurídico/Financeiro; parceiro A/B; o proprietário acompanha só os indicadores do imóvel. */
export async function podeOperarOportunidade(a: Ator, opportunityId: string) {
  // equipe: Comercial conduz; Jurídico e Financeiro atuam no contrato e na venda (docs/SEGURANCA.md §2.1)
  if (a.ehArini) return temSetor(a, "comercial", "juridico", "financeiro");
  if (!a.partnerId || !a.parceiroAtivo) return false;
  const admin = supabaseAdmin();
  const { data: opp } = await admin
    .from("opportunities")
    .select("responsavel_tipo, responsavel_partner_id, partner_comprador_id")
    .eq("id", opportunityId)
    .single();
  return !!opp && ((opp.responsavel_tipo === "parceiro" && opp.responsavel_partner_id === a.partnerId) || opp.partner_comprador_id === a.partnerId);
}
