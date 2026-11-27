/**
 * Antes de baixar um KML/KMZ montado no navegador, registra o download na cota
 * do mês do plano (limites por assinatura, 26/11/2026). Lança com a explicação
 * quando a cota acabou ou outro aparelho entrou na conta.
 */
export async function liberarDownload(formato: "kml" | "kmz", origem: string) {
  const r = await fetch("/api/conta/downloads", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formato, origem }),
  }).catch(() => null);
  // sem rede para conferir: não trava o trabalho de quem está no campo
  if (!r || r.ok || r.status >= 500) return;
  const d = await r.json().catch(() => ({})) as { error?: string; solucao?: string };
  throw new Error([d.error || "Download não liberado.", d.solucao].filter(Boolean).join(" "));
}
