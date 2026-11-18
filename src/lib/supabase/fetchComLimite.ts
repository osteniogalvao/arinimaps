/**
 * fetch com tempo-limite para os clientes do Supabase.
 *
 * Sem isto, quando o banco trava (18/11/2026: projeto do Supabase dando 522),
 * cada página fica esperando para sempre e o navegador mostra "carregando" sem
 * fim. Com o limite, a leitura falha, o código cai no padrão/erro e a página
 * termina de carregar.
 */
export function fetchComLimite(ms: number): typeof fetch {
  return (input, init) => {
    const limite = AbortSignal.timeout(ms);
    const sinal = init?.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([init.signal, limite])
      : (init?.signal ?? limite);
    return fetch(input, { ...init, signal: sinal });
  };
}
