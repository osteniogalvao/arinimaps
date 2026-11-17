import area from "@turf/area";
import { TEMAS_CAR, type TemaCar } from "./temasCar";

/** Temas ambientais do imóvel (SICAR) mais as nascentes aproximadas da FBDS. */
export const TEMAS_AMBIENTE = { ...TEMAS_CAR, nascente: "Nascentes e minas d’água mapeadas" } as const;
export type TemaAmbiente = TemaCar | "nascente";

/**
 * Cores das camadas ambientais no mapa, na consulta e no PDF.
 * 17/11/2026 (áudio do Carlos, 11h49): "seletivas com cores mais vibrantes".
 * Antes eram tons pastel com 46% de opacidade, que sumiam no satélite.
 */
export const CORES_AMBIENTE: Record<TemaAmbiente, string> = {
  area_imovel: "#FFD400", app: "#00E5FF", reserva_legal: "#00E676", vegetacao_nativa: "#AEEA00",
  area_consolidada: "#FF9100", uso_restrito: "#D500F9", servidao_administrativa: "#FF1744",
  hidrografia: "#2979FF", area_pousio: "#FFC400", nascente: "#18FFFF",
};

/** Nome curto para chip, legenda e PDF. */
export const NOME_CURTO: Record<TemaAmbiente, string> = {
  area_imovel: "Área do imóvel", app: "APP", reserva_legal: "Reserva legal", vegetacao_nativa: "Vegetação nativa",
  area_consolidada: "Área consolidada", uso_restrito: "Uso restrito", servidao_administrativa: "Servidão administrativa",
  hidrografia: "Hidrografia", area_pousio: "Área de pousio", nascente: "Nascentes",
};

/** Ordem de leitura: o que o comprador pergunta primeiro vem antes. */
export const ORDEM_AMBIENTE: TemaAmbiente[] = [
  "app", "reserva_legal", "vegetacao_nativa", "area_consolidada", "uso_restrito", "hidrografia",
  "area_pousio", "servidao_administrativa", "nascente",
];

export type LinhaQuadro = { tema: TemaAmbiente; nome: string; cor: string; ha: number; pct: number | null; feicoes: number };

/**
 * Hectares declarados por tema dentro do perímetro (soma das feições, já
 * recortadas pelo banco na divisa) e o percentual da área do imóvel.
 * Nascentes entram só pela contagem.
 */
export function quadroAmbiental(features: GeoJSON.Feature[], areaImovelHa?: number | null): LinhaQuadro[] {
  const soma = new Map<TemaAmbiente, { ha: number; n: number }>();
  let imovelHa = 0;
  for (const f of features) {
    const tema = f.properties?.tema as TemaAmbiente | undefined;
    if (!tema || !(tema in CORES_AMBIENTE) || !f.geometry) continue;
    const ha = f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon" ? area(f) / 10_000 : 0;
    if (tema === "area_imovel") { imovelHa += ha; continue; }
    const atual = soma.get(tema) ?? { ha: 0, n: 0 };
    soma.set(tema, { ha: atual.ha + ha, n: atual.n + 1 });
  }
  const base = areaImovelHa && areaImovelHa > 0 ? areaImovelHa : imovelHa;
  return ORDEM_AMBIENTE.filter((t) => soma.has(t)).map((t) => {
    const s = soma.get(t)!;
    return { tema: t, nome: NOME_CURTO[t], cor: CORES_AMBIENTE[t], ha: s.ha, feicoes: s.n,
      pct: t === "nascente" || !base ? null : Math.min(100, (s.ha / base) * 100) };
  });
}

export const formatarHa = (ha: number) =>
  ha.toLocaleString("pt-BR", { maximumFractionDigits: ha < 10 ? 2 : ha < 1000 ? 1 : 0 }) + " ha";
