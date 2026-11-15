import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enviarEmailComStatus } from "@/lib/notify";
import { limitarEmMemoria } from "@/lib/geo/limiteMemoria";
import { ipDoPedido, respostaLimite } from "@/lib/seguranca/limite";

export const maxDuration = 75;
export async function POST(request: Request) {
  const segredo = Buffer.from(process.env.SAUDE_TOKEN ?? ""),
    recebido = Buffer.from(request.headers.get("x-saude-token") ?? "");
  if (!segredo.length || segredo.length !== recebido.length || !timingSafeEqual(segredo, recebido)) {
    const limite = limitarEmMemoria("comunicados:negado:" + ipDoPedido(request), 20, 60);
    if (!limite.permitido) return respostaLimite(limite, "autenticação do worker");
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ enviados: 0, canal: "indisponivel" });
  const db = supabaseAdmin(),
    inicio = Date.now();
  let enviados = 0;
  for (let i = 0; i < 20 && Date.now() - inicio < 55_000; i++) {
    const { data, error } = await db.rpc("matriz_reservar_email");
    if (error) return NextResponse.json({ error: "Falha ao consultar fila." }, { status: 503 });
    const item = data?.[0];
    if (!item) break;
    const status = await enviarEmailComStatus(
      item.email,
      item.titulo,
      item.mensagem,
      "matriz/" + item.comunicado + "/" + item.titular,
    );
    const repetir = status === "temporario" && item.tentativa < 4;
    const atraso = [5, 20, 60][item.tentativa - 1];
    const { error: falha } = await db
      .from("matriz_entregas")
      .update({
        email: repetir ? "pendente" : status === "enviado" ? "enviado" : "conferir",
        tentar_apos: repetir ? new Date(Date.now() + atraso * 60_000).toISOString() : null,
      })
      .eq("comunicado", item.comunicado)
      .eq("titular", item.titular)
      .eq("email", "reservado")
      .eq("tentativas", item.tentativa);
    if (falha) return NextResponse.json({ error: "Falha ao registrar envio." }, { status: 503 });
    if (status === "enviado") enviados++;
  }
  return NextResponse.json({ enviados });
}
