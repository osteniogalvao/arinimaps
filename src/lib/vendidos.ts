import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Vitrine de vendidos (pedido do Stenio, 23/11/2026): só dados reais do
 * sistema, com regras de privacidade fixas aqui, num lugar só:
 *
 * - sem nome de ninguém, sem título do anúncio (título costuma ter o nome da
 *   fazenda ou da rua) e sem código AIB (que abre a ficha com a divisa);
 * - sem valor: o sistema ainda não guarda autorização do proprietário para
 *   divulgar o preço de venda, então o valor nunca sai daqui;
 * - sem localização exata: só o município, e a área arredondada;
 * - atraso mínimo de um dia: a venda só aparece depois de 24 h, e a data
 *   aparece só como mês/ano;
 * - anúncios de demonstração ficam de fora.
 */

const DIA = 86_400_000;
/** Venda só aparece depois deste atraso. */
export const ATRASO_MS = DIA;
/**
 * Abaixo disto, a quantidade de vendidos, o tempo médio e o volume em reais
 * não aparecem na faixa de números (número baixo não impressiona). Os cards
 * dos vendidos que existirem aparecem mesmo assim.
 */
export const MIN_VENDAS_NUMEROS = 10;
/** Tempo médio acima disto não vai para a faixa. */
export const MAX_DIAS_MEDIA = 180;

export type Vendido = {
  id: string;
  tipo: "urbano" | "rural";
  municipio: string | null;
  uf: string | null;
  /** dias entre a publicação e a venda; null quando não há data de publicação */
  dias: number | null;
  /** "novembro de 2026" */
  mes: string;
  /** área arredondada, ex. "cerca de 120 ha"; null sem área */
  area: string | null;
  /** caminho no bucket media */
  foto: string | null;
};

export function fotoUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

export function textoDias(dias: number | null) {
  if (dias == null) return "Vendido pela ARINI";
  return dias === 1 ? "Vendido em 1 dia" : `Vendido em ${dias.toLocaleString("pt-BR")} dias`;
}

export function rotuloTipo(v: Pick<Vendido, "tipo">) {
  return v.tipo === "rural" ? "Imóvel rural" : "Imóvel urbano";
}

export function ondeTexto(v: Pick<Vendido, "municipio" | "uf">) {
  return v.municipio ? `${v.municipio}${v.uf ? `/${v.uf}` : ""}` : null;
}

/** Duas casas significativas: 123,4 ha → "cerca de 120 ha"; 362 m² → "cerca de 360 m²". */
function areaAproximada(m2: number | null | undefined, tipo: "urbano" | "rural") {
  if (!m2 || m2 <= 0) return null;
  const v = tipo === "rural" ? m2 / 10_000 : m2;
  const ordem = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  const r = Math.max(1, Math.round(v / ordem) * ordem);
  return `cerca de ${r.toLocaleString("pt-BR")} ${tipo === "rural" ? "ha" : "m²"}`;
}

const temBanco = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const CAMPOS =
  "id, tipo, published_at, sold_at, municipality:municipalities!properties_municipality_id_fkey(nome, uf), geo:property_geometries(area_m2), media:property_media(storage_path, capa, tipo, ordem)";

type Linha = {
  id: string; tipo: string; published_at: string | null; sold_at: string;
  municipality: { nome: string; uf: string } | null;
  geo: { area_m2: number | null } | { area_m2: number | null }[] | null;
  media: { storage_path: string; capa: boolean; tipo: string | null; ordem: number | null }[] | null;
};

function montar(p: Linha): Vendido {
  const tipo = p.tipo === "rural" ? "rural" : "urbano";
  const vendido = new Date(p.sold_at);
  const dias = p.published_at
    ? Math.max(1, Math.round((vendido.getTime() - new Date(p.published_at).getTime()) / DIA))
    : null;
  const fotos = (p.media ?? []).filter((m) => !m.tipo || m.tipo === "foto")
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const capa = fotos.find((m) => m.capa) ?? fotos[0];
  const geo = Array.isArray(p.geo) ? p.geo[0] : p.geo;
  return {
    id: p.id, tipo,
    municipio: p.municipality?.nome ?? null, uf: p.municipality?.uf ?? null,
    dias,
    mes: vendido.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }),
    area: areaAproximada(geo?.area_m2, tipo),
    foto: capa?.storage_path ?? null,
  };
}

const limiteData = () => new Date(Date.now() - ATRASO_MS).toISOString();

function consultaBase() {
  return supabaseAdmin()
    .from("properties")
    .select(CAMPOS)
    .eq("status", "vendido")
    .eq("demonstracao", false)
    .not("sold_at", "is", null)
    .lte("sold_at", limiteData());
}

const listaCache = unstable_cache(async (limite: number): Promise<Vendido[]> => {
  const { data, error } = await consultaBase().order("sold_at", { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Linha[]).map(montar);
}, ["vendidos-lista"], { revalidate: 900, tags: ["vendidos", "imoveis"] });

/** Vendidos mais recentes (já com o atraso). Nunca derruba a página. */
export async function listarVendidos(limite = 12): Promise<Vendido[]> {
  if (!temBanco()) return [];
  try {
    return await listaCache(limite);
  } catch (e) {
    console.error("vendidos: lista falhou:", e);
    return [];
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Um vendido pelo id (o mesmo filtro da lista: atraso, sem demonstração). */
export const vendidoPorId = cache(async (id: string): Promise<Vendido | null> => {
  if (!UUID.test(id) || !temBanco()) return null;
  const { data, error } = await consultaBase().eq("id", id).maybeSingle();
  if (error) {
    console.error("vendidos: card falhou:", error.message);
    return null;
  }
  return data ? montar(data as unknown as Linha) : null;
});

export type NumerosVendas = {
  /** quantidade de vendidos; 0 quando abaixo do mínimo */
  vendidos: number;
  /** tempo médio em dias; 0 quando não impressiona ou não há base */
  mediaDias: number;
};

const numerosCache = unstable_cache(async (): Promise<NumerosVendas> => {
  // "historico" é o vendido arquivado (a única entrada é vindo de "vendido")
  const { data, error } = await supabaseAdmin()
    .from("properties")
    .select("published_at, sold_at")
    .in("status", ["vendido", "historico"])
    .eq("demonstracao", false)
    .not("sold_at", "is", null)
    .lte("sold_at", limiteData());
  if (error) throw new Error(error.message);
  const linhas = data ?? [];
  const dias = linhas
    .filter((l) => l.published_at)
    .map((l) => (new Date(l.sold_at!).getTime() - new Date(l.published_at!).getTime()) / DIA)
    .filter((d) => d >= 0);
  const media = dias.length ? Math.max(1, Math.round(dias.reduce((s, d) => s + d, 0) / dias.length)) : 0;
  const total = linhas.length;
  return {
    vendidos: total >= MIN_VENDAS_NUMEROS ? total : 0,
    mediaDias: dias.length >= MIN_VENDAS_NUMEROS && media <= MAX_DIAS_MEDIA ? media : 0,
  };
}, ["vendidos-numeros"], { revalidate: 900, tags: ["vendidos", "home"] });

/** Números das vendas para a faixa; zero = não mostrar. */
export async function numerosVendas(): Promise<NumerosVendas> {
  if (!temBanco()) return { vendidos: 0, mediaDias: 0 };
  try {
    return await numerosCache();
  } catch (e) {
    console.error("vendidos: números falharam:", e);
    return { vendidos: 0, mediaDias: 0 };
  }
}
