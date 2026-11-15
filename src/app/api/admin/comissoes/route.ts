import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { falha, falhaBanco } from "@/lib/erros";

const TRANSICOES: Record<string, string[]> = {
  registrada: ["cobrada"],
  cobrada: ["paga"],
  paga: ["conciliada"],
};

export async function POST(request: Request) {
  const a = await ator();
  if (!a || !temSetor(a, "financeiro")) {
    return falha(403, "sem_permissao", "Comissões são do setor Financeiro.", { solucao: "Peça à diretoria para incluir você no setor Financeiro." });
  }
  const body = await request.json().catch(() => ({}));
  const { commission_id, status, acao } = body;
  const admin = supabaseAdmin();
  const { data: antes, error: erroLeitura } = await admin.from("commissions").select("status, autorizacao_id").eq("id", commission_id).maybeSingle();
  if (erroLeitura) return falhaBanco("comissao_indisponivel", erroLeitura);
  if (!antes) return falha(404, "comissao_sumiu", "Comissão não encontrada.", { motivo: "Ela pode ter sido removida enquanto a tela estava aberta.", solucao: "Recarregue a página." });
  if (acao) {
    if (!antes.autorizacao_id || !["receber","ajustar_recebimento","baixar_repasse"].includes(acao)) return falha(400,"acao_invalida","Ação indisponível para esta comissão.");
    if (!Number.isFinite(body.valor) || body.valor < 0 || (acao === "receber" && body.valor === 0) ||
        typeof body.data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.data) ||
        typeof body.documento !== "string" || body.documento.trim().length < 3 || body.documento.length > 300) {
      return falha(400,"comprovante_invalido","Informe valor, data e comprovante válidos.");
    }
    let resultado;
    if (acao === "baixar_repasse") {
      const { data: parcela, error } = await admin.from("comissao_recebimentos").select("id").eq("comissao_id",commission_id).eq("id",body.recebimento_id).maybeSingle();
      if (error) return falhaBanco("recebimento_indisponivel",error);
      if (!parcela) return falha(404,"recebimento_invalido","Esta parcela não pertence à comissão.");
      resultado = await admin.rpc("fn_baixar_repasse",{p_id:parcela.id,p_alvo:body.valor,p_data:body.data,p_documento:body.documento,p_ator:a.userId});
    } else {
      if (typeof body.referencia !== "string" || body.referencia.trim().length < 3 || body.referencia.length > 120) {
        return falha(400,"referencia_invalida","Informe o identificador bancário ou a referência da parcela.");
      }
      resultado = await admin.rpc("fn_recebimento_comissao",{p_id:commission_id,p_referencia:body.referencia,p_valor:body.valor,
        p_data:body.data,p_documento:body.documento,p_ator:a.userId,p_conferir:acao === "ajustar_recebimento"});
    }
    if (resultado.error?.code === "P0001") return falha(409,"comissao_divergente",resultado.error.message);
    if (resultado.error) return falhaBanco("comissao_falhou",resultado.error);
    return NextResponse.json({ok:true});
  }
  if (antes.autorizacao_id && status === "paga") return falha(409,"falta_recebimento","Registre as parcelas recebidas pela ARINI Imóveis.");
  if (!TRANSICOES[antes.status]?.includes(status)) {
    return falha(400, "transicao_invalida", "Essa comissão não pode ir direto para esse estado.", { motivo: `Ela está em "${antes.status}" e a esteira só permite o passo seguinte, não pular etapa.`, solucao: "Avance um passo por vez: registrada → cobrada → paga → conciliada." });
  }
  // condicionado ao status lido: se o webhook do Asaas mudou a comissão no meio-tempo, não sobrescreve
  const { data: mudou, error } = await admin.from("commissions").update({
    status,
    pago_em: status === "paga" ? new Date().toISOString().slice(0, 10) : undefined,
  }).eq("id", commission_id).eq("status", antes.status).select("id");
  if (error?.code === "P0001") return falha(409,"comissao_divergente",error.message);
  if (error) return falhaBanco("comissao_falhou", error);
  if (!mudou?.length) return falha(409, "comissao_mudou", "A comissão mudou enquanto a tela estava aberta.", { motivo: "Outro usuário ou a confirmação automática do Asaas alterou o status.", solucao: "Recarregue a página e confira o status atual." });
  await logAudit({ user_id: a.userId, acao: `comissao_${status}`, entidade: "commissions", entidade_id: commission_id, dados_antes: { status: antes.status }, dados_depois: { status } });
  return NextResponse.json({ ok: true });
}
