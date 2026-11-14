import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { ipDoPedido } from "@/lib/seguranca/limite";
import { ACESSO_VISITANTE, montarAcesso, recursoPorId, type Acesso, type Plano, type RecursoId } from "@/lib/planos";
import { planoDaOrganizacao } from "@/lib/organizacoes-servidor";
import { podeAnunciar } from "@/lib/perfis";

/**
 * A trava dos planos, no servidor.
 *
 * Fluxograma §20: LOGIN → CARREGA PERMISSÕES → TENTA ACESSAR RECURSO → TEM
 * PERMISSÃO? SIM → ACESSA · NÃO → BLOQUEIA → REGISTRA TENTATIVA. Toda negação
 * cai em `access_attempts`; a tela de Segurança da Central lê de lá.
 */

export async function carregarPlano(planId: string | null | undefined): Promise<Plano | null> {
  if (!planId) return null;
  const { data } = await supabaseAdmin().from("plans").select("*").eq("id", planId).maybeSingle();
  return (data as Plano | null) ?? null;
}

/** Acesso resolvido de um usuário (plano + papel). Sem usuário = visitante. */
export async function acessoDe(userId: string | null | undefined): Promise<Acesso> {
  if (!userId) return ACESSO_VISITANTE;
  const admin = supabaseAdmin();
  const { data: p } = await admin.from("profiles")
    .select("role, nicho, plan_id, plan_valido_ate, plan_origem, ativo").eq("user_id", userId).maybeSingle();
  if (!p || p.ativo === false) return ACESSO_VISITANTE;
  // 5.9: membro de organização com plano usa o plano dela enquanto o pessoal
  // for o padrão do nicho; plano manual/assinatura da conta vence (docs/PLANOS.md §10)
  const equipe = ["admin_central", "analista_arini"].includes(p.role);
  if (!equipe && (p.plan_origem ?? "padrao") === "padrao") {
    const daOrg = await planoDaOrganizacao(userId);
    if (daOrg) return montarAcesso(p.role, daOrg.plano, p.nicho, daOrg.validoAte);
  }
  const plano = await carregarPlano(p.plan_id);
  return montarAcesso(p.role, plano, p.nicho, p.plan_valido_ate);
}

/** Acesso de quem está na sessão atual (páginas). */
export async function acessoAtual(): Promise<{ userId: string | null; acesso: Acesso }> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return { userId: user?.id ?? null, acesso: await acessoDe(user?.id) };
}

export type Negacao = { codigo: "sem_sessao" | "sem_plano" | "perfil_incompativel" | "cota_esgotada" | "consulta_indisponivel"; mensagem: string; solucao: string };

/** Registra a tentativa negada (append-only). Nunca lança. */
export async function registrarTentativa(dados: {
  request?: Request | null; userId?: string | null; role?: string | null; planId?: string | null;
  recurso: string; motivo: string;
}) {
  try {
    await supabaseAdmin().from("access_attempts").insert({
      user_id: dados.userId ?? null, role: dados.role ?? null, plan_id: dados.planId ?? null,
      recurso: dados.recurso, motivo: dados.motivo,
      rota: dados.request ? new URL(dados.request.url).pathname : null,
      ip: dados.request ? ipDoPedido(dados.request) : null,
    });
  } catch (e) {
    console.error("access_attempts falhou:", e);
  }
}

