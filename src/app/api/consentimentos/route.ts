import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { currentUser } from "@/lib/supabase/server";
import { ator } from "@/lib/authz";
import { consentimentoDaConta, COOKIE_ESCOLHA, type Finalidade } from "@/lib/privacidade/consentimento";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";

export async function GET() {
  const u=await currentUser();
  const fins: Finalidade[]=u ? ["rastro","historico_ari","whatsapp","whatsapp_assinatura","whatsapp_recuperacao"] : ["rastro"];
  const valores=await Promise.all(fins.map(async f=>[f,await consentimentoDaConta(u?.id,f)]));
  return NextResponse.json({logado:!!u,escolhas:Object.fromEntries(valores)},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request: Request) {
  const u=await currentUser();
  if (u && !await ator()) return NextResponse.json({error:"Confirme sua sessão."},{status:403});
  const ip=ipDoPedido(request);
  const limite=await limitar("preferencias-privacidade:"+(u?.id??ip),40,600);
  if (!limite.permitido) return respostaLimite(limite,"alteração de privacidade");
  const body=await request.json().catch(()=>null);
  if (!body || !["rastro","historico_ari","whatsapp","whatsapp_assinatura","whatsapp_recuperacao"].includes(body.finalidade) || typeof body.permitido !== "boolean")
    return NextResponse.json({error:"Escolha inválida."},{status:400});
  if (!u && body.finalidade!=="rastro") return NextResponse.json({error:"Entre na conta."},{status:401});
  if (u) {
    const {error}=await supabaseAdmin().from("conta_consentimentos").insert({titular:u.id,finalidade:body.finalidade,
      permitido:body.permitido,versao:"1.0",ip:isIP(ip)?ip:null});
    if (error) return NextResponse.json({error:"Não foi possível registrar a escolha."},{status:503});
  }
  const r=NextResponse.json({ok:true});
  if (!u) r.cookies.set(COOKIE_ESCOLHA,body.permitido?"rastro-v1":"essenciais-v1",{httpOnly:true,path:"/",sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:86400*180});
  return r;
}
