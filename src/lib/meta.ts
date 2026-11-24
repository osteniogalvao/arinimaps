import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  EvolutionErro, evolutionConfigurada, evolutionMidia, evolutionNumero, evolutionTexto,
} from "@/lib/whatsapp/evolution";

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
 *
 * O WhatsApp também pode sair pela Evolution API (lib/whatsapp/evolution.ts).
 * Com as duas configuradas, vale a Evolution; WHATSAPP_PROVEDOR=meta força a Meta.
 */
const GRAPH = "https://graph.facebook.com/v23.0";

export const instagramConfigurado = () => !!process.env.META_ACCESS_TOKEN && !!process.env.INSTAGRAM_USER_ID;
export const facebookConfigurado = () => !!process.env.FACEBOOK_PAGE_ID && !!(process.env.FACEBOOK_PAGE_TOKEN || process.env.META_ACCESS_TOKEN);
const metaWhatsappConfigurado = () => !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_ID;

/** Qual provedor envia e recebe o WhatsApp da ARINI. */
export function provedorWhatsapp(): "evolution" | "meta" | null {
  const forcado = (process.env.WHATSAPP_PROVEDOR ?? "").trim().toLowerCase();
  if (forcado === "meta") return metaWhatsappConfigurado() ? "meta" : null;
  if (evolutionConfigurada()) return "evolution";
  if (forcado === "evolution") return null;
  return metaWhatsappConfigurado() ? "meta" : null;
}
const viaEvolution = () => provedorWhatsapp() === "evolution";
export const whatsappConfigurado = () => provedorWhatsapp() !== null;

/**
 * Segredo das assinaturas internas do WhatsApp (código de confirmação do número
 * e autorização de lembretes). Na Meta é o segredo do app; na Evolution, o do webhook.
 */
export function segredoWhatsapp() {
  return viaEvolution() ? process.env.EVOLUTION_WEBHOOK_TOKEN || null : process.env.WHATSAPP_APP_SECRET || null;
}

/** Erros da Evolution no mesmo formato dos da Meta, que as telas já tratam. */
async function naEvolution<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); }
  catch (e) {
    if (e instanceof EvolutionErro) throw new MetaErro(e.mensagem, e.status, e.entregaIncerta);
    throw e;
  }
}

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

export async function numeroDaApiWhatsapp() {
  if (!whatsappConfigurado()) return null;
  if (viaEvolution()) {
    const n = await evolutionNumero().catch(() => null);
    return n ? telefoneWhatsapp(n) : null;
  }
  const r=await fetch(GRAPH+"/"+process.env.WHATSAPP_PHONE_ID+"?fields=display_phone_number",{
    headers:{Authorization:"Bearer "+process.env.WHATSAPP_TOKEN},signal:AbortSignal.timeout(8_000),cache:"no-store"});
  if(!r.ok)return null;
  return telefoneWhatsapp((await r.json()).display_phone_number);
}

/** Telefone brasileiro só com dígitos e DDI 55. */
export function telefoneWhatsapp(t: string | null | undefined) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
}

/** WhatsApp: mensagem de texto (dentro das 24 h depois da última mensagem do cliente). */
export async function enviarWhatsapp(telefone: string, texto: string, canal?: string) {
  if (viaEvolution()) return naEvolution(() => evolutionTexto(telefone, texto, canal));
  const phoneId = canal || process.env.WHATSAPP_PHONE_ID;
  if (!whatsappConfigurado() || !phoneId) throw new MetaErro("WhatsApp não configurado (WHATSAPP_TOKEN e WHATSAPP_PHONE_ID).");
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
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

/** WhatsApp: documento por link (a Meta baixa o arquivo), dentro das 24 h. */
export async function enviarDocumentoWhatsapp(telefone: string, link: string, nome: string, legenda: string, canal?: string) {
  if (viaEvolution()) return naEvolution(() => evolutionMidia(telefone, { tipo: "document", midia: link, mimetype: "application/pdf", nome, legenda }, canal));
  const phoneId = canal || process.env.WHATSAPP_PHONE_ID;
  if (!whatsappConfigurado() || !phoneId) throw new MetaErro("WhatsApp não configurado (WHATSAPP_TOKEN e WHATSAPP_PHONE_ID).");
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: telefone, type: "document", document: { link, filename: nome, caption: legenda.slice(0, 1000) } }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) throw new MetaErro("O WhatsApp não respondeu a tempo.");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new MetaErro(j?.error?.message ?? `O WhatsApp recusou (HTTP ${r.status}).`);
  return String(j?.messages?.[0]?.id ?? "");
}

