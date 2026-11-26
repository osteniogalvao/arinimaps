/**
 * Eixos das ruas do OpenStreetMap num retângulo, para o encaixe automático da
 * planta (src/lib/geo/encaixeRuas.ts).
 *
 * O Overpass público oscila (504 e "server too busy" foram vistos na medição de
 * 26/11/2026), então há dois caminhos: os espelhos do Overpass e, se todos
 * falharem, a API principal do OSM (/api/0.6/map), que é mais estável mas
 * devolve o retângulo inteiro em XML (limite de 0,25 grau² e 50 mil nós).
 */

export type Ruas = [number, number][][];

const UA = "AriniImoveisBrasil/1.0 (contato@arinibrasil.com.br)";
const TIPOS = "primary|secondary|tertiary|residential|unclassified|living_street|trunk|service|pedestrian|road";
const ESPELHOS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type Caixa = [number, number, number, number]; // oeste, sul, leste, norte

async function porOverpass(c: Caixa): Promise<Ruas> {
  const [o, s, l, n] = c;
  const q = `[out:json][timeout:40];way["highway"~"^(${TIPOS})$"](${s},${o},${n},${l});out geom;`;
  let ultimo = "";
  for (const url of ESPELHOS) {
    try {
      const r = await fetch(url, {
        method: "POST", body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(45_000),
      });
      if (!r.ok) { ultimo = `HTTP ${r.status}`; continue; }
      const texto = await r.text();
      // o Overpass ocupado responde 200 com página HTML de erro
      if (!texto.trimStart().startsWith("{")) { ultimo = "resposta não-JSON"; continue; }
      const j = JSON.parse(texto) as { elements?: { type: string; geometry?: { lat: number; lon: number }[] }[] };
      return (j.elements ?? [])
        .filter((e) => e.type === "way" && (e.geometry?.length ?? 0) >= 2)
        .map((e) => e.geometry!.map((p) => [p.lon, p.lat] as [number, number]));
    } catch (e) {
      ultimo = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Overpass indisponível (${ultimo})`);
}

/** Lê as vias do XML da API do OSM: nós com coordenada e caminhos com tag highway. */
export function ruasDoXmlOsm(xml: string): Ruas {
  const nos = new Map<string, [number, number]>();
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const id = /\bid="(\d+)"/.exec(tag)?.[1], lat = /\blat="(-?[\d.]+)"/.exec(tag)?.[1], lon = /\blon="(-?[\d.]+)"/.exec(tag)?.[1];
    if (id && lat && lon) nos.set(id, [Number(lon), Number(lat)]);
  }
  const tipos = new RegExp(`^(${TIPOS})$`);
  const ruas: Ruas = [];
  for (const m of xml.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
    const corpo = m[1];
    const hw = /<tag k="highway" v="([^"]+)"/.exec(corpo)?.[1];
    if (!hw || !tipos.test(hw)) continue;
    const linha: [number, number][] = [];
    for (const r of corpo.matchAll(/<nd ref="(\d+)"/g)) {
      const p = nos.get(r[1]);
      if (p) linha.push(p);
    }
    if (linha.length >= 2) ruas.push(linha);
  }
  return ruas;
}

async function porApiOsm(c: Caixa): Promise<Ruas> {
  const r = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${c.join(",")}`, {
    headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`API do OSM ${r.status}`);
  return ruasDoXmlOsm(await r.text());
}

const cache = new Map<string, { em: number; ruas: Ruas }>();
const VALIDADE_MS = 6 * 60 * 60 * 1000;

/** Ruas do OSM no retângulo (com folga já incluída por quem chama). */
export async function ruasDoOsm(c: Caixa): Promise<Ruas> {
  // arredonda para reaproveitar o cache entre ajustes vizinhos
  const r: Caixa = [Math.floor(c[0] * 200) / 200, Math.floor(c[1] * 200) / 200, Math.ceil(c[2] * 200) / 200, Math.ceil(c[3] * 200) / 200];
  const k = r.join(",");
  const salvo = cache.get(k);
  if (salvo && Date.now() - salvo.em < VALIDADE_MS) return salvo.ruas;
  let ruas: Ruas;
  try {
    ruas = await porOverpass(r);
  } catch (e) {
    // a API principal só aceita até 0,25 grau² — uma cidade inteira cabe com folga
    if ((r[2] - r[0]) * (r[3] - r[1]) > 0.25) throw e;
    ruas = await porApiOsm(r);
  }
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  cache.set(k, { em: Date.now(), ruas });
  return ruas;
}
