/** O endereço fica como link público do gestor. O servidor nunca busca o recurso externo. */
export function validarProjeto(valor: unknown): string | null | false {
  if (valor == null || valor === "") return null;
  if (typeof valor !== "string" || valor.length > 2048) return false;
  try {
    const url = new URL(valor.trim());
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")
        || /^[\d.]+$/.test(url.hostname) || /\.(local|internal|localhost)$/i.test(url.hostname)) return false;
    return url.href;
  } catch { return false; }
}
