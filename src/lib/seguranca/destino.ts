/**
 * Destino de volta depois de entrar (?volta=..., /api/acesso etc.).
 *
 * Só aceita um caminho interno do próprio site. Roda no servidor e no navegador
 * (sem dependência do Node). Recusa:
 * - caracteres de controle (\x00-\x1f, \x7f): o navegador descarta tab e quebra
 *   de linha da URL, então "/\t/evil.com" vira "//evil.com";
 * - barra invertida: o navegador a trata como "/" ("/\evil.com" = "//evil.com");
 * - qualquer coisa que, resolvida contra uma origem fictícia, saia dela.
 */
const ORIGEM_FICTICIA = "https://x";

export function destinoSeguro(volta: unknown, padrao = "/"): string {
  if (typeof volta !== "string" || !volta || volta.length > 2000) return padrao;
  if (!volta.startsWith("/") || volta.startsWith("//")) return padrao;
  if (/[\x00-\x1f\x7f\\]/.test(volta)) return padrao;
  try {
    const u = new URL(volta, ORIGEM_FICTICIA);
    if (u.origin !== ORIGEM_FICTICIA) return padrao;
    const caminho = u.pathname + u.search + u.hash;
    // o caminho normalizado também não pode virar "//host"
    if (!caminho.startsWith("/") || caminho.startsWith("//")) return padrao;
    return caminho;
  } catch {
    return padrao;
  }
}
