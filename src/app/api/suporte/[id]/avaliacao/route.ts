import {NextResponse} from "next/server";
import {currentUser,supabaseServer} from "@/lib/supabase/server";
import {limitar,respostaLimite} from "@/lib/seguranca/limite";

export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const user=await currentUser();
 if(!user)return NextResponse.json({error:"Entre na sua conta."},{status:401});
 const {id}=await ctx.params,b=await request.json().catch(()=>null);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!b||Array.isArray(b)||typeof b!=="object"||
  !Number.isInteger(b.nota)||b.nota<1||b.nota>5||(b.comentario!==undefined&&typeof b.comentario!=="string")||
  [...(b.comentario??"").trim()].length>1000){
  return NextResponse.json({error:"Informe uma nota de 1 a 5 e comentário de até 1000 caracteres."},{status:400});
 }
 const limite=await limitar(`suporte:avaliacao:${user.id}`,20,3600);
 if(!limite.permitido)return respostaLimite(limite,"avaliação");
 const db=await supabaseServer();
 const {data,error}=await db.rpc("suporte_avaliar",{p_ticket:id,p_nota:b.nota,p_comentario:(b.comentario??"").trim()});
 if(error){
  const code=error.code;
  const status=code==="P0002"?404:code==="42501"?403:code==="22023"?400:["23505","55000"].includes(code)?409:503;
  const mensagem=status===404?"Chamado não encontrado.":status===409?"O chamado precisa estar resolvido e só pode receber uma avaliação.":status===503?"Não foi possível registrar a avaliação. Tente novamente.":"Não foi possível avaliar este chamado.";
  return NextResponse.json({error:mensagem},{status});
 }
 const avaliacao=Array.isArray(data)?data[0]:data;
 if(!avaliacao)return NextResponse.json({error:"Não foi possível confirmar a avaliação. Tente novamente."},{status:503});
 return NextResponse.json({ok:true,avaliacao:{nota:avaliacao.nota,comentario:avaliacao.comentario,created_at:avaliacao.created_at}});
}
