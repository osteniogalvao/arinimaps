import "server-only";
import { enviarWhatsapp, MetaErro } from "@/lib/meta";

/**
 * Instagram Direct e Messenger no Atendimento (migration 0157).
 *
 * As conversas das redes entram na mesma caixa do WhatsApp. Como a conversa é
 * única pelo "telefone", o contato das redes usa um prefixo no lugar do número:
 *   ig:<id do remetente no Instagram>   ·   fb:<id do remetente no Messenger>
 *
 * Variáveis (as mesmas da publicação, mais as de mensagens):
 *   FACEBOOK_PAGE_TOKEN       token da página com pages_messaging e
 *                             instagram_manage_messages (senão META_ACCESS_TOKEN)
 *   META_VERIFY_TOKEN         texto combinado no webhook de mensagens
 *                             (senão vale o WHATSAPP_VERIFY_TOKEN)
 *   WHATSAPP_APP_SECRET       segredo do app, confere a assinatura do webhook
 */
const GRAPH = "https://graph.facebook.com/v23.0";

export type CanalAtendimento = "whatsapp" | "instagram" | "messenger" | "site" | "telegram";

export const CANAL_LABEL: Record<CanalAtendimento, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", site: "Chat do site", telegram: "Telegram" };

/** Canal de um contato pelo prefixo do identificador. */
export function canalDoContato(telefone: string): CanalAtendimento {
  if (telefone.startsWith("ig:")) return "instagram";
  if (telefone.startsWith("fb:")) return "messenger";
  if (telefone.startsWith("site:")) return "site"; // chat do site (0171)
  if (telefone.startsWith("tg:")) return "telegram"; // Telegram (0171)
  return "whatsapp";
}

export const contatoSocial = (telefone: string) => canalDoContato(telefone) !== "whatsapp";

const tokenPagina = () => process.env.FACEBOOK_PAGE_TOKEN || process.env.META_ACCESS_TOKEN || "";
export const mensagensSociaisConfiguradas = () => !!tokenPagina() && !!process.env.WHATSAPP_APP_SECRET;

/** Responde no Instagram Direct ou no Messenger (janela de 24 h da Meta). */
export async function enviarMensagemSocial(telefone: string, texto: string): Promise<string> {
  const token = tokenPagina();
  if (!token) throw new MetaErro("Instagram/Messenger sem token da página (FACEBOOK_PAGE_TOKEN).");
  const id = telefone.slice(3);
  const r = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id }, messaging_type: "RESPONSE", message: { text: texto.slice(0, 1000) } }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!r) throw new MetaErro("A Meta não respondeu a tempo.", undefined, true);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`Meta mensagens → ${r.status}:`, JSON.stringify(j).slice(0, 400));
    const msg = j?.error?.code === 10 || j?.error?.error_subcode === 2018278
      ? "Passou da janela de 24 h da Meta: só dá para responder depois que o cliente escrever de novo."
      : j?.error?.error_user_msg || j?.error?.message || `A Meta recusou (HTTP ${r.status}).`;
    throw new MetaErro(msg, j?.error?.code, r.status >= 500);
  }
  return typeof j?.message_id === "string" ? j.message_id : "";
}

/**
 * Envia pelo canal certo da conversa: WhatsApp (número), redes (ig:/fb:),
 * Telegram (tg:) ou chat do site (site:). No chat do site não há envio
 * externo: a mensagem gravada em whatsapp_mensagens é o que o visitante lê.
 */
export async function enviarPeloCanal(telefone: string, texto: string, canalWhatsapp?: string) {
  const canal = canalDoContato(telefone);
  if (canal === "site") return "";
  if (canal === "telegram") return enviarTelegram(telefone.slice(3), texto);
  return contatoSocial(telefone) ? enviarMensagemSocial(telefone, texto) : enviarWhatsapp(telefone, texto, canalWhatsapp);
}

export const telegramConfigurado = () => !!process.env.TELEGRAM_BOT_TOKEN?.trim();

/** Responde no Telegram pelo bot da ARINI (TELEGRAM_BOT_TOKEN). */
export async function enviarTelegram(chatId: string, texto: string): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new MetaErro("Telegram sem o token do bot (TELEGRAM_BOT_TOKEN).");
  if (!/^-?\d{1,20}$/.test(chatId)) throw new MetaErro("Conversa do Telegram inválida.");
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: texto.slice(0, 4000) }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) throw new MetaErro("O Telegram não respondeu a tempo.", undefined, true);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new MetaErro(j?.description || `O Telegram recusou (HTTP ${r.status}).`, undefined, r.status >= 500);
  return j?.result?.message_id != null ? `tg:${chatId}:${j.result.message_id}` : "";
}
