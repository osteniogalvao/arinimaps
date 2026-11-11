/**
 * Senha de bloqueio do site inteiro (fase de testes, antes do lançamento).
 *
 * Ligada quando a variável SITE_SENHA existe; sem ela o site fica aberto.
 * Quem digita a senha certa recebe um cookie com um HMAC da senha — trocar a
 * SITE_SENHA no servidor derruba todos os acessos liberados de uma vez.
 *
 * Usa só Web Crypto para rodar no proxy sem depender de módulo do Node.
 */
export const COOKIE_BLOQUEIO = "arini_acesso";
export const BLOQUEIO_DIAS = 30;

/** Caminhos que precisam abrir sem a senha. */
const LIVRES = [
  "/acesso",
  "/api/acesso",
  "/api/asaas/webhook", // servidor do Asaas chamando; tem token próprio
  "/api/saude", // monitor externo (Uptime Kuma etc.); sem token só responde ok/falha
  "/api/webhooks/whatsapp", // servidor da Meta; confere a assinatura
  "/api/interno/publicar", // worker; confere o SAUDE_TOKEN
  "/api/feeds/portais", // portais imobiliários lendo o feed XML
];

export function bloqueioAtivo() {
  return !!process.env.SITE_SENHA;
}

export function caminhoLivre(pathname: string) {
  return LIVRES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

async function hmac(texto: string) {
  const segredo = process.env.SITE_BLOQUEIO_SEGREDO || process.env.SUPABASE_SERVICE_ROLE_KEY || "arini";
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign("HMAC", chave, enc.encode(texto));
  return Array.from(new Uint8Array(assinatura), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Valor do cookie para a senha atual. */
export function fichaDeAcesso() {
  return hmac("arini-bloqueio:v1:" + (process.env.SITE_SENHA ?? ""));
}

function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function cookieValido(valor: string | undefined) {
  if (!valor) return false;
  return iguais(valor, await fichaDeAcesso());
}

/** Compara a senha digitada sem vazar o tamanho por tempo de resposta. */
export async function senhaConfere(digitada: string) {
  const certa = process.env.SITE_SENHA;
  if (!certa) return false;
  return iguais(await hmac("cmp:" + digitada), await hmac("cmp:" + certa));
}

// destinoSeguro (caminho de volta depois de entrar) mora em ./destino.ts:
// é usado também no navegador.

// ---------------------------------------------------------------------------
// Prévia de link com o site travado (SITE_SENHA_PREVIA=1)
// ---------------------------------------------------------------------------
//
// Com a SITE_SENHA ligada, os robôs que montam a prévia de um link compartilhado
// (WhatsApp, Facebook, Telegram, Slack, X, LinkedIn) caem em /acesso e o link
// vai sem foto nem título. Com SITE_SENHA_PREVIA=1 (padrão: desligada), esses
// robôs recebem uma página só com as metatags (título, descrição, og:*,
// twitter:*) das páginas públicas abaixo. O corpo da página nunca sai: o proxy
// busca a página internamente com a ficha de acesso e devolve só o <head>.
// O user-agent pode ser forjado, por isso só as metatags (o que a pessoa que
// compartilhou já expõe) e só nestes caminhos.

/** user-agents dos robôs de prévia de link */
const ROBOS_PREVIA =
  /facebookexternalhit|facebookcatalog|meta-externalagent|WhatsApp|TelegramBot|Slackbot|Twitterbot|LinkedInBot/i;

/** home, ficha do imóvel, link curto, mercado e planos */
const CAMINHOS_PREVIA = [/^\/$/, /^\/imovel\/[A-Za-z0-9-]+\/?$/, /^\/i\/[A-Za-z0-9-]+\/?$/, /^\/mercado\/?$/, /^\/planos\/?$/];

export function previaAtiva() {
  return bloqueioAtivo() && process.env.SITE_SENHA_PREVIA === "1";
}

/** O pedido é de um robô de prévia, num caminho liberado para prévia? */
export function pedidoDePrevia(metodo: string, pathname: string, userAgent: string | null) {
  if (!previaAtiva()) return false;
  if (metodo !== "GET" && metodo !== "HEAD") return false;
  if (!userAgent || !ROBOS_PREVIA.test(userAgent)) return false;
  return CAMINHOS_PREVIA.some((r) => r.test(pathname));
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPE[c]);
/** o HTML do Next já vem escapado: desfaz antes de escapar de novo */
const desfaz = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Extrai do HTML só o <title> e as metatags de prévia. Reconstrói cada tag a
 * partir dos atributos (nada do HTML original passa adiante como está).
 */
export function soMetatags(html: string) {
  const tags: string[] = [];
  const titulo = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  if (titulo) tags.push(`<title>${esc(desfaz(titulo))}</title>`);
  for (const m of html.matchAll(/<meta\s+([^>]+?)\/?>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[a[1].toLowerCase()] = a[2];
    const chave = attrs.property ?? attrs.name;
    if (!chave || attrs.content == null) continue;
    if (!/^(og:|twitter:|description$|theme-color$)/i.test(chave)) continue;
    const tipo = attrs.property ? "property" : "name";
    tags.push(`<meta ${tipo}="${esc(chave)}" content="${esc(desfaz(attrs.content))}">`);
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${tags.join("")}</head><body></body></html>`;
}

/**
 * Origem FIXA para a busca interna da prévia. Nunca o host do pedido: o
 * Host/X-Forwarded-Host vem do cliente, e a busca leva a ficha de acesso no
 * cookie (com Host: evil.com, a ficha iria para evil.com).
 * SITE_URL_INTERNA permite apontar outro endereço interno, se o Next não
 * escutar em 127.0.0.1.
 */
function origemInterna() {
  const interna = process.env.SITE_URL_INTERNA || `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  return new URL(interna).origin;
}

/** só ?chave=valor simples; o resto da busca é descartado */
function buscaSegura(search: string) {
  return search.length <= 200 && /^\?[A-Za-z0-9_.~%=&-]*$/.test(search) ? search : "";
}

/** o /i/<codigo> responde 307 para a ficha do imóvel: único redirect seguido */
const DESTINO_REDIRECT = /^\/imovel\/[A-Za-z0-9-]+\/?$/;

/**
 * Resposta para o robô de prévia: busca a própria página com a ficha de acesso
 * (e o user-agent do robô, para o Next pôr as metatags no <head> em vez de
 * transmiti-las depois) e devolve só as metatags. Falhou? null, e o proxy
 * segue o caminho normal (redireciona para /acesso).
 */
export async function respostaPrevia(pathname: string, search: string, userAgent: string): Promise<Response | null> {
  if (!CAMINHOS_PREVIA.some((r) => r.test(pathname))) return null;
  try {
    const origem = origemInterna();
    const ficha = await fichaDeAcesso();
    const buscar = (caminho: string) =>
      fetch(new URL(caminho, origem), {
        headers: { cookie: `${COOKIE_BLOQUEIO}=${ficha}`, "user-agent": userAgent, accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
    let r = await buscar(pathname + buscaSegura(search));
    if (r.status >= 300 && r.status < 400) {
      // no máximo 1 redirect, e só para a ficha do imóvel; o host do Location é ignorado
      const location = r.headers.get("location");
      if (!location) return null;
      const destino = new URL(location, origem).pathname;
      if (!DESTINO_REDIRECT.test(destino)) return null;
      r = await buscar(destino);
    }
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("text/html")) return null;
    return new Response(soMetatags(await r.text()), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, max-age=300",
        vary: "User-Agent",
        "x-robots-tag": "noindex",
      },
    });
  } catch {
    return null;
  }
}
