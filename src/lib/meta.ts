import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Integrações da Meta (Central de CRMs, etapa 4): publicação no Instagram e no
 * Facebook e conversa pelo WhatsApp Business (Cloud API). Cada uma liga
 * sozinha quando as variáveis existem; sem elas, as telas avisam o que falta
 * e o resto do sistema segue igual (mesmo padrão do Asaas).
 *
 *   META_ACCESS_TOKEN        token de sistema com instagram_content_publish, pages_manage_posts
 *   INSTAGRAM_USER_ID        id da conta profissional do Instagram
 *   FACEBOOK_PAGE_ID         id da página (opcional)
 *   FACEBOOK_PAGE_TOKEN      token da página (opcional; senão usa META_ACCESS_TOKEN)
 *   WHATSAPP_TOKEN           token da Cloud API
 *   WHATSAPP_PHONE_ID        id do número que envia
 *   WHATSAPP_VERIFY_TOKEN    texto combinado na configuração do webhook
 *   WHATSAPP_APP_SECRET      segredo do app (confere a assinatura do webhook)
 */
const GRAPH = "https://graph.facebook.com/v23.0";

export const instagramConfigurado = () => !!process.env.META_ACCESS_TOKEN && !!process.env.INSTAGRAM_USER_ID;
export const facebookConfigurado = () => !!process.env.FACEBOOK_PAGE_ID && !!(process.env.FACEBOOK_PAGE_TOKEN || process.env.META_ACCESS_TOKEN);
export const whatsappConfigurado = () => !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_ID;

export class MetaErro extends Error {
  constructor(public mensagem: string, public codigo?: number, public entregaIncerta = false) { super(mensagem); }
}

async function graph<T>(caminho: string, params: Record<string, string>, token: string): Promise<T> {
  const r = await fetch(`${GRAPH}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!r) throw new MetaErro("A Meta não respondeu a tempo.", undefined, true);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`Meta ${caminho} → ${r.status}:`, JSON.stringify(j).slice(0, 400));
    throw new MetaErro(j?.error?.error_user_msg || j?.error?.message || `A Meta recusou (HTTP ${r.status}).`, j?.error?.code, r.status >= 500);
  }
  if (!j?.id) throw new MetaErro("A resposta da Meta não trouxe o identificador.", undefined, true);
  return j as T;
}

/** Instagram: uma foto ou carrossel (até 10). As URLs precisam ser públicas. */
export async function publicarInstagram(imagens: string[], legenda: string) {
  if (!instagramConfigurado()) throw new MetaErro("Instagram não configurado (META_ACCESS_TOKEN e INSTAGRAM_USER_ID).");
  if (!imagens.length) throw new MetaErro("O imóvel não tem foto para publicar.");
  const token = process.env.META_ACCESS_TOKEN!;
  const ig = process.env.INSTAGRAM_USER_ID!;
  let criacao: string;
  if (imagens.length === 1) {
    criacao = (await graph<{ id: string }>(`/${ig}/media`, { image_url: imagens[0], caption: legenda }, token)).id;
  } else {
    const filhos: string[] = [];
    for (const url of imagens.slice(0, 10)) {
      filhos.push((await graph<{ id: string }>(`/${ig}/media`, { image_url: url, is_carousel_item: "true" }, token)).id);
    }
    criacao = (await graph<{ id: string }>(`/${ig}/media`, { media_type: "CAROUSEL", children: filhos.join(","), caption: legenda }, token)).id;
  }
  // o contêiner leva alguns segundos para ficar pronto
  for (let i = 0; i < 6; i++) {
    try {
      const pub = await graph<{ id: string }>(`/${ig}/media_publish`, { creation_id: criacao }, token);
      return { id: pub.id, link: null as string | null };
    } catch (e) {
      // 9007 indica explicitamente que o contêiner ainda não está pronto.
      if (!(e instanceof MetaErro) || e.codigo !== 9007 || i === 5) throw e;
      await new Promise((ok) => setTimeout(ok, 4000));
    }
  }
  throw new MetaErro("O Instagram não terminou de processar as fotos.");
}

/** Facebook: post da página com a primeira foto e o link do anúncio. */
export async function publicarFacebook(imagem: string | null, legenda: string, link: string) {
  if (!facebookConfigurado()) throw new MetaErro("Facebook não configurado (FACEBOOK_PAGE_ID).");
  const token = process.env.FACEBOOK_PAGE_TOKEN || process.env.META_ACCESS_TOKEN!;
  const page = process.env.FACEBOOK_PAGE_ID!;
  const r = imagem
    ? await graph<{ id: string; post_id?: string }>(`/${page}/photos`, { url: imagem, caption: `${legenda}\n\n${link}` }, token)
    : await graph<{ id: string }>(`/${page}/feed`, { message: legenda, link }, token);
  const id = ("post_id" in r && r.post_id) || r.id;
  return { id, link: `https://www.facebook.com/${id}` };
}

/** Telefone brasileiro só com dígitos e DDI 55. */
export function telefoneWhatsapp(t: string | null | undefined) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
}

/** WhatsApp: mensagem de texto (dentro das 24 h depois da última mensagem do cliente). */
export async function enviarWhatsapp(telefone: string, texto: string) {
  if (!whatsappConfigurado()) throw new MetaErro("WhatsApp não configurado (WHATSAPP_TOKEN e WHATSAPP_PHONE_ID).");
  const r = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: telefone, type: "text", text: { body: texto.slice(0, 4000) } }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) throw new MetaErro("O WhatsApp não respondeu a tempo.");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = j?.error?.code;
    // 131047: fora da janela de 24 h, só modelo aprovado pela Meta
    throw new MetaErro(code === 131047
      ? "Passaram 24 h desde a última mensagem do cliente: o WhatsApp só aceita um modelo aprovado. Ligue ou mande pelo seu WhatsApp."
      : j?.error?.message ?? `O WhatsApp recusou (HTTP ${r.status}).`);
  }
  return String(j?.messages?.[0]?.id ?? "");
}

/** Confere a assinatura X-Hub-Signature-256 do webhook. */
export function assinaturaWebhookOk(corpo: string, assinatura: string | null) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo || !assinatura?.startsWith("sha256=")) return false;
  const esperado = Buffer.from("sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex"));
  const recebido = Buffer.from(assinatura);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
