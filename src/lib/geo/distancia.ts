/**
 * Distâncias e pontos de interesse — formatação comum ao mapa, à ficha do
 * imóvel e à consulta do lote. Pode ser importado no cliente e no servidor.
 */

import { VISUAL_POI } from "./poiVisual";
/** Rótulo de cada categoria de ponto de interesse (OpenStreetMap + IBGE). */
export const CATEGORIA_POI_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(VISUAL_POI).map(([k, v]) => [k, v.rotulo]),
);

/** Ícone curto por categoria, para listas compactas. */
export const CATEGORIA_POI_ICONE: Record<string, string> = {
  combustivel: "⛽", farmacia: "✚", supermercado: "🛒", hospital: "🏥", escola: "🎓", centro: "🏛", acesso_rodovia: "🛣",
  banco: "🏦", igreja: "⛪", restaurante: "🍽", parque: "🌳", padaria: "🥖", policia: "🛡",
};

/**
 * Distância em linha reta, como gente lê: "350 m", "1,2 km", "18 km".
 * Abaixo de 1 km arredonda para 10 m; até 10 km, uma casa decimal.
 */
export function formatDistancia(metros: number | null | undefined): string {
  if (metros == null || !Number.isFinite(Number(metros))) return "—";
  const m = Number(metros);
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10).toLocaleString("pt-BR")} m`;
  const km = m / 1000;
  return `${km.toLocaleString("pt-BR", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/** Distância geodésica (haversine) entre dois pontos [lng, lat], em metros. */
export function distanciaM(a: [number, number], b: [number, number]): number {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PoiDistancia = { nome: string | null; categoria: string; distancia_m: number; destaque?: boolean };

/** Perímetro: metros inteiros abaixo de 1 km ("87 m", não "0,09 km"). */
export function formatPerimetro(metros: number | null | undefined): string {
  if (metros == null || !Number.isFinite(Number(metros))) return "—";
  const m = Number(metros);
  if (m < 1000) return `${Math.round(m).toLocaleString("pt-BR")} m`;
  return `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;
}

/**
 * Nome do ponto como veio do OpenStreetMap: rodovia com várias siglas chega
 * como "BR-497;MG-497" (o ";" é separador do OSM, não texto).
 */
export function nomePoi(nome: string | null | undefined): string | null {
  if (!nome) return null;
  return nome.split(";").map((s) => s.trim()).filter(Boolean).join(" / ");
}

/** Mais perto primeiro: a lista vinha na ordem do job que gerou os pontos. */
export function poisOrdenados<T extends { distancia_m: number }>(pois: T[]): T[] {
  return [...pois].sort((a, b) => Number(a.distancia_m) - Number(b.distancia_m));
}
