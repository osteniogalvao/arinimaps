import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { falha, falhaBanco } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { ariniEmail, sendEmail } from "@/lib/notify";
import {
  STATUS_CANCELAVEIS, STATUS_SOLICITACAO_LABEL, type ArquivoSolicitacao, type StatusSolicitacao,
} from "@/lib/cartografia/solicitacoes";
import { lerArquivos, subirArquivos } from "@/lib/cartografia/servidor";

/**
 * O solicitante fala na própria solicitação: manda mensagem, anexa o que a
 * equipe pediu (quando está "aguardando documentação") ou cancela. Aceita
 * JSON ({mensagem} ou {acao:"cancelar"}) e multipart (mensagem + arquivos).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/cartografia/solicitacoes/[id]/mensagem">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return falha(401, "sem_sessao", "Entre na sua conta para responder.");

  const limite = await limitar(`cartografia:msg:${a.userId}`, 30, 3600);
  if (!limite.permitido) return respostaLimite(limite, "envio");

  // corpo: JSON ou multipart
  let mensagem = "";
  let acao = "mensagem";
  let arquivos: File[] = [];
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return falha(400, "corpo_invalido", "O pedido chegou sem dados.");
    mensagem = String(form.get("mensagem") ?? "").trim();
    acao = String(form.get("acao") ?? "mensagem");
    const lidos = await lerArquivos(form);
    if (lidos.erro) return falha(400, "arquivo_invalido", lidos.erro);
    arquivos = lidos.arquivos;
  } else {
    const b = await request.json().catch(() => ({}));
    mensagem = String(b.mensagem ?? "").trim();
    acao = String(b.acao ?? "mensagem");
  }
  mensagem = mensagem.slice(0, 4000);

  const admin = supabaseAdmin();
  const { data: req } = await admin.from("cartographic_requests")
    .select("id, protocolo, user_id, status, arquivos").eq("id", id).maybeSingle();
  if (!req || req.user_id !== a.userId) return falha(404, "nao_encontrada", "Solicitação não encontrada.");
  const status = req.status as StatusSolicitacao;

  if (acao === "cancelar") {
    if (!STATUS_CANCELAVEIS.includes(status)) {
      return falha(409, "nao_cancelavel", `A solicitação está "${STATUS_SOLICITACAO_LABEL[status]}" e não pode mais ser cancelada.`, {
        solucao: "Se precisar, mande uma mensagem para a equipe de cartografia.",
      });
    }
    const { error } = await admin.rpc("fn_cart_request_transicao", {
      p_id: id, p_status: "cancelada", p_user_id: a.userId,
      p_mensagem: mensagem ? `Cancelada pelo solicitante: ${mensagem}` : "Cancelada pelo solicitante", p_interno: false,
    });
    if (error) return falhaBanco("cancelamento_falhou", error);
    await logAudit({ user_id: a.userId, acao: "solicitacao_cartografica_cancelada", entidade: "cartographic_requests", entidade_id: id, dados_antes: { status }, dados_depois: { status: "cancelada" } });
    return NextResponse.json({ ok: true, status: "cancelada" });
  }

  if (["cancelada", "publicada"].includes(status)) {
    return falha(409, "encerrada", `A solicitação está "${STATUS_SOLICITACAO_LABEL[status]}" e não recebe mais mensagens.`, {
      solucao: "Se o problema continuar, abra uma nova solicitação.",
    });
  }
  if (arquivos.length && status !== "aguardando_documentacao") {
    return falha(409, "anexo_nao_pedido", "Anexos só podem ser enviados quando a equipe pede documentação.", {
      solucao: "Mande só a mensagem; se a equipe precisar de arquivos, a solicitação passa a “Aguardando documentação”.",
    });
  }
  if (mensagem.length < 2 && !arquivos.length) return falha(400, "mensagem_vazia", "Escreva a mensagem.");

  // anexos complementares entram na mesma lista, numerados em sequência
  let salvos: ArquivoSolicitacao[] = [];
  let falharam: string[] = [];
  if (arquivos.length) {
    const atuais = (req.arquivos ?? []) as ArquivoSolicitacao[];
    ({ salvos, falharam } = await subirArquivos(req.protocolo, arquivos, atuais.length + 1));
    if (salvos.length) {
      await admin.from("cartographic_requests").update({ arquivos: [...atuais, ...salvos] }).eq("id", id);
    }
  }

  const texto = [mensagem || null, salvos.length ? `Anexos: ${salvos.map((s) => s.nome).join(", ")}` : null].filter(Boolean).join("\n");
  const { error: erroEvento } = await admin.from("cartographic_request_events").insert({
    request_id: id, user_id: a.userId, mensagem: texto, interno: false,
  });
  if (erroEvento) return falhaBanco("mensagem_nao_gravada", erroEvento);

  // documentação entregue: volta para a análise da equipe
  let novoStatus: StatusSolicitacao = status;
  if (status === "aguardando_documentacao") {
    const { error } = await admin.rpc("fn_cart_request_transicao", {
      p_id: id, p_status: "em_analise", p_user_id: a.userId, p_mensagem: "Documentação complementar recebida", p_interno: false,
    });
    if (!error) novoStatus = "em_analise";
  }

  await logAudit({
    user_id: a.userId, acao: "solicitacao_cartografica_mensagem", entidade: "cartographic_requests", entidade_id: id,
    dados_depois: { arquivos: salvos.length, arquivos_falharam: falharam, status: novoStatus },
  });
  ariniEmail().then((para) => sendEmail(
    para, `Solicitação ${req.protocolo}: mensagem do solicitante`,
    `${texto}\n\nAbrir: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/cartografia/solicitacoes/${id}`
  )).catch(() => undefined);

  return NextResponse.json({ ok: true, status: novoStatus, arquivos_falharam: falharam });
}
