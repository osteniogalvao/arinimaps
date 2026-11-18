import { ator } from "@/lib/authz";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { falha } from "@/lib/erros";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { vagaDaSimulacao } from "@/lib/financiamento-servidor";
import { ariniEmail, sendEmail } from "@/lib/notify";
import { formatBRL } from "@/lib/format";
import type { Espelho } from "@/lib/financiamento";

export async function POST(req: Request) {
  const a = await ator();
  if (!a) return falha(401,"sessao","Entre na conta para continuar.");
  const limite = await limitar("financiamento:"+a.userId,120,3600);
  if (!limite.permitido) return respostaLimite(limite,"operações de financiamento");
  const b = await req.json().catch(() => null);
  if (!ehUuid(b?.id)) return falha(400,"id","Identificador inválido.");
  const db = supabaseAdmin();
  if (b.acao === "simular") {
    if (!ehUuid(b.linha) || !Number.isFinite(b.entrada) || !Number.isInteger(b.prazo) || typeof b.codigo !== "string" ||
        b.codigo.length > 60 || !["SAC","PRICE"].includes(b.sistema)) return falha(400,"parametros","Confira os dados da simulação.");
    const {data,error} = await db.rpc("fin_simular",{p_id:b.id,p_cliente:a.userId,p_codigo:b.codigo,p_linha:b.linha,
      p_entrada:b.entrada,p_meses:b.prazo,p_sistema:b.sistema});
    if (error) return falha(error.code==="P0001" ? 422 : 503,"simulacao",error.code==="P0001" ? error.message : "Não foi possível simular.");
    return Response.json({id:b.id,espelho:data,vaga:await vagaDaSimulacao(b.id,a.userId)});
  }
  if (b.acao === "repassar") {
    if (!ehUuid(b.vaga) || b.aceite !== true || (b.renda != null && (!Number.isFinite(b.renda) || b.renda<=0 || b.renda>999999999999)) ||
        (b.nascimento != null && (typeof b.nascimento !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.nascimento))))
      return falha(400,"consentimento","Confira os dados e autorize o repasse para esta instituição.");
    const user = await currentUser();
    if (!user?.email || user.id !== a.userId) return falha(401,"sessao","Entre na conta para solicitar atendimento.");
    const {error} = await db.rpc("fin_repassar",{p_id:b.id,p_cliente:a.userId,p_vaga:b.vaga,p_email:user.email,
      p_renda:b.renda??null,p_nascimento:b.nascimento??null});
    if (error) return falha(409,"repasse",error.code==="P0001" ? error.message : "Confira os dados antes de prosseguir.");
    return Response.json({ok:true});
  }
  // Áudio do Carlos (18/11/2026, 15h39): enquanto não houver correspondente
  // bancário na região, a simulação vai direto para a ARINI, que analisa e atende.
  if (b.acao === "arini") {
    if (b.aceite !== true || (b.telefone != null && (typeof b.telefone !== "string" || b.telefone.length > 30)) ||
        (b.renda != null && (!Number.isFinite(b.renda) || b.renda<=0 || b.renda>999999999999)))
      return falha(400,"consentimento","Confira os dados e autorize o envio para a ARINI.");
    const user = await currentUser();
    if (!user?.email || user.id !== a.userId) return falha(401,"sessao","Entre na conta para solicitar atendimento.");
    const {data:sim,error} = await db.from("fin_simulacoes").select("espelho").eq("id",b.id).eq("cliente_id",a.userId).maybeSingle();
    if (error) return falha(503,"simulacao","Não foi possível consultar a simulação.");
    if (!sim) return falha(404,"simulacao","Simulação não encontrada. Calcule de novo.");
    const e = sim.espelho as Espelho;
    const mensagem = [
      `Simulação de financiamento do imóvel ${e.codigo} (${e.titulo}).`,
      `Valor ${formatBRL(e.valor)} · entrada ${formatBRL(e.entrada)} · financiado ${formatBRL(e.financiado)}.`,
      `${e.banco} · ${e.linha} · ${e.prazo} meses · ${e.sistema} · taxa ${e.taxa_nominal_aa}% a.a. · CET ${e.cet_aa}% a.a.`,
      `Primeira parcela com seguro ${formatBRL(e.parcela_inicial)} · total ${formatBRL(e.total)}.`,
      b.renda ? `Renda mensal informada: ${formatBRL(b.renda)}.` : "",
      `Simulação ${b.id}. O cliente autorizou o contato da ARINI sobre este financiamento.`,
    ].filter(Boolean).join("\n");
    const nome = user.nome || user.email;
    const assunto = `Financiamento ${e.codigo} · ${e.banco}`;
    const {data:tickets,error:erroChamado} = await db.rpc("abrir_chamado_com_mensagem",{
      p_usuario:a.userId,p_nome:nome,p_email:user.email,p_telefone:b.telefone?.trim() || null,
      p_categoria:"financeiro",p_assunto:assunto,p_mensagem:mensagem,
    });
    const chamado = tickets?.[0] as {codigo:string}|undefined;
    if (erroChamado || !chamado) return falha(503,"chamado","Não foi possível enviar a simulação. Tente novamente.");
    sendEmail(await ariniEmail(),`Chamado ${chamado.codigo}: ${assunto}`,`${nome} <${user.email}>${b.telefone ? ` · ${b.telefone}` : ""} pediu atendimento.\n\n${mensagem}`).catch(() => undefined);
    return Response.json({ok:true,codigo:chamado.codigo});
  }
  const acoes=["REVOGAR","SOLICITAR_DOCUMENTO","APROVAR_DOCUMENTO","REFAZER_DOCUMENTO","EM_ATENDIMENTO","EM_ANALISE_BANCO","APROVADO","REPROVADO","CONTRATADO","PERDIDO"];
  if (!acoes.includes(b.acao) || (b.doc != null && !ehUuid(b.doc)) || (b.nota != null && (typeof b.nota !== "string" || b.nota.length>400)))
    return falha(400,"acao","Operação inválida.");
  const {error}=await db.rpc("fin_movimentar",{p_id:b.id,p_ator:a.userId,p_acao:b.acao,p_nota:b.nota??null,p_doc:b.doc??null});
  return error ? falha(409,"atendimento",error.code==="P0001" ? error.message : "Confira os dados do atendimento.") : Response.json({ok:true});
}

