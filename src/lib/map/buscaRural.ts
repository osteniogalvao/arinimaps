/**
 * Busca rural inteligente do mapa (segunda etapa, item 23): um campo só, e o
 * formato do que foi digitado diz o que é.
 *
 *  - código do CAR: `MG-3134202-0A1B…` (UF, código IBGE com 7 dígitos e o
 *    hash de 32 caracteres; aceita o hash com pontos, como sai no recibo);
 *  - código de anúncio: `AIB-000029` (ou `aib 29`);
 *  - coordenada em graus decimais: `-19.72, -50.19`, `-19,72 -50,19`;
 *  - graus, minutos e segundos: `19°43'12"S 50°11'24"O` (O ou W, L ou E);
 *  - UTM: `22K 612345 7818123` (zona, banda opcional, E e N em metros);
 *  - SIGEF (ideia do Geomart, 11/11): código da parcela certificada (UUID),
 *    código do imóvel no INCRA/CCIR (13 dígitos, `950.068.035.645-8`) e
 *    matrícula (`matrícula 12345`, com a palavra, para não confundir com número solto);
 *  - qualquer outra coisa é texto: imóvel, município, ponto de referência.
 *
 * Datum assumido: WGS 84 / SIRGAS 2000 (diferença de centímetros entre eles).
 */

export type ResultadoBusca =
  | { tipo: "coordenada"; lat: number; lng: number; formato: "decimal" | "gms" | "utm"; rotulo: string }
  | { tipo: "car"; cod: string }
  | { tipo: "anuncio"; codigo: string }
  | { tipo: "sigef"; campo: "parcela" | "ccir" | "matricula"; valor: string; rotulo: string }
  | { tipo: "texto"; termo: string };

/** Retângulo folgado do Brasil, para decidir hemisfério e ordem lat/lng. */
const noBrasil = (lat: number, lng: number) => lat >= -34.5 && lat <= 6 && lng >= -74.5 && lng <= -28.5;

const num = (s: string) => Number(s.replace(",", "."));

