import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { consentimentoDaConta } from "@/lib/privacidade/consentimento";
import { ipDoPedido, limitar } from "@/lib/seguranca/limite";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { urlDoSite } from "@/lib/compartilhar";

export async function GET(req:Request,{params}:{params:Promise<{link:string}>}) {
  const {link}=await params, headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
  if(!ehUuid(link))return new Response("Link indisponível.",{status:404,headers});
  const a=await ator(), crawler=/bot|crawler|spider|preview|whatsapp|facebookexternalhit|slurp/i.test(req.headers.get("user-agent")??"");
  const permitido=!crawler && await consentimentoDaConta(a?.userId,"rastro");
  let visitante:string|null=null;
  if(permitido&&(await limitar("divulgacao-cliques:"+ipDoPedido(req),60,600)).permitido) {
    const atual=(await cookies()).get("arini_div_visita")?.value;
    visitante=ehUuid(atual)?atual:randomUUID();
  }
  const {data,error}=await supabaseAdmin().rpc("divulgacao_abrir_link",{p_link:link,p_visitante:visitante,p_usuario:a?.userId??null}).maybeSingle();
  if(error)return new Response("Não foi possível abrir o imóvel.",{status:503,headers});
  const item=data as {codigo:string;dias:number;rastreado:boolean}|null;
  if(!item)return new Response("Este material saiu da divulgação.",{status:404,headers});
  const destino=new URL("/imovel/"+encodeURIComponent(item.codigo),urlDoSite());
  if(item.rastreado){destino.searchParams.set("utm_source","divulgadores");destino.searchParams.set("utm_content",link);}
  const res=NextResponse.redirect(destino,{status:302,headers});
  if(item.rastreado&&visitante){
    const opcoes={path:"/",httpOnly:true,sameSite:"lax" as const,secure:destino.protocol==="https:",maxAge:item.dias*86400};
    res.cookies.set("arini_div_visita",visitante,opcoes);
    res.cookies.set("arini_div_link",link,opcoes);
  }
  return res;
}
