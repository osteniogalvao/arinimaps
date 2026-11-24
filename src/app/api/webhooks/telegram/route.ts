import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { entradaAtendimento } from "@/lib/atendimento";

/**
 * Webhook do bot do Telegram (0171). Cada chat entra no Atendimento como
 * "tg:<chat_id>", na mesma caixa do WhatsApp, com o mesmo menu e as filas.
 * Configuração (uma vez, com o token do @BotFather):
 *   TELEGRAM_BOT_TOKEN       token do bot
 *   TELEGRAM_WEBHOOK_SECRET  texto aleatório; o Telegram devolve no cabeçalho
 *   setWebhook: https://api.telegram.org/bot<TOKEN>/setWebhook
 *     ?url=https://arinibrasil.com.br/api/webhooks/telegram&secret_token=<SECRET>
 */
type Update = {
  update_id?: number;
  message?: {
    message_id?: number; date?: number; text?: string; caption?: string;
    chat?: { id?: number; type?: string };
    from?: { first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
    photo?: unknown[]; document?: unknown; voice?: unknown; location?: { latitude?: number; longitude?: number };
  };
};

function segredoOk(recebido: string | null) {
  const esperado = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido), b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!segredoOk(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Proibido." }, { status: 401 });
  }
  if (Number(request.headers.get("content-length")) > 256_000) return NextResponse.json({ error: "Grande demais." }, { status: 413 });
  const u = (await request.json().catch(() => null)) as Update | null;
  const m = u?.message;
  // só conversa privada com o bot; grupos e outros bots ficam de fora
  if (!m?.chat?.id || m.chat.type !== "private" || m.from?.is_bot || !m.message_id) return NextResponse.json({ ok: true });
  const texto = (m.text ?? m.caption ?? "").trim()
    || (m.location ? `[localização ${m.location.latitude},${m.location.longitude}]` : m.photo ? "[foto]" : m.document ? "[documento]" : m.voice ? "[áudio]" : "");
  if (!texto) return NextResponse.json({ ok: true });
  const telefone = `tg:${m.chat.id}`;
  const nome = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || (m.from?.username ? "@" + m.from.username : "");
  const { data: gravada, error } = await supabaseAdmin().from("whatsapp_mensagens").insert({
    wa_id: `tg:${m.chat.id}:${m.message_id}`, telefone, direcao: "entrada", tipo: m.text ? "text" : "anexo", texto: texto.slice(0, 4000),
    canal: "telegram", recebida_em: m.date ? new Date(m.date * 1000).toISOString() : new Date().toISOString(),
  }).select("id").single();
  if (error?.code === "23505") return NextResponse.json({ ok: true }); // o Telegram reenviou
  if (error || !gravada) return NextResponse.json({ ok: false }, { status: 503 });
  await entradaAtendimento({ telefone, nome: nome.slice(0, 120), texto, mensagemId: gravada.id, opp: null });
  return NextResponse.json({ ok: true });
}
