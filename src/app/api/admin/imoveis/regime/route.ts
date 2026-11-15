import { ator,temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { falha } from "@/lib/erros";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { REGIMES_IMOVEL } from "@/lib/imovel/regime";
export async function POST(req:Request) {
  const a=await ator();
  if(!a || !temSetor(a,"operacoes")) return falha(a?403:401,"permissao","Acesso restrito a Operações.");
  const b=await req.json().catch(()=>null);
  if(!ehUuid(b?.id) || !Object.hasOwn(REGIMES_IMOVEL,b.atual) || !Object.hasOwn(REGIMES_IMOVEL,b.regime)) return falha(400,"regime","Regime inválido.");
  const {error}=await supabaseAdmin().rpc("fn_regime_comercial",{p_id:b.id,p_ator:a.userId,p_anterior:b.atual,p_regime:b.regime});
  return error ? falha(409,"regime",error.code==="P0001" ? error.message:"Não foi possível confirmar a alteração.") : Response.json({ok:true});
}

