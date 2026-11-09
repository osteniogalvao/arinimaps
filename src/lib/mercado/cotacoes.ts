import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CotacaoAtual, PontoCotacao } from "./formato";

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
    let q = supabaseAdmin().from("cotacoes_ultimas").select("*");
    if (soDestaques) q = q.eq("destaque", true);
    const { data, error } = await q.order("ordem").order("uf").order("praca").limit(500);
    if (error) throw error;
    return (data ?? []).map(normalizar);
  } catch (e) {
    console.warn("cotações indisponíveis:", (e as Error).message);
    return [];
  }
}

/** Cotações da faixa do topo (séries marcadas como destaque). */
export const cotacoesFaixa = unstable_cache(() => lerUltimas(true), ["cotacoes-faixa"], {
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
