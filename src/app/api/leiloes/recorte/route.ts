import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { paraKML } from "@/lib/geo/exportarSig";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";

export async function GET(request:Request) {
  const a=await ator();
  if(!a)return NextResponse.json({error:"Entre na sua conta."},{status:401});
  const db=supabaseAdmin();
  if(!a.partnerId || !(await db.rpc("leilao_acesso",{p_ator:a.userId})).data) return NextResponse.json({error:"Acesso ao CRM de leilões indisponível."},{status:403});
  const limite=await limitar("leilao:recorte:"+a.userId,30,60);
  if(!limite.permitido)return respostaLimite(limite,"exportação de recorte");
  const params=new URL(request.url).searchParams, formato=params.get("formato");
  if(formato!=="kml"&&formato!=="kmz")return NextResponse.json({error:"Selecione KML ou KMZ."},{status:400});
  const {data:im}=await db.from("properties").select("id,codigo,titulo").eq("partner_id",a.partnerId).eq("modalidade","leilao")
    .eq("id",params.get("imovel")).eq("regime_comercial","LEILAO").maybeSingle();
  if(!im)return NextResponse.json({error:"Imóvel não encontrado."},{status:404});
  const {data:geo}=await db.rpc("fn_property_admin_geometry",{p_property_id:im.id});
  if(!geo||!["Polygon","MultiPolygon"].includes(geo.type))return NextResponse.json({error:"Desenhe o polígono da área em leilão para exportar o recorte."},{status:422});
  const kml=paraKML([{nome:"divisa",rotulo:"Área em leilão",geometry:geo,atributos:{codigo:im.codigo}}],im.titulo);
  const nome=String(im.codigo).replace(/[^a-z0-9_-]/gi,"_")+"-recorte."+formato;
  const headers={"Cache-Control":"private, no-store","Content-Disposition":'attachment; filename="'+nome+'"'};
  if(formato==="kml")return new Response(kml,{headers:{...headers,"Content-Type":"application/vnd.google-earth.kml+xml; charset=utf-8"}});
  const {default:JSZip}=await import("jszip");const zip=new JSZip();
  zip.file("doc.kml",kml);
  return new Response(await zip.generateAsync({type:"arraybuffer",compression:"DEFLATE"}),{headers:{...headers,"Content-Type":"application/vnd.google-earth.kmz"}});
}
