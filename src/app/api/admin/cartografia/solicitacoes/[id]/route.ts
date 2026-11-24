import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { registrarTentativa } from "@/lib/planos-servidor";
import { falha, falhaBanco } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { ehEquipe } from "@/lib/perfis";
import {
  ehStatusSolicitacao, STATUS_SOLICITACAO_LABEL, TRANSICOES, type StatusSolicitacao,
} from "@/lib/cartografia/solicitacoes";
import { avisarSolicitante, geojsonDaSolicitacao } from "@/lib/cartografia/servidor";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mudanças de status que o solicitante precisa saber por e-mail. */
const AVISA: StatusSolicitacao[] = ["rejeitada", "aprovada", "publicada", "aguardando_documentacao"];

/**
 * Fila da Cartografia: triagem, status, responsável, devolutiva, nota
 * interna, vínculo com o imóvel e — o passo que vale — aplicar a geometria
 * da solicitação ao imóvel como nova versão VALIDADA pela Matriz
 * (requisitos §2.4 e §3: a geometria do usuário nunca vira oficial sozinha).
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/cartografia/solicitacoes/[id]">) {
  const { id } = await ctx.params;
  // fora do matcher do proxy (arquivos grandes): a conferência de origem (CSRF) é aqui
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || a.somenteLeitura || !temSetor(a, "cartografia")) {
    await registrarTentativa({ request, userId: a?.userId, role: a?.role, recurso: "setor:cartografia", motivo: a ? "sem_setor" : "sem_sessao" });
    return falha(403, "sem_permissao", "Restrito à equipe de Cartografia da Arini.", {
      solucao: "Peça à diretoria para colocar você no setor de Cartografia.",
    });
  }
  if (!RE_UUID.test(id)) return falha(404, "nao_encontrada", "Solicitação não encontrada.");

  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") {
    return falha(400, "corpo_invalido", "O pedido chegou sem dados.", { solucao: "Recarregue a página e tente de novo." });
  }

  const admin = supabaseAdmin();
  const { data: req } = await admin.from("cartographic_requests")
    .select("id, protocolo, user_id, status, property_id, responsavel, resposta, geometria_versao_id")
    .eq("id", id).maybeSingle();
  if (!req) return falha(404, "nao_encontrada", "Solicitação não encontrada.");
  const status = req.status as StatusSolicitacao;
  const mensagem = typeof b.mensagem === "string" ? b.mensagem.trim().slice(0, 4000) : "";

  const auditar = (acao: string, depois: unknown, antes?: unknown) =>
    logAudit({
      user_id: a.userId, acao: `solicitacao_cartografica_${acao}`, entidade: "cartographic_requests",
      entidade_id: id, property_id: req.property_id, dados_antes: antes, dados_depois: depois,
    });

  switch (b.acao) {
    case "status": {
      const novo: unknown = b.status;
      if (!ehStatusSolicitacao(novo)) return falha(400, "status_invalido", "Status inválido.");
      if (!TRANSICOES[status].includes(novo)) {
        return falha(409, "transicao_invalida", `Não dá para ir de “${STATUS_SOLICITACAO_LABEL[status]}” para “${STATUS_SOLICITACAO_LABEL[novo]}”.`, {
          solucao: `Daqui a solicitação vai para: ${TRANSICOES[status].map((s) => STATUS_SOLICITACAO_LABEL[s]).join(", ") || "nenhum outro status"}.`,
        });
      }
      const interno = b.interno === true;
      const { error } = await admin.rpc("fn_cart_request_transicao", {
        p_id: id, p_status: novo, p_user_id: a.userId, p_mensagem: mensagem || null, p_interno: interno,
      });
      if (error) return falhaBanco("transicao_falhou", error);
      await auditar("status", { status: novo, mensagem, interno }, { status });
      if (AVISA.includes(novo)) {
        avisarSolicitante(req, novo, interno ? req.resposta : mensagem || req.resposta).catch(() => undefined);
      }
      return NextResponse.json({ ok: true, status: novo });
    }

    case "responsavel": {
      const userId = typeof b.user_id === "string" && RE_UUID.test(b.user_id) ? b.user_id : null;
      let nome: string | null = null;
      if (userId) {
        const { data: p } = await admin.from("profiles").select("nome, role").eq("user_id", userId).maybeSingle();
        if (!p || !ehEquipe(p.role)) return falha(400, "responsavel_invalido", "O responsável precisa ser alguém da equipe.");
        nome = p.nome;
      }
      const { error } = await admin.from("cartographic_requests").update({ responsavel: userId }).eq("id", id);
      if (error) return falhaBanco("responsavel_falhou", error);
      await admin.from("cartographic_request_events").insert({
        request_id: id, user_id: a.userId, interno: true,
        mensagem: userId ? `Responsável: ${nome ?? "equipe"}` : "Solicitação sem responsável",
      });
      await auditar("responsavel", { responsavel: userId }, { responsavel: req.responsavel });
      return NextResponse.json({ ok: true });
    }

    case "resposta": {
      const resposta = typeof b.resposta === "string" ? b.resposta.trim().slice(0, 4000) : "";
      if (resposta.length < 2) return falha(400, "resposta_vazia", "Escreva a resposta ao solicitante.");
      const { error } = await admin.from("cartographic_requests").update({ resposta }).eq("id", id);
      if (error) return falhaBanco("resposta_falhou", error);
      await admin.from("cartographic_request_events").insert({ request_id: id, user_id: a.userId, mensagem: resposta, interno: false });
      await auditar("resposta", { resposta }, { resposta: req.resposta });
      avisarSolicitante(req, null, resposta).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }

    case "nota": {
      if (mensagem.length < 2) return falha(400, "nota_vazia", "Escreva a nota.");
      const interno = b.interno !== false;
      const { error } = await admin.from("cartographic_request_events").insert({ request_id: id, user_id: a.userId, mensagem, interno });
      if (error) return falhaBanco("nota_falhou", error);
      await auditar("nota", { mensagem, interno });
      return NextResponse.json({ ok: true });
    }

    case "vincular_imovel": {
      let q = admin.from("properties").select("id, codigo, titulo");
      if (typeof b.property_id === "string" && RE_UUID.test(b.property_id)) q = q.eq("id", b.property_id);
      else if (typeof b.codigo === "string" && b.codigo.trim()) q = q.eq("codigo", b.codigo.trim().toUpperCase());
      else return falha(400, "imovel_invalido", "Informe o código do imóvel.");
      const { data: imovel } = await q.maybeSingle();
      if (!imovel) return falha(404, "imovel_nao_encontrado", "Imóvel não encontrado.", { solucao: "Confira o código em Imóveis." });
      const { error } = await admin.from("cartographic_requests").update({ property_id: imovel.id }).eq("id", id);
      if (error) return falhaBanco("vinculo_falhou", error);
      await admin.from("tasks").update({ property_id: imovel.id }).like("titulo", `Solicitação ${req.protocolo}%`);
      await admin.from("cartographic_request_events").insert({
        request_id: id, user_id: a.userId, interno: true, mensagem: `Vinculada ao imóvel ${imovel.codigo} — ${imovel.titulo}`,
      });
      await logAudit({
        user_id: a.userId, acao: "solicitacao_cartografica_vinculada", entidade: "cartographic_requests",
        entidade_id: id, property_id: imovel.id, dados_antes: { property_id: req.property_id }, dados_depois: { property_id: imovel.id, codigo: imovel.codigo },
      });
      return NextResponse.json({ ok: true, property_id: imovel.id, codigo: imovel.codigo });
    }

    case "aplicar_geometria": {
      const propertyId = typeof b.property_id === "string" && RE_UUID.test(b.property_id) ? b.property_id : req.property_id;
      if (!propertyId) {
        return falha(400, "sem_imovel", "A solicitação não está ligada a um imóvel.", { solucao: "Vincule o imóvel pelo código antes de aplicar a geometria." });
      }
      const { data: imovel } = await admin.from("properties").select("id, codigo").eq("id", propertyId).maybeSingle();
      if (!imovel) return falha(404, "imovel_nao_encontrado", "Imóvel não encontrado.");
      const geo = await geojsonDaSolicitacao(id);
      if (!geo.geom) {
        return falha(400, "sem_geometria", "A solicitação não tem área desenhada — só um ponto ou anexos.", {
          solucao: "Vetorize a divisa na análise do imóvel e registre aqui o que foi feito.",
        });
      }
      const motivo = (typeof b.motivo === "string" && b.motivo.trim()) ? b.motivo.trim().slice(0, 500) : `Correção a partir da solicitação ${req.protocolo}`;
      const { error: erroGeo } = await admin.rpc("fn_upsert_geometry", {
        p_property_id: propertyId, p_geojson: geo.geom, p_fonte: "desenho", p_arquivo: null,
        p_origem: "matriz", p_motivo: motivo, p_user_id: a.userId,
      });
      if (erroGeo) {
        return falha(400, "geometria_invalida", "A geometria não pôde ser aplicada ao imóvel.", {
          motivo: erroGeo.message, solucao: "Confira a área desenhada na solicitação.",
        });
      }
      const { data: versaoId, error: erroVal } = await admin.rpc("fn_validar_geometria", {
        p_property_id: propertyId, p_user_id: a.userId, p_motivo: motivo,
      });
      if (erroVal) return falhaBanco("validacao_falhou", erroVal);
      await admin.from("cartographic_requests").update({
        geometria_versao_id: versaoId as string, property_id: propertyId,
      }).eq("id", id);
      await admin.from("cartographic_request_events").insert({
        request_id: id, user_id: a.userId, interno: true,
        mensagem: `Geometria da solicitação aplicada ao imóvel ${imovel.codigo} como versão validada pela Matriz (${motivo})`,
      });
      await logAudit({
        user_id: a.userId, acao: "geometria_aplicada_de_solicitacao", entidade: "property_geometry_versions",
        entidade_id: versaoId as string, property_id: propertyId,
        dados_antes: { geometria_versao_id: req.geometria_versao_id },
        dados_depois: { solicitacao: req.protocolo, area_m2: geo.area_m2, motivo },
      });
      return NextResponse.json({ ok: true, geometria_versao_id: versaoId, property_id: propertyId });
    }

    default:
      return falha(400, "acao_invalida", "Ação desconhecida.");
  }
}
