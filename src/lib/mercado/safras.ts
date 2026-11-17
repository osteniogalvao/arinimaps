import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Safras de grãos da CONAB por UF (migration 0145, job `coletar_safras_conab`).
 * Pedido do Carlos (17/11): "CONAB safras" das camadas do Dados Fazenda, que é
 * tabela e não mapa, aparece junto das cotações e no WhatsApp. Nunca lança.
 */
export type SafraProduto = {
  produto: string;
  safra: string;
  levantamento: string;
  areaMilHa: number;
  producaoMilT: number;
  /** kg/ha */
  produtividade: number | null;
  anterior: { safra: string; producaoMilT: number } | null;
  /** produção da safra atual sobre a anterior, em % */
  variacao: number | null;
  ufs: { uf: string; producaoMilT: number; areaMilHa: number }[];
  atualizadoEm: string | null;
};

type Linha = { safra: string; produto: string; uf: string; levantamento: string; area_mil_ha: number | null; producao_mil_t: number | null; atualizado_em: string };

async function ler(): Promise<SafraProduto[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const db = supabaseAdmin();
    const { data: ultima, error: e1 } = await db.from("conab_safras").select("safra").order("safra", { ascending: false }).limit(1).maybeSingle();
    if (e1 || !ultima) return [];
    const ano = Number(String(ultima.safra).slice(0, 4));
    const anterior = `${ano - 1}/${String(ano).slice(-2)}`;
    const linhas: Linha[] = [];
    for (let ini = 0; ; ini += 1000) {
      const { data, error } = await db.from("conab_safras").select("*").in("safra", [ultima.safra, anterior])
        .order("produto").order("uf").range(ini, ini + 999);
      if (error) throw error;
      linhas.push(...(data as Linha[]));
      if (data.length < 1000) break;
    }
    const porProduto = new Map<string, Linha[]>();
    for (const l of linhas) porProduto.set(l.produto, [...(porProduto.get(l.produto) ?? []), l]);
    const soma = (ls: Linha[], k: "area_mil_ha" | "producao_mil_t") => ls.reduce((t, l) => t + Number(l[k] ?? 0), 0);
    const resumo: SafraProduto[] = [];
    for (const [produto, ls] of porProduto) {
      const atuais = ls.filter((l) => l.safra === ultima.safra);
      if (!atuais.length) continue;
      const passadas = ls.filter((l) => l.safra === anterior);
      const areaMilHa = soma(atuais, "area_mil_ha"), producaoMilT = soma(atuais, "producao_mil_t");
      const prodAnterior = passadas.length ? soma(passadas, "producao_mil_t") : null;
      resumo.push({
        produto, safra: ultima.safra, levantamento: atuais[0].levantamento, areaMilHa, producaoMilT,
        produtividade: areaMilHa > 0 ? (producaoMilT / areaMilHa) * 1000 : null,
        anterior: prodAnterior == null ? null : { safra: anterior, producaoMilT: prodAnterior },
        variacao: prodAnterior ? (producaoMilT / prodAnterior - 1) * 100 : null,
        ufs: atuais.map((l) => ({ uf: l.uf, producaoMilT: Number(l.producao_mil_t ?? 0), areaMilHa: Number(l.area_mil_ha ?? 0) }))
          .filter((u) => u.producaoMilT > 0).sort((a, b) => b.producaoMilT - a.producaoMilT),
        atualizadoEm: atuais.reduce<string | null>((m, l) => (!m || l.atualizado_em > m ? l.atualizado_em : m), null),
      });
    }
    return resumo.filter((r) => r.producaoMilT > 0).sort((a, b) => b.producaoMilT - a.producaoMilT);
  } catch (e) {
    console.warn("safras da CONAB indisponíveis:", (e as Error).message);
    return [];
  }
}

export const safrasConab = unstable_cache(ler, ["conab-safras"], { revalidate: 3600, tags: ["conab-safras"] });

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Produtos cujo nome contém todas as palavras do termo ("milho", "milho 2"). */
export function buscarSafra(lista: SafraProduto[], termo: string) {
  const palavras = semAcento(termo).split(/\s+/).filter(Boolean);
  return lista.filter((s) => palavras.every((w) => semAcento(s.produto).includes(w)));
}

/** 48.500 mil t → "48,5 milhões de t"; 850 mil t → "850 mil t" */
export function formatarToneladas(milT: number) {
  return milT >= 1000
    ? `${(milT / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} milhões de t`
    : `${milT.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil t`;
}
export function formatarHectares(milHa: number) {
  return milHa >= 1000
    ? `${(milHa / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} milhões de ha`
    : `${milHa.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil ha`;
}
export const nomeProduto = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();
