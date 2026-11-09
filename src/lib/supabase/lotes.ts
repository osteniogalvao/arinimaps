import "server-only";

/**
 * Lê TODAS as linhas de uma consulta, em lotes de `tamanho`.
 *
 * O PostgREST devolve no máximo 1000 linhas por pedido e corta o resto sem
 * avisar. Para exportação (CSV) e somas que precisam do conjunto inteiro, a
 * consulta é refeita com `.range()` até vir um lote incompleto.
 *
 * `montar` recebe o intervalo e devolve a consulta já com `.range(de, ate)` —
 * o construtor do Supabase não pode ser reaproveitado entre pedidos. A
 * consulta precisa de `.order()` estável, senão um lote pode repetir ou pular
 * linhas.
 */
export async function lerEmLotes<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { tamanho = 1000, maximo = 200_000 }: { tamanho?: number; maximo?: number } = {}
): Promise<{ data: T[]; error: { message: string } | null }> {
  const todas: T[] = [];
  for (let de = 0; de < maximo; de += tamanho) {
    const { data, error } = await montar(de, de + tamanho - 1);
    if (error) return { data: todas, error };
    todas.push(...(data ?? []));
    if (!data || data.length < tamanho) break;
  }
  return { data: todas, error: null };
}

/** Página pedida em `?pagina=` (1 em diante) e o intervalo para `.range()`. */
export function paginaDe(valor: string | string[] | undefined, porPagina: number) {
  const n = Math.max(1, Math.floor(Number(Array.isArray(valor) ? valor[0] : valor) || 1));
  return { pagina: n, de: (n - 1) * porPagina, ate: n * porPagina - 1 };
}