/** Quantas consultas de área a conta já fez no mês corrente. */
export async function consultasAreaNoMes(userId: string): Promise<number> {
  const inicio = new Date();
  inicio.setDate(1); inicio.setHours(0, 0, 0, 0);
  const { count } = await supabaseAdmin().from("consultas_area_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("acao", "consulta").gte("created_at", inicio.toISOString());
  return count ?? 0;
}

/** Imóveis da conta em análise ou publicados (cota `imoveis_ativos`). */
export async function imoveisAtivosDe(userId: string): Promise<number> {
  const admin = supabaseAdmin();
  const [owner, partner] = await Promise.all([
    admin.from("owners").select("id").eq("profile_id", userId).maybeSingle(),
    admin.from("partners").select("id").eq("profile_id", userId).maybeSingle(),
  ]);
  if (owner.error || partner.error) throw new Error("Não foi possível consultar o anunciante.");
  const filtros = [
    owner.data && `and(partner_id.is.null,owner_id.eq.${owner.data.id})`,
    partner.data && `partner_id.eq.${partner.data.id}`,
  ].filter(Boolean);
  if (!filtros.length) return 0;
  const { count, error } = await admin.from("properties").select("id", { count: "exact", head: true })
    .in("status", ["pendente", "em_analise", "correcao", "aprovado", "publicado", "em_negociacao"])
    .or(filtros.join(","));
  if (error || count === null) throw new Error("Não foi possível consultar a cota de imóveis.");
  return count;
}

/**
 * Confere um recurso e, se houver cota, o consumo do mês. Devolve a negação
 * (já registrada) ou null quando pode seguir. Para rotas de API.
 */
export async function conferirRecurso(
  request: Request | null,
  user: { id: string; role: string } | null,
  recurso: RecursoId,
  opcoes: { cota?: "consultas_area_mes" | "imoveis_ativos"; quantidade?: number; acesso?: Acesso } = {}
): Promise<{ acesso: Acesso; negacao: Negacao | null }> {
  const acesso = opcoes.acesso ?? await acessoDe(user?.id);
  const nome = recursoPorId(recurso)?.nome ?? recurso;

  if (!acesso.recursos.has(recurso)) {
    const negacao: Negacao = !user
      ? { codigo: "sem_sessao", mensagem: `Entre na sua conta para usar “${nome}”.`, solucao: "Crie uma conta gratuita ou entre com a sua." }
      : recurso === "anunciar" && !podeAnunciar(user.role, acesso.nicho)
      ? { codigo: "perfil_incompativel", mensagem: "O seu perfil não permite cadastrar anúncios.", solucao: "Fale com a Arini se também atua como anunciante." }
      : { codigo: "sem_plano", mensagem: `“${nome}” não está no seu plano${acesso.planNome ? ` (${acesso.planNome})` : ""}.`,
          solucao: "Veja os planos em /planos ou fale com a Arini para liberar." };
    await registrarTentativa({ request, userId: user?.id, role: user?.role, planId: acesso.planId, recurso, motivo: negacao.codigo });
    return { acesso, negacao };
  }

  if (opcoes.cota && user && !acesso.equipe && acesso.cotas[opcoes.cota] != null) {
    const limite = Number(acesso.cotas[opcoes.cota]);
    const usado = opcoes.cota === "consultas_area_mes" ? await consultasAreaNoMes(user.id) : await imoveisAtivosDe(user.id).catch(() => null);
    if (usado === null) return { acesso, negacao: { codigo: "consulta_indisponivel", mensagem: "Não foi possível conferir a cota de imóveis.", solucao: "Tente novamente em instantes." } };
    if (usado + (opcoes.quantidade ?? 1) > limite) {
      const negacao: Negacao = {
        codigo: "cota_esgotada",
        mensagem: opcoes.cota === "consultas_area_mes"
          ? `Você já usou as ${limite} consultas de área do mês no plano ${acesso.planNome}.`
          : `Seu plano ${acesso.planNome} permite ${limite} imóveis ativos ao mesmo tempo.`,
        solucao: opcoes.cota === "imoveis_ativos" ? "Reduza a quantidade de anúncios ativos ou fale com a Arini para ampliar o plano." : "Fale com a Arini para ampliar o plano ou aguarde o próximo mês.",
      };
      await registrarTentativa({ request, userId: user.id, role: user.role, planId: acesso.planId, recurso, motivo: `cota:${opcoes.cota}` });
      return { acesso, negacao };
    }
  }
  return { acesso, negacao: null };
}

/** Resposta HTTP padronizada para uma negação. */
export function respostaNegacao(n: Negacao) {
  return NextResponse.json(
    { error: n.mensagem, solucao: n.solucao, codigo: n.codigo },
    { status: n.codigo === "sem_sessao" ? 401 : n.codigo === "consulta_indisponivel" ? 503 : 403 }
  );
}
