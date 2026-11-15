import { ator,temSetor } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
export async function POST(req:Request) {
  const a=await ator();
  if(!a||!temSetor(a,"operacoes","juridico"))return falha(a?403:401,"acesso","Acesso restrito à verificação.");
  const b=await req.json().catch(()=>null);
  if(!ehUuid(b?.id)||!Number.isInteger(b.revisao)||!["APROVADA","PENDENCIA","REPROVADA"].includes(b.estado)||typeof b.motivo!=="string"||b.motivo.trim().length<3||b.motivo.length>600)
    return falha(400,"dados","Informe a decisão e o motivo.");
  const {error}=await supabaseAdmin().rpc("claim_decidir",{p_id:b.id,p_revisao:b.revisao,p_estado:b.estado,p_motivo:b.motivo,p_ator:a.userId});
  return error?falha(409,"verificacao",error.code==="P0001"?error.message:"A solicitação mudou. Atualize a fila."):Response.json({ok:true});
}

