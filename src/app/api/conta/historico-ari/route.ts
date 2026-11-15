import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const a=await ator(); if (!a) return Response.json({error:"Entre na conta."},{status:401});
  const db=supabaseAdmin(); const qs=new URL(request.url).searchParams;
  const id=qs.get("id"); const pg=Number(qs.get("pagina") ?? 0);
  if (!Number.isSafeInteger(pg)||pg<0||pg>10000) return Response.json({error:"Página inválida."},{status:400});
  let q=db.from("ia_conversas").select("id,titulo,updated_at").eq("user_id",a.userId).eq("historico_visivel",true);
  q=a.nicho?q.eq("nicho",a.nicho):q.is("nicho",null);
  if (!id) {
    const {data,error}=await q.order("updated_at",{ascending:false}).order("id").range(pg*20,pg*20+19);
    return Response.json(error?{error:"Falha ao carregar."}:{conversas:data},{status:error?503:200,headers:{"Cache-Control":"private,no-store"}});
  }
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await q.eq("id",id).maybeSingle()).data) return new Response(null,{status:404});
  const {data,error}=await db.from("ia_mensagens").select("id,papel,conteudo,created_at").eq("conversa_id",id).neq("conteudo","")
    .order("created_at").order("id").range(pg*50,pg*50+49);
  return Response.json(error?{error:"Falha ao carregar."}:{mensagens:data},{status:error?503:200,headers:{"Cache-Control":"private,no-store"}});
}
export async function DELETE(request: Request) {
  const a=await ator(); if (!a) return new Response(null,{status:401});
  const id=new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response(null,{status:400});
  const {data,error}=await supabaseAdmin().rpc("ia_apagar_historico",{p_titular:a.userId,p_id:id});
  return new Response(null,{status:error?503:data?204:404});
}
