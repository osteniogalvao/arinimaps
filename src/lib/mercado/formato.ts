/**
 * Tipos e formatação das cotações (faixa do topo e /mercado). Sem acesso ao
 * banco: vale no servidor e no navegador. A leitura fica em ./cotacoes.ts.
 */

/** Última cotação de uma série (view cotacoes_ultimas, migration 0056). */
export type CotacaoAtual = {
  id: string;
  slug: string;
  produto: string;
  nome: string;
  descricao: string | null;
  praca: string | null;
  uf: string | null;
  unidade: string;
  casas: number;
  fonte: string;
  url_fonte: string;
  destaque: boolean;
  ordem: number;
  atualizado_em: string | null;
  data: string;
  valor: number;
  variacao: number | null;
};

export type PontoCotacao = { data: string; valor: number; variacao: number | null };

export const PRODUTOS: Record<string, string> = {
  "boi-gordo": "Boi gordo",
  milho: "Milho",
  soja: "Soja",
  frango: "Frango",
  dolar: "Dólar",
  ibovespa: "Ibovespa",
};

export const PERIODOS = [
  { id: "7d", rotulo: "7 dias", dias: 7 },
  { id: "30d", rotulo: "30 dias", dias: 30 },
  { id: "90d", rotulo: "90 dias", dias: 90 },
  { id: "1a", rotulo: "1 ano", dias: 365 },
] as const;
export type PeriodoId = (typeof PERIODOS)[number]["id"];

export function formatarValor(valor: number, casas = 2) {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** "+0,34%" · "-1,20%" · "0,00%" */
export function formatarVariacao(v: number) {
  const s = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v > 0.004 ? "+" : v < -0.004 ? "-" : ""}${s}%`;
}

/** sentido da variação, com uma folga para arredondamento */
export const sentido = (v: number | null | undefined): "alta" | "baixa" | "estavel" =>
  v == null || Math.abs(v) < 0.005 ? "estavel" : v > 0 ? "alta" : "baixa";

/** "2026-11-06" → "06/11/2026" (ou "06/11" no curto) */
export function formatarData(iso: string, curto = false) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return curto ? `${d}/${m}` : `${d}/${m}/${a}`;
}

export function formatarDataHora(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** "Triângulo/MG" · "Campinas/SP" · null */
export function localDaSerie(s: Pick<CotacaoAtual, "praca" | "uf">) {
  if (!s.praca) return null;
  return s.uf && !s.praca.includes(s.uf) ? `${s.praca}/${s.uf}` : s.praca;
}

/** rótulo da faixa: indicadores nacionais só com o nome; praças com o lugar */
export function rotuloFaixa(s: CotacaoAtual) {
  if (s.slug.startsWith("cepea-") || !s.praca) return s.nome;
  return `${s.nome} ${localDaSerie(s)}`;
}

/** pontos dos últimos `dias` contados a partir do último fechamento */
export function recortar(pontos: PontoCotacao[], dias: number) {
  if (!pontos.length) return pontos;
  const ultima = new Date(`${pontos[pontos.length - 1].data}T12:00:00Z`).getTime();
  const corte = new Date(ultima - dias * 86_400_000).toISOString().slice(0, 10);
  return pontos.filter((p) => p.data >= corte);
}

/** comparativo do período: variação, máxima, mínima e média */
export function estatisticas(pontos: PontoCotacao[]) {
  if (!pontos.length) return null;
  let max = pontos[0], min = pontos[0], soma = 0;
  for (const p of pontos) {
    if (p.valor > max.valor) max = p;
    if (p.valor < min.valor) min = p;
    soma += p.valor;
  }
  const inicio = pontos[0], fim = pontos[pontos.length - 1];
  return {
    inicio, fim, max, min,
    media: soma / pontos.length,
    variacao: inicio.valor > 0 ? (fim.valor / inicio.valor - 1) * 100 : 0,
    n: pontos.length,
  };
}
