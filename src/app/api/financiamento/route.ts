import { ator } from "@/lib/authz";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { falha } from "@/lib/erros";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { vagaDaSimulacao } from "@/lib/financiamento-servidor";

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
  const acoes=["REVOGAR","SOLICITAR_DOCUMENTO","APROVAR_DOCUMENTO","REFAZER_DOCUMENTO","EM_ATENDIMENTO","EM_ANALISE_BANCO","APROVADO","REPROVADO","CONTRATADO","PERDIDO"];
  if (!acoes.includes(b.acao) || (b.doc != null && !ehUuid(b.doc)) || (b.nota != null && (typeof b.nota !== "string" || b.nota.length>400)))
    return falha(400,"acao","Operação inválida.");
  const {error}=await db.rpc("fin_movimentar",{p_id:b.id,p_ator:a.userId,p_acao:b.acao,p_nota:b.nota??null,p_doc:b.doc??null});
  return error ? falha(409,"atendimento",error.code==="P0001" ? error.message : "Confira os dados do atendimento.") : Response.json({ok:true});
}