/** WhatsApp: imagem por link público com legenda (cards de imóvel da Ari), dentro das 24 h. */
export async function enviarImagemWhatsapp(telefone: string, link: string, legenda: string, canal?: string) {
  if (viaEvolution()) return naEvolution(() => evolutionMidia(telefone, { tipo: "image", midia: link, mimetype: /\.png$/i.test(link) ? "image/png" : "image/jpeg", legenda }, canal));
  const phoneId = canal || process.env.WHATSAPP_PHONE_ID;
  if (!whatsappConfigurado() || !phoneId) throw new MetaErro("WhatsApp não configurado (WHATSAPP_TOKEN e WHATSAPP_PHONE_ID).");
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: telefone, type: "image", image: { link, caption: legenda.slice(0, 1000) } }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) throw new MetaErro("O WhatsApp não respondeu a tempo.");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new MetaErro(j?.error?.message ?? `O WhatsApp recusou (HTTP ${r.status}).`);
  return String(j?.messages?.[0]?.id ?? "");
}

/** O modelo aprovado usa um parâmetro de corpo {{1}} para o link público do imóvel. */
export async function modeloFiltroWhatsapp(finalidade: "filtro" | "monitoramento" = "filtro") {
  const id = finalidade === "monitoramento" ? process.env.WHATSAPP_MONITORAMENTO_TEMPLATE_ID : process.env.WHATSAPP_FILTRO_TEMPLATE_ID;
  return modeloWhatsappAprovado(id, 1, false, finalidade);
}

/**
 * Textos que substituem os modelos da Meta quando o envio é pela Evolution
 * (não há aprovação de modelo). {{n}} recebe o n-ésimo valor, como na Meta.
 */
export const TEXTOS_MODELO: Record<string, string> = {
  filtro: "ARINI: encontramos um imóvel que combina com o seu filtro. Veja: {{1}}\n\nPara não receber mais, ajuste em Minha conta > Filtros.",
  monitoramento: "ARINI: há novidades nas áreas que você monitora. Veja: {{1}}",
  pix: "Pix copia e cola da sua assinatura ARINI:\n{{1}}\n\nAcompanhe o pedido: {{2}}",
  fatura: "ARINI: a fatura da sua assinatura está disponível. Acesse para pagar: {{1}}",
  retomada: "Olá, {{1}}! Seu cadastro na ARINI ficou pela metade. Para concluir: {{2}}\n\nPara não receber mais, responda PARAR LEMBRETES.",
  assinatura: "Olá, {{1}}. Há uma novidade sobre a sua assinatura ARINI. Confira em Meus pedidos: {{2}}",
};

export type ModeloWhatsapp = { name: string; language: { code: string }; texto?: string };

/**
 * Meta: confere se o modelo está aprovado e tem os parâmetros esperados.
 * Evolution: o ID continua sendo o interruptor do aviso (qualquer número liga)
 * e o texto vem de TEXTOS_MODELO pela finalidade.
 */
