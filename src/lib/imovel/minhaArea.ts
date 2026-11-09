/**
 * Minha área (item 29): desenhos de trabalho do anunciante sobre a divisa do
 * imóvel — piquetes, áreas de plantio, benfeitorias, projetos. Rótulos, cores
 * e a validação da geometria, compartilhados entre o navegador e o servidor.
 * Medidas pela geodésia do turf, a mesma das ferramentas de medir do mapa.
 */
import { area as areaTurf, length as comprimentoTurf } from "@turf/turf";

export const CATEGORIAS_DESENHO = ["piquete", "plantio", "benfeitoria", "projeto", "outro"] as const;
export type CategoriaDesenho = (typeof CATEGORIAS_DESENHO)[number];
export const CATEGORIA_DESENHO_LABEL: Record<CategoriaDesenho, string> = {
  piquete: "Piquete", plantio: "Área de plantio", benfeitoria: "Benfeitoria", projeto: "Projeto", outro: "Outro",
};

/** Paleta dos desenhos: tons do manual e de mapa, legíveis sobre o satélite. */
export const CORES_DESENHO = ["#D9BD6F", "#2E9E6B", "#F2F2EC", "#FF9D3D", "#5FB3E6", "#E5484D", "#8BC34A", "#B07D48"] as const;

export type GeometriaDesenho = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;

export type Desenho = {
  id: string; nome: string; categoria: CategoriaDesenho; cor: string; notas: string | null;
  geojson: GeometriaDesenho; area_m2: number | null; comprimento_m: number | null; created_at: string;
};

export type ArquivoArea = { id: string; desenho_id: string | null; nome_arquivo: string; tamanho_bytes: number | null; created_at: string; url: string };

const MAX_VERTICES = 2000;
const coordOk = (c: unknown): c is [number, number] =>
  Array.isArray(c) && c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number" &&
  Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

/** Confere a geometria. Devolve só [lng, lat] (sem altitude). null = inválida. */
export function validarGeometria(g: unknown): GeometriaDesenho | null {
  if (!g || typeof g !== "object") return null;
  const { type, coordinates } = g as { type?: string; coordinates?: unknown };
  const limpa = (c: [number, number]): [number, number] => [c[0], c[1]];
  if (type === "Point") return coordOk(coordinates) ? { type, coordinates: limpa(coordinates) } : null;
  if (type === "LineString") {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > MAX_VERTICES || !coordinates.every(coordOk)) return null;
    return { type, coordinates: coordinates.map(limpa) };
  }
  if (type === "Polygon") {
    if (!Array.isArray(coordinates) || coordinates.length !== 1) return null;
    const anel = coordinates[0];
    if (!Array.isArray(anel) || anel.length < 4 || anel.length > MAX_VERTICES || !anel.every(coordOk)) return null;
    const pts = anel.map(limpa);
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a);
    return { type, coordinates: [pts] };
  }
  return null;
}

/** Área (m²) do polígono e comprimento (m) da linha ou do contorno. */
export function medir(g: GeometriaDesenho): { area_m2: number | null; comprimento_m: number | null } {
  if (g.type === "Point") return { area_m2: null, comprimento_m: null };
  const f = { type: "Feature" as const, properties: {}, geometry: g };
  if (g.type === "LineString") return { area_m2: null, comprimento_m: Math.round(comprimentoTurf(f, { units: "kilometers" }) * 1000 * 10) / 10 };
  return {
    area_m2: Math.round(areaTurf(f) * 10) / 10,
    comprimento_m: Math.round(comprimentoTurf(f, { units: "kilometers" }) * 1000 * 10) / 10,
  };
}

/** Área legível: ha para áreas grandes, m² para pequenas. */
export function formatAreaDesenho(m2: number | null | undefined) {
  if (m2 == null) return "—";
  if (m2 >= 10_000) return `${(m2 / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha`;
  return `${Math.round(m2).toLocaleString("pt-BR")} m²`;
}
export function formatComprimento(m: number | null | undefined) {
  if (m == null) return "—";
  if (m >= 1000) return `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;
  return `${Math.round(m).toLocaleString("pt-BR")} m`;
}
