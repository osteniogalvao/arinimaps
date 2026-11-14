/**
 * Modo de campo (Central de CRMs): o que o colaborador registra sem internet
 * fica guardado no aparelho e é enviado quando a conexão volta. Usado pelo
 * ponto e pelo relatório de visita. Só no navegador.
 */
export type ItemFila = { id: string; url: string; method: string; corpo: Record<string, unknown>; criado_em: string; rotulo: string };

const CHAVE = "arini-fila-offline";
const PONTO = "/api/admin/ponto";
const CHAVE_PONTO = "arini-ponto-offline:";

export function lerFila(): ItemFila[] {
  try {
    const legados: ItemFila[] = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    const pontos: ItemFila[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const chave = localStorage.key(i);
      if (chave?.startsWith(CHAVE_PONTO)) pontos.push(JSON.parse(localStorage.getItem(chave)!));
    }
    return [...legados.filter((l) => !pontos.some((p) => p.id === l.id)), ...pontos];
  } catch { return []; }
}
function gravarLegados(f: ItemFila[]) {
  localStorage.setItem(CHAVE, JSON.stringify(f));
  window.dispatchEvent(new Event("arini-fila"));
}

export function enfileirar(item: Omit<ItemFila, "id" | "criado_em">) {
  const id = item.url === PONTO ? String(item.corpo.registro_cliente) : crypto.randomUUID();
  const novo = { ...item, id, criado_em: new Date().toISOString() };
  if (item.url === PONTO) {
    localStorage.setItem(CHAVE_PONTO + id, JSON.stringify(novo));
    window.dispatchEvent(new Event("arini-fila"));
  } else {
    const legados = JSON.parse(localStorage.getItem(CHAVE) ?? "[]") as ItemFila[];
    gravarLegados([...legados, novo]);
  }
}

// Registros antigos não continham a identidade de quem marcou. Só vincular após
// a pessoa reconhecer explicitamente o horário no seu espelho.
export function assumirPontoLegado(id: string, userId: string) {
  const item = lerFila().find((i) => i.url === PONTO && i.id === id && !i.corpo.user_id);
  if (!item) return;
  const corpo = { ...item.corpo, registro_cliente: item.id, user_id: userId };
  localStorage.setItem(CHAVE_PONTO + id, JSON.stringify({ ...item, corpo }));
  gravarLegados((JSON.parse(localStorage.getItem(CHAVE) ?? "[]") as ItemFila[]).filter((i) => i.id !== id));
}
export const pontosPendentes = (userId: string) => lerFila().filter((i) => i.url === PONTO && (!i.corpo.user_id || i.corpo.user_id === userId));

/** Envia o que estiver na fila. Devolve quantos foram enviados. */
export async function sincronizar(userId: string): Promise<number> {
  let enviados = 0;
  for (const item of lerFila().sort((a,b) => a.criado_em.localeCompare(b.criado_em))) {
    const ponto = item.url === PONTO;
    if (ponto && (item.corpo.user_id !== userId || item.corpo.erro_local)) continue;
    try {
      const r = await fetch(item.url, { method: item.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.corpo) });
      if (ponto) {
        const resposta = await r.json().catch(() => null);
        if (r.ok && resposta?.comprovante?.id) {
          localStorage.removeItem(CHAVE_PONTO + item.id);
          window.dispatchEvent(new Event("arini-fila"));
          enviados++;
        } else if (r.status === 400 || r.status === 409) {
          localStorage.setItem(CHAVE_PONTO + item.id, JSON.stringify({ ...item, corpo: { ...item.corpo, erro_local: resposta?.error ?? "Confira o espelho e peça um ajuste." } }));
          window.dispatchEvent(new Event("arini-fila"));
        } else break;
      } else if (r.ok || (r.status >= 400 && r.status < 500)) {
        gravarLegados((JSON.parse(localStorage.getItem(CHAVE) ?? "[]") as ItemFila[]).filter((x) => x.id !== item.id));
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
    const resposta = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    if (resposta.status < 500 || url !== PONTO) return { offline: false as const, resposta };
  } catch {
    // Falha de rede: preserve a chave original para conferir se o servidor já gravou.
  }
  enfileirar({ url, method, corpo: corpoOffline ?? corpo, rotulo });
  return { offline: true as const };
}
