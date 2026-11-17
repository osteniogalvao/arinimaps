import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { estatisticas, recortar, type CotacaoAtual, type CotacaoFaixa, type PontoCotacao } from "./formato";

/**
 * Leitura das cotações gravadas pelo worker (job `coletar_cotacoes`, migration
 * 0056). Tudo sai do banco com cache de 15 min (`revalidate`): o acesso do
 * visitante nunca chama fonte externa. Se a migration ainda não foi aplicada
 * ou a tabela está vazia, devolve lista vazia — a faixa some e o /mercado
 * mostra o estado vazio. Nunca lança.
 */

const REVALIDAR = 900;
const temBanco = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const normalizar = (r: Record<string, unknown>): CotacaoAtual => ({
  ...(r as CotacaoAtual),
  valor: Number(r.valor),
  variacao: r.variacao == null ? null : Number(r.variacao),
  casas: Number(r.casas ?? 2),
  ordem: Number(r.ordem ?? 100),
});

async function lerUltimas(soDestaques: boolean): Promise<CotacaoAtual[]> {
  if (!temBanco()) return [];
  try {
    const db = supabaseAdmin();
    const series: CotacaoAtual[] = [];
    const tamanho = 500;
    for (let inicio = 0; ; inicio += tamanho) {
      let q = db.from("cotacoes_ultimas").select("*");
      if (soDestaques) q = q.eq("destaque", true);
      const { data, error } = await q.order("ordem").order("uf").order("praca").order("id")
        .range(inicio, inicio + tamanho - 1);
      if (error) throw error;
      series.push(...data.map(normalizar));
      if (data.length < tamanho) return series;
    }
  } catch (e) {
    console.warn("cotações indisponíveis:", (e as Error).message);
    return [];
  }
}

/** Produtos que a faixa sempre mostra (áudio do Carlos, 16/11: boi, grãos e dólar), mesmo sem destaque marcado. */
const ESSENCIAIS = ["boi-gordo", "soja", "milho", "dolar"];
const LIMITE_FAIXA = 14;

/**
 * Cotações da faixa do topo: as séries em destaque e, se faltar, um indicador
 * de cada produto essencial. Cada item leva a variação do dia (ou a do último
 * fechamento, quando a fonte não traz), a de 30 dias e os últimos 20 valores
 * para a minilinha.
 */
async function lerFaixa(): Promise<CotacaoFaixa[]> {
  const todas = await lerUltimas(false);
  const escolhidas = todas.filter((s) => s.destaque);
  for (const produto of ESSENCIAIS) {
    if (escolhidas.some((s) => s.produto === produto)) continue;
    const doProduto = todas.filter((s) => s.produto === produto).sort((a, b) => Number(!!a.praca) - Number(!!b.praca) || a.ordem - b.ordem);
    if (doProduto[0]) escolhidas.push(doProduto[0]);
  }
  escolhidas.sort((a, b) => a.ordem - b.ordem);
  return Promise.all(escolhidas.slice(0, LIMITE_FAIXA).map(async (s) => {
    const pontos = await historicoCotacao(s.id);
    const ant = pontos.length > 1 ? pontos[pontos.length - 2] : null;
    const variacao = s.variacao ?? (ant && ant.valor > 0 ? (s.valor / ant.valor - 1) * 100 : null);
    const mes = estatisticas(recortar(pontos, 30));
    return {
      ...s, variacao,
      variacao30: mes && mes.n > 1 ? mes.variacao : null,
      linha: pontos.slice(-20).map((p) => p.valor),
    };
  }));
}

export const cotacoesFaixa = unstable_cache(lerFaixa, ["cotacoes-faixa-v2"], {
  revalidate: REVALIDAR, tags: ["cotacoes"],
});

/** Todas as séries ativas com o último valor (lista do /mercado). */
export const catalogoCotacoes = unstable_cache(() => lerUltimas(false), ["cotacoes-catalogo"], {
  revalidate: REVALIDAR, tags: ["cotacoes"],
});

/** Até ~1 ano de valores diários de uma série, do mais antigo ao mais recente. */
export const historicoCotacao = unstable_cache(
  async (serieId: string): Promise<PontoCotacao[]> => {
    if (!temBanco()) return [];
    try {
      const desde = new Date(Date.now() - 372 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabaseAdmin()
        .from("cotacoes_valores")
        .select("data, valor, variacao")
        .eq("serie_id", serieId)
        .gte("data", desde)
        .order("data")
        .limit(800);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        data: String(p.data),
        valor: Number(p.valor),
        variacao: p.variacao == null ? null : Number(p.variacao),
      }));
    } catch (e) {
      console.warn("histórico da cotação indisponível:", (e as Error).message);
      return [];
    }
  },
  ["cotacoes-historico"],
  { revalidate: REVALIDAR, tags: ["cotacoes"] },
);