export async function modeloWhatsappAprovado(id: string | undefined | null, parametros: number, comImagem=false, finalidade?: string): Promise<ModeloWhatsapp | null> {
  if (!whatsappConfigurado() || !id || !/^\d+$/.test(id)) return null;
  if (viaEvolution()) {
    const texto = (finalidade && TEXTOS_MODELO[finalidade])
      || Array.from({ length: parametros }, (_, i) => "{{" + (i + 1) + "}}").join("\n");
    return { name: "evolution:" + (finalidade ?? "texto"), language: { code: "pt_BR" }, texto };
  }
  const r = await fetch(GRAPH + "/" + id + "?fields=name,language,status,components", {
    headers: { Authorization: "Bearer " + process.env.WHATSAPP_TOKEN }, cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const m = await r.json() as { name?: string; language?: string; status?: string; components?: { type: string; text?: string; format?:string }[] };
  const corpo = m.components?.find((c) => c.type === "BODY");
  const cabecalho = m.components?.find(c=>c.type==="HEADER");
  if (comImagem ? cabecalho?.format!=="IMAGE" : cabecalho && (cabecalho.format!=="TEXT" || cabecalho.text?.includes("{{"))) return null;
  if (m.status !== "APPROVED" || !m.name || !m.language || corpo?.text?.match(/\{\{[^}]+\}\}/g)?.join("") !== Array.from({length:parametros}, (_, i) => "{{" + (i+1) + "}}").join("")) return null;
  return { name: m.name, language: { code: m.language } };
}

export async function enviarFiltroWhatsapp(telefone: string, link: string, modelo: ModeloWhatsapp) {
  return enviarModeloWhatsapp(telefone, [link], modelo);
}

export async function enviarModeloWhatsapp(telefone: string, valores: string[], modelo: ModeloWhatsapp, imagemId?:string) {
  if (viaEvolution()) {
    const texto = (modelo.texto ?? valores.map((_, i) => "{{" + (i + 1) + "}}").join("\n"))
      .replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? "");
    return naEvolution(() => imagemId?.startsWith("b64:")
      ? evolutionMidia(telefone, { tipo: "image", midia: imagemId.slice(4), mimetype: "image/png", nome: "pagamento-pix.png", legenda: texto })
      : evolutionTexto(telefone, texto));
  }
  const { texto: _texto, ...modeloMeta } = modelo;
  void _texto;
  const r = await fetch(GRAPH + "/" + process.env.WHATSAPP_PHONE_ID + "/messages", {
    method: "POST", headers: { Authorization: "Bearer " + process.env.WHATSAPP_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: telefone, type: "template", template: { ...modeloMeta,
      components: [...(imagemId?[{type:"header",parameters:[{type:"image",image:{id:imagemId}}]}]:[]), { type: "body", parameters: valores.map(text => ({type:"text", text})) }] } }),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!r || r.status >= 500) throw new MetaErro("Entrega incerta.", undefined, true);
  if (!r.ok) throw new MetaErro("Modelo recusado.", r.status);
  const msg = await r.json().catch(() => null);
  if (typeof msg?.messages?.[0]?.id !== "string") throw new MetaErro("Entrega sem confirmação.", undefined, true);
  return msg.messages[0].id as string;
}

export async function subirImagemWhatsapp(bytes:Uint8Array<ArrayBuffer>) {
  // A Evolution recebe a imagem junto com a mensagem (base64), sem upload prévio.
  if (viaEvolution()) return "b64:" + Buffer.from(bytes).toString("base64");
  const form=new FormData();
  form.set("messaging_product","whatsapp");
  form.set("file",new Blob([bytes],{type:"image/png"}),"pagamento-pix.png");
  const r=await fetch(GRAPH+"/"+process.env.WHATSAPP_PHONE_ID+"/media",{method:"POST",
    headers:{Authorization:"Bearer "+process.env.WHATSAPP_TOKEN},body:form,signal:AbortSignal.timeout(12_000)});
  if(!r.ok) throw new MetaErro("O WhatsApp recusou a imagem.");
  const m=await r.json();
  if(typeof m?.id!=="string") throw new MetaErro("O WhatsApp não retornou a imagem.");
  return m.id as string;
}

/** Resposta de serviço com a imagem privada. O chamador reserva uma janela comprovada antes do envio. */
export async function enviarPixNaJanela(telefone:string,imagem:string,codigo:string) {
  if (viaEvolution()) return naEvolution(() => evolutionMidia(telefone, { tipo: "image", midia: imagem.replace(/^b64:/, ""), mimetype: "image/png", nome: "pagamento-pix.png", legenda: codigo }));
  const r=await fetch(GRAPH+"/"+process.env.WHATSAPP_PHONE_ID+"/messages",{method:"POST",
    headers:{Authorization:"Bearer "+process.env.WHATSAPP_TOKEN,"Content-Type":"application/json"},
    body:JSON.stringify({messaging_product:"whatsapp",to:telefone,type:"image",image:{id:imagem,caption:codigo}}),
    signal:AbortSignal.timeout(12_000)}).catch(()=>null);
  if(!r || r.status>=500)throw new MetaErro("Entrega incerta.",undefined,true);
  if(!r.ok)throw new MetaErro("O WhatsApp recusou o Pix.",r.status);
  const id=(await r.json().catch(()=>null))?.messages?.[0]?.id;
  if(typeof id!=="string")throw new MetaErro("Entrega sem confirmação.",undefined,true);
  return id;
}

/** Confere a assinatura X-Hub-Signature-256 do webhook. */
export function assinaturaWebhookOk(corpo: string | Uint8Array, assinatura: string | null) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo || !assinatura?.startsWith("sha256=")) return false;
  const esperado = Buffer.from("sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex"));
  const recebido = Buffer.from(assinatura);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