export function rotuloCoordenada(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// ---------------------------------------------------------------- CAR e anúncio
function lerCar(t: string): string | null {
  const m = t.toUpperCase().replace(/\s+/g, "").match(/^([A-Z]{2})-?(\d{7})-?((?:[0-9A-F]{4}\.?){8})$/);
  return m ? `${m[1]}-${m[2]}-${m[3].replace(/\./g, "")}` : null;
}

function lerAnuncio(t: string): string | null {
  const m = t.trim().match(/^AIB[\s-]?(\d{1,6})$/i);
  return m ? `AIB-${m[1].padStart(6, "0")}` : null;
}

// ---------------------------------------------------------------- SIGEF / INCRA
function lerSigef(t: string): Extract<ResultadoBusca, { tipo: "sigef" }> | null {
  const uuid = t.trim().match(/^(?:sigef\s*)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (uuid) return { tipo: "sigef", campo: "parcela", valor: uuid[1].toLowerCase(), rotulo: "Parcela do SIGEF" };
  const ccir = t.trim().match(/^(?:ccir|incra|sncr)?[\s:nº°.]*(\d{3}\.?\d{3}\.?\d{3}\.?\d{3}-?\d)$/i);
  if (ccir) return { tipo: "sigef", campo: "ccir", valor: ccir[1].replace(/\D/g, ""), rotulo: "Código do imóvel no INCRA (CCIR)" };
  const mat = t.trim().match(/^(?:matr[ií]cula|mat\.?|m-)\s*(?:n[º°o.]*\s*)?(\d{1,3}(?:\.\d{3})+|\d{1,8})$/i);
  if (mat) return { tipo: "sigef", campo: "matricula", valor: mat[1].replace(/\D/g, ""), rotulo: "Matrícula (parcelas do SIGEF)" };
  return null;
}

// ---------------------------------------------------------------- graus decimais
function lerDecimal(t: string): [number, number] | null {
  const m = t.match(/^(-?\d{1,3}(?:[.,]\d+)?)\s*[;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/)
    ?? t.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const a = num(m[1]), b = num(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // aceita lng antes da lat (como sai de muitos GIS) quando só assim cai no Brasil
  if (!noBrasil(a, b) && noBrasil(b, a)) return [b, a];
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return [a, b];
}

// ---------------------------------------------------------------- graus, minutos e segundos
const RE_GMS = /([NSLOEW])?\s*(-)?(\d{1,3}(?:[.,]\d+)?)\s*(?:°|º|˚|graus?\b)\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:'|′|’|min\b))?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|”|''|seg\b|s\b))?\s*([NSLOEW])?/gi;

function lerGms(t: string): [number, number] | null {
  const partes = [...t.matchAll(RE_GMS)];
  if (partes.length !== 2) return null;
  let lat: number | null = null, lng: number | null = null;
  const soltos: number[] = [];
  for (const p of partes) {
    const hemi = (p[1] || p[7] || "").toUpperCase();
    let v = num(p[3]) + (p[4] ? num(p[4]) / 60 : 0) + (p[5] ? num(p[5]) / 3600 : 0);
    if (p[2] || hemi === "S" || hemi === "O" || hemi === "W") v = -v;
    if (hemi === "N" || hemi === "S") lat = v;
    else if (hemi) lng = v;
    else soltos.push(v);
  }
  // sem a letra: a primeira é a latitude; no Brasil, longitude sempre a oeste
  if (lat === null && soltos.length) lat = soltos.shift()!;
  if (lng === null && soltos.length) lng = soltos.shift()!;
  if (lat === null || lng === null) return null;
  if (lng > 0) lng = -lng;
  // latitude sem sinal nem letra: quase todo o Brasil fica ao sul do Equador
  if (lat > 0 && !noBrasil(lat, lng) && noBrasil(-lat, lng)) lat = -lat;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

// ---------------------------------------------------------------- UTM
/** UTM → [lat, lng] no elipsoide WGS 84 (série de Snyder, precisão submétrica na zona). */
export function utmParaGeo(zona: number, sul: boolean, este: number, norte: number): [number, number] {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = este - 500000, y = sul ? norte - 10000000 : norte;
  const mu = y / k0 / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), tg = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * s * s);
  const T1 = tg * tg, C1 = ep2 * c * c;
  const R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - ((N1 * tg) / R1) * (D ** 2 / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lng0 = (zona - 1) * 6 - 180 + 3;
  const lng = lng0 + ((D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120) / c) * (180 / Math.PI);
  return [(lat * 180) / Math.PI, lng];
}

function lerUtm(t: string): [number, number] | null {
  // "22K 612345 7818123", "22 K 612345,5 7818123", "612345 7818123 22K", "E 612345 N 7818123 fuso 22"
  const limpo = t.toUpperCase().replace(/\b(ZONA|FUSO|Z)\b/g, " ").replace(/\b[EN]\s*[:=]?\s*(?=\d)/g, " ");
  const zm = limpo.match(/(?:^|\s)(\d{1,2})\s*([C-HJ-NP-X])?(?=\s|$)/);
  const metros = [...limpo.matchAll(/(?:^|\s)(\d{6,7}(?:[.,]\d+)?)(?=\s|$)/g)].map((m) => num(m[1]));
  if (!zm || metros.length !== 2) return null;
  const zona = Number(zm[1]);
  if (zona < 1 || zona > 60) return null;
  const este = metros.find((v) => v >= 100000 && v < 1000000);
  const norte = metros.find((v) => v !== este);
  if (este === undefined || norte === undefined || norte < 0 || norte > 10000000) return null;
  const banda = zm[2];
  // banda C–M = sul; N–X = norte. No Brasil muita gente escreve "S" querendo
  // dizer sul (a banda S é do hemisfério norte): vale o que cair no Brasil.
  const preferirSul = !banda || banda <= "M" || banda === "S";
  for (const sul of preferirSul ? [true, false] : [false, true]) {
    const [lat, lng] = utmParaGeo(zona, sul, este, norte);
    if (noBrasil(lat, lng)) return [lat, lng];
  }
  const [lat, lng] = utmParaGeo(zona, preferirSul, este, norte);
  return Number.isFinite(lat) && Math.abs(lat) <= 84 ? [lat, lng] : null;
}

/** Área que o mapa deixa navegar (maxBounds do MapaRegional): fora dela, não é coordenada útil. */
const noMapa = (lat: number, lng: number) => lat >= -38 && lat <= 9 && lng >= -80 && lng <= -28;

// ---------------------------------------------------------------- entrada única
export function interpretarBusca(texto: string): ResultadoBusca {
  const r = interpretar(texto);
  // número que "parece" coordenada mas cai fora do mapa (ex.: texto colado pela
  // metade) vira busca de texto, em vez de mandar o mapa para o oceano
  return r.tipo === "coordenada" && !noMapa(r.lat, r.lng) ? { tipo: "texto", termo: texto.trim() } : r;
}

function interpretar(texto: string): ResultadoBusca {
  const t = texto.trim();
  if (!t) return { tipo: "texto", termo: "" };
  const car = lerCar(t);
  if (car) return { tipo: "car", cod: car };
  const anuncio = lerAnuncio(t);
  if (anuncio) return { tipo: "anuncio", codigo: anuncio };
  const sigef = lerSigef(t);
  if (sigef) return sigef;
  const dec = lerDecimal(t);
  if (dec) return { tipo: "coordenada", lat: dec[0], lng: dec[1], formato: "decimal", rotulo: rotuloCoordenada(dec[0], dec[1]) };
  const gms = /[°º˚]|graus/i.test(t) ? lerGms(t) : null;
  if (gms) return { tipo: "coordenada", lat: gms[0], lng: gms[1], formato: "gms", rotulo: rotuloCoordenada(gms[0], gms[1]) };
  const utm = /\d{6}/.test(t) ? lerUtm(t) : null;
  if (utm) return { tipo: "coordenada", lat: utm[0], lng: utm[1], formato: "utm", rotulo: rotuloCoordenada(utm[0], utm[1]) };
  return { tipo: "texto", termo: t };
}

/** Formatos aceitos, para a ajuda da caixa de busca. */
export const FORMATOS_BUSCA: { rotulo: string; exemplo: string }[] = [
  { rotulo: "Imóvel, município ou lugar", exemplo: "Iturama" },
  { rotulo: "Código do anúncio", exemplo: "AIB-000029" },
  { rotulo: "Código do CAR", exemplo: "MG-3134202-0A1B…" },
  { rotulo: "Parcela do SIGEF", exemplo: "6f1c2a3e-…-9b2d (código da certificação)" },
  { rotulo: "CCIR / código INCRA", exemplo: "950.068.035.645-8" },
  { rotulo: "Matrícula", exemplo: "matrícula 12345" },
  { rotulo: "Graus decimais", exemplo: "-19.72, -50.19" },
  { rotulo: "Graus, minutos e segundos", exemplo: "19°43'12\"S 50°11'24\"O" },
  { rotulo: "UTM (zona, E, N)", exemplo: "22K 612345 7818123" },
];
