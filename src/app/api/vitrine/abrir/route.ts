import { NextResponse } from "next/server";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { assinarVisitas, COOKIE_VISITAS, visitasDoNavegador } from "@/lib/imovel/visitas";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const codigo = new URL(request.url).searchParams.get("codigo")?.toUpperCase() || "";
  if (!/^AIB-[0-9]{6,12}$/.test(codigo)) return new Response(null,{status:404});
  const uso = await limitar("vitrine:" + ipDoPedido(request), 90, 60);
  if (!uso.permitido) return respostaLimite(uso, "abertura de ficha");
  const {data: imovel} = await supabaseAdmin().from("properties").select("id").eq("codigo",codigo).in("status",["publicado","em_negociacao"]).maybeSingle();
  if (!imovel) return new Response(null,{status:404});
  const {lista,limite} = await visitasDoNavegador();
  const podeAbrir = lista.includes(codigo) || lista.length < limite;
  const res = new NextResponse(null, { status: 303, headers: {
    Location: "/imovel/" + codigo + (podeAbrir ? "?resumo=1" : ""),
    "Cache-Control": "private, no-store",
  } });
  if (!lista.includes(codigo) && lista.length < limite) res.cookies.set(COOKIE_VISITAS,assinarVisitas([...lista,codigo]),
    {path:"/",sameSite:"lax",httpOnly:true,secure:process.env.NODE_ENV==="production",maxAge:86400*30});
  if (podeAbrir) await registrarEventoImovel({propertyId:imovel.id,tipo:"ficha",detalhe:{codigo,visao:"resumo"}});
  return res;
}
