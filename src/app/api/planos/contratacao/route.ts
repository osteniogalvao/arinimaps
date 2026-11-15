import {NextResponse} from "next/server";
import {ator,temSetor} from "@/lib/authz";
import {clienteDoPlano} from "@/lib/clientes-asaas";
import {supabaseAdmin} from "@/lib/supabase/admin";
import {checkoutAtivo,conciliarFatura} from "@/lib/assinaturas-cotadas";
import {limitar,respostaLimite} from "@/lib/seguranca/limite";
import {falha} from "@/lib/erros";
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export async function POST(req:Request) {
 const a=await ator(); if(!a) return falha(401,"sessao","Entre para continuar.");
 const dados=await req.json().catch(()=>null);
 if(!dados || !uuid.test(dados.id)) return falha(400,"pedido","Pedido inválido.");
 const limite=await limitar("assinaturas:"+a.userId,24,300);
 if(!limite.permitido) return respostaLimite(limite,"operações");
 const db=supabaseAdmin();
 const erro=(e:{message:string;code:string})=>falha(e.code==="42501"?403:409,"condicao",
   ["55000","22023"].includes(e.code) && e.message.length>25 && !e.message.includes("parameter") ? e.message:
    "Confira o perfil ativo, a organização e as condições vigentes da proposta. Uma assinatura ou concessão existente pode exigir conciliação pela Central.");
 if(dados.acao==="conciliar") {
   if(!temSetor(a,"financeiro")) return falha(403,"acesso","Acesso restrito ao financeiro.");
   if(!checkoutAtivo()) return falha(503,"asaas","O Asaas está indisponível.");
   const {data:f}=await db.from("faturas_cotadas").select("id,status").eq("id",dados.id).maybeSingle();
   if(!f||f.status==="nova") return falha(409,"fatura","Esta fatura ainda não foi emitida.");
   try {await conciliarFatura(f.id);return NextResponse.json({ok:true});}
   catch {return falha(503,"conferencia","O Asaas e o pedido ainda não conferem. Consulte a referência da fatura no gateway.");}
 }
 if(dados.acao==="liberar") {
   if(!temSetor(a,"financeiro")) return falha(403,"acesso","Acesso restrito ao financeiro.");
   if(typeof dados.escopo!=="string") return falha(400,"escopo","Informe o escopo disponível.");
   const {error}=await db.rpc("assinatura_liberar",{p_ator:a.userId,p_pedido:dados.id,p_escopo:dados.escopo});
   return error?erro(error):NextResponse.json({ok:true});
 }
 if(dados.acao==="cancelar" || dados.acao==="arrependimento") {
   const {error}=await db.rpc("assinatura_cancelar",{p_titular:a.userId,p_id:dados.id,p_estorno:dados.acao==="arrependimento"});
   return error?erro(error):NextResponse.json({ok:true});
 }
 if(dados.acao!=="aceitar" || dados.aceito!==true || ![dados.primeira,dados.recorrente,dados.adicionais].every(Number.isSafeInteger))
   return falha(400,"aceite","É necessário aceitar os valores e o ciclo apresentados.");
 if(!checkoutAtivo()) return falha(503,"indisponivel","A emissão pelo Asaas está indisponível.");
 const {data:s}=await db.from("assinaturas_cotadas").select("nicho,ciclo,primeira,recorrente,adicionais,cancelado").eq("id",dados.id).eq("titular",a.userId).maybeSingle();
 if(!s || s.nicho!==a.nicho || s.cancelado || s.ciclo!==dados.ciclo || s.primeira!==dados.primeira || s.recorrente!==dados.recorrente || s.adicionais!==dados.adicionais)
    return falha(409,"proposta","Selecione o perfil desta proposta e confira os valores vigentes.");
 let cliente:string;
 try { cliente=await clienteDoPlano(a.userId); } catch(e) {return falha(422,"cadastro",e instanceof Error && e.message.startsWith("Complete o CPF")?e.message:"Não foi possível confirmar o cadastro de cobrança. Confira seu cadastro e tente novamente.");}
 const {error}=await db.rpc("assinatura_aceitar",{p_titular:a.userId,p_id:dados.id,p_cliente:cliente,p_primeira:s.primeira,p_recorrente:s.recorrente,p_adicionais:s.adicionais,p_ciclo:s.ciclo});
 if(error) return erro(error);
 const {data:fa}=await db.from("faturas_cotadas").select("id").eq("assinatura",dados.id).eq("numero",0).in("status",["nova","emitindo"]);
 await Promise.allSettled((fa??[]).map(f=>conciliarFatura(f.id)));
 return NextResponse.json({ok:true});
}