import { NextResponse } from "next/server";
import { assinaturaWebhookOk, provedorWhatsapp } from "@/lib/meta";
import { processarValorWhatsapp, type ValorWhatsapp } from "@/lib/whatsapp/receber";
import { CorpoMuitoGrande, limitarFluxo } from "@/lib/seguranca/corpo-limitado";

/**
 * Webhook do WhatsApp Business (Cloud API). GET: verificação da Meta. POST:
 * mensagens e status, tratados em lib/whatsapp/receber.ts (o mesmo da Evolution).
 */
export async function GET(request: Request) {
  const u = new URL(request.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Proibido", { status: 403 });
}

export async function POST(request: Request) {
  const assinatura = request.headers.get("x-hub-signature-256");
  const negado = () => NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  if (!process.env.WHATSAPP_APP_SECRET || !assinatura || !/^sha256=[0-9a-f]{64}$/.test(assinatura)) return negado();
  const limite = 8 * 1024 * 1024;
  const grande = () => NextResponse.json({ error: "O evento excedeu o limite de tamanho." }, { status: 413 });
  if (Number(request.headers.get("content-length")) > limite) return grande();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await new Response(request.body && limitarFluxo(request.body, limite)).arrayBuffer());
  } catch (e) {
    if (e instanceof CorpoMuitoGrande) return grande();
    throw e;
  }
  if (!assinaturaWebhookOk(bytes, assinatura)) return negado();
  const corpo = new TextDecoder().decode(bytes);
  const body = JSON.parse(corpo || "{}") as { entry?: { changes?: { value?: ValorWhatsapp }[] }[] };
  // Com a Evolution ativa, a Meta só registra status: as respostas automáticas saem pela Evolution.
  const metaAtiva = provedorWhatsapp() === "meta";
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      const phoneId = v.metadata?.phone_number_id;
      const ok = await processarValorWhatsapp(v, {
        id: phoneId,
        principal: metaAtiva && !!process.env.WHATSAPP_PHONE_ID && phoneId === process.env.WHATSAPP_PHONE_ID,
        cotacoes: metaAtiva && !!process.env.WHATSAPP_COTACOES_PHONE_ID && phoneId === process.env.WHATSAPP_COTACOES_PHONE_ID,
      });
      if (!ok) return NextResponse.json({ ok: false }, { status: 503 });
    }
  }
  return NextResponse.json({ ok: true });
}
