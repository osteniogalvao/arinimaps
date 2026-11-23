import { NextResponse } from "next/server";
import { assinaturaWebhookOk } from "@/lib/meta";
import { entradaAtendimento } from "@/lib/atendimento";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CorpoMuitoGrande, limitarFluxo } from "@/lib/seguranca/corpo-limitado";

/**
 * Webhook de mensagens do Instagram Direct e do Messenger (migration 0157).
 * No app da Meta: produto Messenger (objeto "page", campo messages) e
 * Instagram (objeto "instagram", campo messages), apontando para esta URL.
 * Cada mensagem entra no Atendimento como "ig:<id>" ou "fb:<id>".
 */
export async function GET(request: Request) {
  const u = new URL(request.url);
  const token = process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Proibido", { status: 403 });
}

type Evento = {
  sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: { type?: string }[] };
};

async function nomeDoContato(id: string, instagram: boolean) {
  const token = process.env.FACEBOOK_PAGE_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!token) return "";
  const campos = instagram ? "name,username" : "first_name,last_name";
  const r = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(id)}?fields=${campos}&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  if (!j) return "";
  return String(instagram ? j.name || (j.username ? "@" + j.username : "") : [j.first_name, j.last_name].filter(Boolean).join(" ")).slice(0, 120);
}

export async function POST(request: Request) {
  const assinatura = request.headers.get("x-hub-signature-256");
  const negado = () => NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  if (!process.env.WHATSAPP_APP_SECRET || !assinatura || !/^sha256=[0-9a-f]{64}$/.test(assinatura)) return negado();
  const limite = 2 * 1024 * 1024;
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
  const body = JSON.parse(new TextDecoder().decode(bytes) || "{}") as { object?: string; entry?: { messaging?: Evento[] }[] };
  if (body.object !== "instagram" && body.object !== "page") return NextResponse.json({ ok: true });
  const instagram = body.object === "instagram";
  const canal = instagram ? "instagram" : "messenger";
  const admin = supabaseAdmin();

  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      const de = ev.sender?.id;
      if (!m?.mid || !de || m.is_echo) continue; // eco = mensagem que a própria página enviou
      const texto = (m.text ?? "").trim() || (m.attachments?.length ? `[${m.attachments[0].type ?? "anexo"}]` : "");
      if (!texto) continue;
      const telefone = (instagram ? "ig:" : "fb:") + de;
      const { data: gravada, error } = await admin.from("whatsapp_mensagens").insert({
        wa_id: m.mid, telefone, direcao: "entrada", tipo: m.text ? "text" : (m.attachments?.[0]?.type ?? "anexo"), texto, canal,
        recebida_em: ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString(),
      }).select("id").single();
      if (error?.code === "23505") continue; // a Meta reenviou a mesma mensagem
      if (error?.code === "42703") return NextResponse.json({ ok: false, error: "Falta rodar a migration 0157." }, { status: 503 });
      if (error || !gravada) return NextResponse.json({ ok: false }, { status: 503 });
      const nome = await nomeDoContato(de, instagram);
      await entradaAtendimento({ telefone, nome, texto, mensagemId: gravada.id, opp: null });
    }
  }
  return NextResponse.json({ ok: true });
}
