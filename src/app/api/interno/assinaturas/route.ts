import {timingSafeEqual} from "node:crypto";
import {NextResponse} from "next/server";
import {rodarFaturamento} from "@/lib/assinaturas-cotadas";
import {contatosDasAssinaturas} from "@/lib/assinaturas-contato";
import {rodarNotasAssinaturas} from "@/lib/nfse-assinaturas";
export const maxDuration=180;
export async function POST(req:Request) {
 const a=Buffer.from(req.headers.get("x-saude-token")??""),b=Buffer.from(process.env.SAUDE_TOKEN??"");
 if(!b.length || a.length!==b.length || !timingSafeEqual(a,b)) return NextResponse.json({error:"Acesso negado."},{status:401});
 const faturamento = await rodarFaturamento();
 const [contatos, nfse] = await Promise.all([
   contatosDasAssinaturas(),
   rodarNotasAssinaturas().catch(() => ({erro: "Confira a configuração ou a fila fiscal de assinaturas."})),
 ]);
 return NextResponse.json({...faturamento, contatos, nfse});
}
