/**
 * Graus → UTM no SIRGAS 2000 (elipsoide GRS 80; na prática igual ao WGS 84,
 * diferença abaixo do milímetro), para o DXF e o memorial descritivo.
 *
 * Série de Snyder (USGS PP 1395), a mesma de `utmParaGeo` em
 * src/lib/map/buscaRural.ts, no sentido contrário. Precisão submétrica dentro
 * da zona, sem baixar o proj4 no navegador.
 */

const A = 6378137;
const F = 1 / 298.257222101; // GRS 80
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const RAD = Math.PI / 180;

/** Fuso UTM de uma longitude (1 a 60). */
export const fusoUtm = (lng: number) => Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));

/** Meridiano central do fuso, em graus (negativo a oeste). */
export const meridianoCentral = (fuso: number) => (fuso - 1) * 6 - 180 + 3;

/** [lng, lat] → [E, N] em metros no fuso dado (hemisfério sul quando `sul`). */
export function geoParaUtm(lng: number, lat: number, fuso: number, sul = true): [number, number] {
  const phi = lat * RAD;
  const lam = (lng - meridianoCentral(fuso)) * RAD;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const Aa = c * lam;
  const M = A * (
    (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi
    - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi)
  );
  const este = K0 * N * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120) + 500000;
  let norte = K0 * (M + N * t * (Aa ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720));
  if (sul) norte += 10000000;
  return [este, norte];
}

/** Fuso e hemisfério que valem para uma geometria inteira (pelo centro do retângulo). */
export function fusoDaGeometria(pontos: GeoJSON.Position[]): { fuso: number; sul: boolean } {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of pontos) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { fuso: fusoUtm((x0 + x1) / 2), sul: (y0 + y1) / 2 < 0 };
}

/** Código EPSG do SIRGAS 2000 / UTM (31978–31985 = fusos 18S–25S; 31971–31976 = 17N–22N). */
export const epsgSirgas = (fuso: number, sul: boolean) => (sul ? 31960 + fuso : 31954 + fuso);
