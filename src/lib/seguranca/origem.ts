/**
 * Conferência de origem das requisições que mudam dados (CSRF).
 *
 * O cookie de sessão do Supabase é SameSite=Lax, o que já impede o navegador
 * de mandá-lo num POST vindo de outro site. Esta trava é a segunda camada,
 * pedida no item 14 dos requisitos: toda requisição POST/PUT/PATCH/DELETE às
 * APIs precisa vir do próprio site. O navegador manda o cabeçalho `Origin` em
 * todo POST/PUT/PATCH/DELETE feito por fetch ou formulário; quando falta
 * (versões antigas), vale o `Sec-Fetch-Site`.
 *
 * Chamada de servidor para servidor (sem Origin e sem Sec-Fetch-Site, como o
 * webhook do Asaas ou um script de teste com curl) passa: CSRF é um ataque
 * que depende do navegador da vítima, e essas rotas têm trava própria.
 *
 * Usa só APIs da Web: roda no proxy (src/proxy.ts) e dentro das rotas.
 */
const METODOS_MUTAVEIS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Rotas chamadas por servidores de fora, com autenticação própria. */
const ISENTAS = [
  "/api/asaas/webhook", // token do webhook (ASAAS_WEBHOOK_TOKEN)
  "/api/webhooks/whatsapp", // assinatura da Meta (WHATSAPP_APP_SECRET)
  "/api/interno/publicar", // worker, com SAUDE_TOKEN
];

function hostDe(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts aceitos como origem: o do próprio pedido, o do site e os extras do ambiente. */
function hostsPermitidos(request: Request) {
  const hosts = new Set<string>();
  const doPedido = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (doPedido) hosts.add(doPedido.split(",")[0].trim().toLowerCase());
  const daUrl = hostDe(request.url);
  if (daUrl) hosts.add(daUrl);
  const site = hostDe(process.env.NEXT_PUBLIC_SITE_URL);
  if (site) hosts.add(site);
  // ORIGENS_PERMITIDAS="https://homolog.arinibrasil.com.br,https://outro" — opcional
  for (const o of (process.env.ORIGENS_PERMITIDAS ?? "").split(",")) {
    const h = hostDe(o.trim());
    if (h) hosts.add(h);
  }
  return hosts;
}

export type ResultadoOrigem = { ok: true } | { ok: false; motivo: string };

/** A requisição que muda dados veio do próprio site? GET/HEAD/OPTIONS sempre passam. */
export function conferirOrigem(request: Request, pathname?: string): ResultadoOrigem {
  if (!METODOS_MUTAVEIS.has(request.method.toUpperCase())) return { ok: true };
  const caminho = pathname ?? new URL(request.url).pathname;
  if (ISENTAS.some((p) => caminho === p || caminho.startsWith(p + "/"))) return { ok: true };

  const origem = request.headers.get("origin");
  if (origem) {
    if (origem === "null") return { ok: false, motivo: "origem nula (iframe isolado ou arquivo local)" };
    const host = hostDe(origem);
    if (host && hostsPermitidos(request).has(host)) return { ok: true };
    return { ok: false, motivo: `origem ${origem} não é o site` };
  }

  // sem Origin: o navegador ainda diz de onde veio o pedido
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return { ok: false, motivo: "pedido vindo de outro site" };
  return { ok: true };
}

/** Resposta 403 padronizada (mesmo envelope de src/lib/erros.ts). */
export function respostaOrigemNegada(motivo: string) {
  return Response.json(
    {
      error: "Pedido recusado: ele não partiu de uma página do Arini Imóveis Brasil.",
      motivo,
      solucao: "Recarregue a página do sistema e tente de novo. Se usa uma extensão que altera pedidos, desative-a.",
      codigo: "origem_invalida",
    },
    { status: 403 }
  );
}
