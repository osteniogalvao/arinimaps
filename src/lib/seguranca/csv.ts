/** Mantém conteúdo livre em uma célula de texto ao abrir o CSV no Excel ou Calc. */
export function textoCsv(valor: unknown): string {
  const texto = String(valor ?? "");
  const seguro = /^\s*[=+@\-＝＋＠－]/u.test(texto) ? "'" + texto : texto;
  return '"' + seguro.replace(/"/g, '""') + '"';
}
