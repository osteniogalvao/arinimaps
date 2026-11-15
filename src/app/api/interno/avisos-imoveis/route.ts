import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { enviarFiltroWhatsapp, MetaErro, modeloFiltroWhatsapp, telefoneWhatsapp } from "@/lib/meta";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 90;
export async function POST(req: Request) {
  const a = Buffer.from(req.headers.get("x-saude-token") ?? ""), b = Buffer.from(process.env.SAUDE_TOKEN ?? "");
  if (!b.length || a.length !== b.length || !timingSafeEqual(a,b)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const modelo = await modeloFiltroWhatsapp();
  if (!modelo) return NextResponse.json({ enviados: 0, modelo: "indisponivel" });
  const db = supabaseAdmin();
  let enviados = 0;
  const inicio = Date.now();
  for (let i = 0; i < 20 && Date.now() - inicio < 60_000; i++) {
    const {data,error} = await db.rpc("fn_filtro_reservar_wa");
    if (error) return NextResponse.json({ error: "Falha ao reservar aviso." }, {status:503});
    const item = data?.[0];
    if (!item) break;
    const telefone = telefoneWhatsapp(item.telefone);
    let status = "recusado", waId: string | null = null;
    if (telefone && /^55\d{10,11}$/.test(telefone)) {
      const origem = process.env.NEXT_PUBLIC_SITE_URL || "https://arinibrasil.com.br";
      const url = new URL("/imovel/" + encodeURIComponent(item.codigo), origem).href;
      try {
        waId = await enviarFiltroWhatsapp(telefone, url, modelo);
        status = "enviado";
        enviados++;
      } catch (e) {
        status = e instanceof MetaErro && !e.entregaIncerta ? "recusado" : "conferir";
      }
    }
    const salva = await db.from("filtro_avisos").update({ whatsapp: status, wa_id: waId })
      .eq("id", item.aviso).eq("whatsapp", "enviando");
    if (salva.error) return NextResponse.json({ error: "Falha ao registrar envio." }, {status:503});
  }
  return NextResponse.json({ enviados });
}