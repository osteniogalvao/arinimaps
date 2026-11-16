/** WFS nacional publicado pelo Geoportal do INCRA. */
const BASE = "https://geoportal.incra.gov.br/geoserver/ows";
const CAMPOS = "status,data_aprovacao,parcela_codigo,registro_matricula,natureza,codigo_imovel,municipio_id,nome_area";
const UF: Record<string, number> = {
  ro:11, ac:12, am:13, rr:14, pa:15, ap:16, to:17, ma:21, pi:22, ce:23, rn:24, pb:25, pe:26, al:27,
  se:28, ba:29, mg:31, es:32, rj:33, sp:35, pr:41, sc:42, rs:43, ms:50, mt:51, go:52, df:53,
};
type Envelope = { xmin:number; ymin:number; xmax:number; ymax:number };
export type CampoBuscaSigef = "parcela_codigo" | "codigo_imovel" | "registro_matricula";
type Opcoes = { max: number; geometria: boolean } & ({ bbox: Envelope; nome?: string } | { municipio: number; nome?: string } | { campo: CampoBuscaSigef; valores: string[]; ufs: string[] });
export type FeicaoSigef = {
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon | null;
  properties: Record<string, string | number | null>;
};

export function nomeRuralValido(nome: string) {
  return nome.length >= 3 && nome.length <= 80 && /^[\p{L}\p{M}\p{N} .,'’()/-]+$/u.test(nome) && /\p{L}/u.test(nome);
}

export async function buscarSigef(opcoes: Opcoes) {
  let filtro: string;
  if ("bbox" in opcoes) {
    const { xmin, ymin, xmax, ymax } = opcoes.bbox;
    if (![xmin,ymin,xmax,ymax].every(Number.isFinite) || xmin >= xmax || ymin >= ymax) throw new Error("Limites inválidos.");
    filtro = `BBOX(geometry,${xmin},${ymin},${xmax},${ymax},'EPSG:4326')`;
  } else if ("municipio" in opcoes) {
    if (!/^\d{7}$/.test(String(opcoes.municipio))) throw new Error("Município inválido.");
    filtro = "municipio_id = " + opcoes.municipio;
  } else {
    const ids = opcoes.ufs.map(uf => UF[uf]).filter(Number.isInteger);
    const valores = [...new Set(opcoes.valores.filter(v => /^[a-zA-Z0-9.-]{1,64}$/.test(v)))];
    if (!ids.length || !valores.length) return { total: 0, features: [] as FeicaoSigef[] };
    filtro = `uf_id IN (${ids.join(",")}) AND ${opcoes.campo} IN (${valores.map(v => "'" + v + "'").join(",")})`;
  }
  if ("nome" in opcoes && opcoes.nome) {
    if (!nomeRuralValido(opcoes.nome)) throw new Error("Nome de imóvel inválido.");
    // Sem curingas fornecidos pelo cliente. Aspas em nomes como Pau d'Óleo são literais.
    filtro += " AND nome_area ILIKE '%" + opcoes.nome.replaceAll("'", "''") + "%'";
  }
  const qs = new URLSearchParams({
    service: "WFS", version: "1.0.0", request: "GetFeature", typeName: "geonode:sigef_geo",
    srsName: "EPSG:4326", outputFormat: "application/json", maxFeatures: String(opcoes.max),
    propertyName: (opcoes.geometria ? "geometry," : "") + CAMPOS,
    CQL_FILTER: "status IN ('CERTIFICADA','REGISTRADA') AND " + filtro,
  });
  const r = await fetch(BASE + "?" + qs, {
    signal: AbortSignal.timeout(25000), headers: { Accept: "application/json", "User-Agent": "AriniImoveisBrasil/1.0" },
  });
  if (!r.ok) throw new Error(`Geoportal INCRA HTTP ${r.status}`);
  const j = await r.json();
  if (j.type !== "FeatureCollection" || !Array.isArray(j.features)) throw new Error("O Geoportal INCRA não devolveu as parcelas.");
  return { total: Number.isInteger(j.numberMatched) ? j.numberMatched as number : j.features.length as number, features: j.features as FeicaoSigef[] };
}
