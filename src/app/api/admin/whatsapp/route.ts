import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { fichaPeloWhatsapp } from "@/lib/assinaturas-contato";
import { logAudit } from "@/lib/audit";
import { marcarPrimeiroAtendimento, concluirTarefaDoEvento } from "@/lib/central";
import { enviarWhatsapp, MetaErro, telefoneWhatsapp, whatsappConfigurado } from "@/lib/meta";
import { limitar,respostaLimite } from "@/lib/seguranca/limite";

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
async function conversa(opp:string|null,entrada:string|null){
  const db=supabaseAdmin();
  if (opp && uuid.test(opp)){
    const {data,error}=await db.from("opportunities").select("id,lead:leads(telefone)").eq("id",opp).maybeSingle();
    if(error)throw Error("Falha ao carregar oportunidade.");
    return data?{opp:data.id as string|null,tel:telefoneWhatsapp((data.lead as unknown as {telefone:string|null}|null)?.telefone)}:null;
  }
  if(entrada && uuid.test(entrada)){
    const {data,error}=await db.from("whatsapp_mensagens").select("telefone").eq("id",entrada).eq("direcao","entrada").is("opportunity_id",null).maybeSingle();
    if(error)throw Error("Falha ao localizar a conversa.");
    if(data)return {opp:null,tel:telefoneWhatsapp(data.telefone)};
  }
  return null;
}
export async function GET(request:Request) {
  const a=await ator();
  if(!temSetor(a,"comercial","diretoria"))return NextResponse.json({error:"Restrito ao Comercial."},{status:403});
  const q=new URL(request.url).searchParams, c=await conversa(q.get("opp"),q.get("entrada"));
  if(!c)return NextResponse.json({error:"Conversa não encontrada."},{status:404});
  const consulta=supabaseAdmin().from("whatsapp_mensagens").select("id,direcao,texto,status,erro,created_at");
  const filtro=c.opp?consulta.eq("opportunity_id",c.opp):consulta.eq("telefone",c.tel).is("opportunity_id",null);
  const {data,error}=await filtro.order("created_at",{ascending:false}).order("id",{ascending:false}).limit(200);
  if(error)return NextResponse.json({error:"Não foi possível carregar a conversa."},{status:503});
  return NextResponse.json({configurado:whatsappConfigurado(),mensagens:(data??[]).reverse(),ficha:await fichaPeloWhatsapp(c.tel)},
    {headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request:Request) {
  const a=await ator();
  if(!temSetor(a,"comercial","diretoria"))return NextResponse.json({error:"Restrito ao Comercial."},{status:403});
  const limite=await limitar("crm-whatsapp:"+a!.userId,40,600);
  if(!limite.permitido)return respostaLimite(limite,"mensagens");
  const b=await request.json().catch(()=>({})),texto=String(b.texto??"").trim();
  if(!texto || texto.length>4000)return NextResponse.json({error:"Escreva uma mensagem de até 4.000 caracteres."},{status:400});
  const c=await conversa(b.opp,b.entrada);
  if(!c?.tel)return NextResponse.json({error:"A conversa não tem telefone válido."},{status:400});
  const db=supabaseAdmin();
  // A Cloud API aplica a janela de atendimento também aos contatos iniciados fora da Central.
  try{
    const waId=await enviarWhatsapp(c.tel,texto);
    const {error}=await db.from("whatsapp_mensagens").insert({wa_id:waId||null,telefone:c.tel,direcao:"saida",texto,opportunity_id:c.opp,enviado_por:a!.userId,status:"sent"});
    if(error)return NextResponse.json({error:"O WhatsApp aceitou a mensagem, mas o registro local falhou. Confira o envio antes de tentar de novo."},{status:503});
    if(c.opp){
      await db.from("opportunity_events").insert({opportunity_id:c.opp,tipo:"contato",descricao:"WhatsApp enviado: "+texto.slice(0,500),autor:a!.userId});
      await marcarPrimeiroAtendimento(c.opp,a!.userId);
      const {data:entradas}=await db.from("whatsapp_mensagens").select("id").eq("opportunity_id",c.opp).eq("direcao","entrada").order("created_at",{ascending:false}).limit(3);
      for(const m of entradas??[])await concluirTarefaDoEvento("whatsapp_sem_resposta:"+m.id,a!.userId,"Cliente respondido pelo WhatsApp");
    }else{
      const {data:entradas}=await db.from("whatsapp_mensagens").select("created_at").eq("telefone",c.tel).is("opportunity_id",null)
        .eq("direcao","entrada").gt("created_at",new Date(Date.now()-86400000).toISOString());
      for(const dia of new Set((entradas??[]).map(e=>e.created_at.slice(0,10))))
        await concluirTarefaDoEvento("whatsapp_sem_lead:"+c.tel+":"+dia,a!.userId,"Cliente respondido pelo WhatsApp");
    }
    await logAudit({user_id:a!.userId,acao:"whatsapp_enviado",entidade:"whatsapp_mensagens",opportunity_id:c.opp});
    return NextResponse.json({ok:true});
  }catch(e){
    if(e instanceof MetaErro)return NextResponse.json({error:e.mensagem},{status:400});
    throw e;
  }
}
