/**
 * Apartamento (ou sala) dentro de um prédio — pedido do Carlos, áudio de
 * 18/11/2026 16h57: "se for apartamento, selecionar que é apartamento e qual
 * andar; naquele prédio há três apartamentos, a pessoa clica e abre os três".
 *
 * Os dados ficam em `properties.caracteristicas` (jsonb que já existe), então
 * não há migration: `subtipo` ("apartamento" | "sala"), `andar` (inteiro; 0 é o
 * térreo, negativo é subsolo) e `unidade` (o número na porta, ex.: "302").
 * O prédio é o imóvel pai (`parent_property_id`, migration 0009).
 */

export const SUBTIPOS_UNIDADE = [
  { valor: "apartamento", rotulo: "Apartamento" },
  { valor: "sala", rotulo: "Sala comercial" },
] as const;
export type SubtipoUnidade = (typeof SUBTIPOS_UNIDADE)[number]["valor"];

export type DadosUnidade = {
  subtipo: SubtipoUnidade | null;
  andar: number | null;
  unidade: string | null;
};

const ANDAR_MIN = -5;
const ANDAR_MAX = 200;

function lerAndar(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "t" || s.startsWith("térreo") || s.startsWith("terreo")) return 0;
  const n = Number(s.replace(/[ºª°]/g, ""));
  if (!Number.isInteger(n) || n < ANDAR_MIN || n > ANDAR_MAX) return null;
  return n;
}

/** Lê os campos da unidade de um `caracteristicas` qualquer (o que não presta vira null). */
export function lerUnidade(c: Record<string, unknown> | null | undefined): DadosUnidade {
  const sub = c?.subtipo;
  const subtipo = SUBTIPOS_UNIDADE.some((s) => s.valor === sub) ? (sub as SubtipoUnidade) : null;
  const un = typeof c?.unidade === "string" || typeof c?.unidade === "number" ? String(c.unidade).trim().slice(0, 20) : "";
  return { subtipo, andar: lerAndar(c?.andar), unidade: un || null };
}

/**
 * Limpa os campos da unidade dentro de `caracteristicas` antes de gravar:
 * guarda só o que é válido e apaga o resto (nada de texto livre em `andar`).
 */
export function normalizarUnidade(c: Record<string, unknown>): Record<string, unknown> {
  const u = lerUnidade(c);
  const out = { ...c };
  delete out.subtipo; delete out.andar; delete out.unidade;
  if (u.subtipo) out.subtipo = u.subtipo;
  if (u.andar != null) out.andar = u.andar;
  if (u.unidade) out.unidade = u.unidade;
  return out;
}

/** "Térreo", "3º andar", "Subsolo 1". */
export function rotuloAndar(andar: number | null): string {
  if (andar == null) return "Andar não informado";
  if (andar === 0) return "Térreo";
  if (andar < 0) return `Subsolo ${-andar}`;
  return `${andar}º andar`;
}

/** "Apto 302", "Sala 12" ou null quando não há número. */
export function rotuloUnidade(u: Pick<DadosUnidade, "subtipo" | "unidade">): string | null {
  if (!u.unidade) return null;
  return `${u.subtipo === "sala" ? "Sala" : "Apto"} ${u.unidade}`;
}

/**
 * Agrupa as unidades por andar, do mais alto para o mais baixo (como se lê um
 * prédio de cima para baixo); "andar não informado" fica por último. Dentro do
 * andar, pelo número da unidade.
 */
export function agruparPorAndar<T extends { andar: number | null; unidade: string | null }>(
  unidades: T[],
): { andar: number | null; unidades: T[] }[] {
  const mapa = new Map<number | null, T[]>();
  for (const u of unidades) {
    const k = u.andar ?? null;
    mapa.set(k, [...(mapa.get(k) ?? []), u]);
  }
  const porNumero = (a: T, b: T) =>
    (a.unidade ?? "").localeCompare(b.unidade ?? "", "pt-BR", { numeric: true });
  return [...mapa.entries()]
    .sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : b - a))
    .map(([andar, lista]) => ({ andar, unidades: lista.sort(porNumero) }));
}
