import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { lerConfiguracoes } from "@/lib/settings";
import { conferirRecurso, respostaNegacao } from "@/lib/planos-servidor";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { avaliarImovel, versaoPublica } from "@/lib/avaliacao/servidor";

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pré-avaliação de valor e/ou aptidão territorial de um imóvel
 * (PENDÊNCIAS 5.3 e 5.4; metodologia em docs/PRE-AVALIACAO.md).
 *
 * Corpo: { "tipo": "pre_avaliacao" | "aptidao" | "ambos" } (padrão: ambos).
 *
 * Quem pode:
 *  · equipe da Matriz — sempre, inclusive com a função desligada, para validar a
 *    metodologia antes de liberar (decisão 8.4);
 *  · demais contas — só com a função ligada pela Diretoria (Configurações ›
 *    Inteligência); a vitrine é comum a todas as contas. No próprio anúncio
 *    privado a regra do plano continua valendo.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/avaliacao/[propertyId]">) {
  const { propertyId } = await ctx.params;
  if (!UUID.test(propertyId)) return falha(400, "id_invalido", "Imóvel inválido.");

  const corpo = await request.json().catch(() => ({})) as { tipo?: string };
  const tipo = corpo.tipo === "pre_avaliacao" || corpo.tipo === "aptidao" ? corpo.tipo : "ambos";

  const a = await ator();
  if (!a) return falha(401, "login_necessario", "Entre para consultar a avaliação.");
  const equipe = a.ehArini;

  const { data: imovel } = await supabaseAdmin().from("properties")
    .select("id, codigo, tipo, status, owner_id, partner_id").eq("id", propertyId).maybeSingle();
  if (!imovel) return falha(404, "nao_encontrado", "Imóvel não encontrado.");

  let quer = { pre: tipo !== "aptidao", aptidao: tipo !== "pre_avaliacao" && imovel.tipo === "rural" };
  if (!equipe) {
    const dono = (!!a?.ownerId && imovel.owner_id === a.ownerId) || (!!a?.partnerId && imovel.partner_id === a.partnerId);
    if (!["publicado", "em_negociacao"].includes(imovel.status)) {
      if (!dono) return falha(404, "nao_encontrado", "Imóvel não encontrado.");
      const { negacao } = await conferirRecurso(request, { id: a.userId, role: a.role }, "pre_avaliacao");
      if (negacao) return respostaNegacao(negacao);
    }
    const cfg = await lerConfiguracoes();
    quer = { pre: quer.pre && cfg.pre_avaliacao_ativa === true, aptidao: quer.aptidao && cfg.aptidao_ativa === true };
    if (!quer.pre && !quer.aptidao) {
      return falha(403, "avaliacao_desligada", "A pré-avaliação ainda não está liberada.", {
        motivo: "A metodologia está em validação pela Arini.",
        solucao: "Fale com a Arini pelo botão de interesse do imóvel.",
      });
    }
  }
  if (!quer.pre && !quer.aptidao) {
    return falha(400, "nada_a_avaliar", "Nada a calcular para este imóvel.", { motivo: "A aptidão territorial vale só para imóveis rurais." });
  }

  const limite = await limitar(`avaliacao:${a.userId}`, equipe ? 60 : 10, 600);
  if (!limite.permitido) return respostaLimite(limite, "avaliação");

  try {
    const r = await avaliarImovel(propertyId, a.userId, quer);
    if (!r) return falha(404, "nao_encontrado", "Imóvel não encontrado.");
    await logAudit({
      user_id: a.userId, acao: "avaliacao_calculada", entidade: "avaliacoes",
      entidade_id: r.pre_avaliacao?.id || (r.aptidao && "id" in r.aptidao ? r.aptidao.id : null) || null,
      property_id: propertyId,
      dados_depois: {
        tipo, situacao: r.pre_avaliacao?.situacao ?? null,
        indicacao: r.aptidao && "indicacao" in r.aptidao ? r.aptidao.indicacao : null,
        metodologia: r.pre_avaliacao?.metodologia_versao ?? (r.aptidao && "metodologia_versao" in r.aptidao ? r.aptidao.metodologia_versao : null),
      },
    });
    return NextResponse.json(equipe ? r : versaoPublica(r));
  } catch (e) {
    return falha(500, "avaliacao_falhou", "Não foi possível calcular agora.", {
      motivo: e instanceof Error ? e.message : String(e),
      solucao: "Tente de novo em alguns minutos. Se repetir, avise o desenvolvedor.",
    });
  }
}
