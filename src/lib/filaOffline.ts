/**
 * Modo de campo (Central de CRMs): o que o colaborador registra sem internet
 * fica guardado no aparelho e é enviado quando a conexão volta. Usado pelo
 * ponto e pelo relatório de visita. Só no navegador.
 */
export type ItemFila = { id: string; url: string; method: string; corpo: Record<string, unknown>; criado_em: string; rotulo: string };

const CHAVE = "arini-fila-offline";

export function lerFila(): ItemFila[] {
  try { return JSON.parse(localStorage.getItem(CHAVE) ?? "[]") as ItemFila[]; } catch { return []; }
}
function gravar(f: ItemFila[]) {
  try { localStorage.setItem(CHAVE, JSON.stringify(f)); } catch { /* armazenamento cheio ou bloqueado */ }
  window.dispatchEvent(new Event("arini-fila"));
}

export function enfileirar(item: Omit<ItemFila, "id" | "criado_em">) {
  gravar([...lerFila(), { ...item, id: crypto.randomUUID(), criado_em: new Date().toISOString() }]);
}

/** Envia o que estiver na fila. Devolve quantos foram enviados. */
export async function sincronizar(): Promise<number> {
  let enviados = 0;
  for (const item of lerFila()) {
    try {
      const r = await fetch(item.url, { method: item.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.corpo) });
      // erro de regra (4xx) não adianta repetir: sai da fila
      if (r.ok || (r.status >= 400 && r.status < 500)) {
        gravar(lerFila().filter((x) => x.id !== item.id));
        if (r.ok) enviados++;
      }
    } catch { break; /* ainda sem conexão */ }
  }
  return enviados;
}

/** fetch que, sem conexão, guarda o pedido na fila em vez de falhar. */
export async function enviarOuGuardar(url: string, method: string, corpo: Record<string, unknown>, rotulo: string, corpoOffline?: Record<string, unknown>) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    enfileirar({ url, method, corpo: corpoOffline ?? corpo, rotulo });
    return { offline: true as const };
  }
  try {
    return { offline: false as const, resposta: await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }) };
  } catch {
    enfileirar({ url, method, corpo: corpoOffline ?? corpo, rotulo });
    return { offline: true as const };
  }
}
