import { buscarFonte } from "./tlsOrgaos.mjs";

const LIMITE = 4000;
const atributos = (p, nomes) => Object.fromEntries(nomes.filter(n => p[n] != null).map(n => [n,p[n]]));
const fontes = {
  inpe_queimadas: {
    url: "https://data.inpe.br/queimadas/geoserver/ows", camada: "bdqueimadas:focos", geom: "geometria",
    campos: ["id_foco_bdq","data_hora_gmt","satelite"], titulo: "Foco de calor detectado pelo INPE",
    id: f => f.properties.id_foco_bdq || f.id,
    filtro: () => "data_hora_gmt >= '" + new Date(Date.now()-365*86400000).toISOString().slice(0,10) + "'",
  },
  prodes_cerrado: {
    url: "https://terrabrasilis.dpi.inpe.br/geoserver/ows", camada: "prodes-cerrado-nb:yearly_deforestation",
    campos: ["year","area_km"], titulo: "Supressão de vegetação registrada pelo PRODES Cerrado", id: f => f.properties.uuid || f.id,
  },
  sigef: {
    url: "https://geoportal.incra.gov.br/geoserver/ows", camada: "geonode:sigef_geo", geom: "geometry",
    campos: ["parcela_codigo","status","data_aprovacao"], titulo: "Parcela certificada no SIGEF",
    id: f => f.properties.parcela_codigo, filtro: () => "status IN ('CERTIFICADA','REGISTRADA')",
  },
  ibama_embargos: {
    url: "https://pamgia.ibama.gov.br/server/rest/services/SISCOM/publico/MapServer/3/query",
    campos: ["num_tad","serie_tad","dat_embargo","sit_desmatamento"], titulo: "Termo de embargo do IBAMA",
    id: f => f.properties.num_tad ? [f.properties.num_tad,f.properties.serie_tad].filter(Boolean).join("-") : f.properties.objectid,
  },
};

// Avisos do INMET (item 19 do PDF do Carlos, 17/11/2026). A lista nacional vem inteira e é guardada por
// 15 minutos. A área de cada aviso é a malha dos municípios dos geocodes, lida do banco.
const INMET = "https://apiprevmet3.inmet.gov.br/avisos/ativos";
let inmetCache = null;
async function avisosInmetAtivos() {
  if (inmetCache && inmetCache.ate > Date.now()) return inmetCache.dados;
  const r = await buscarFonte(INMET, { signal: AbortSignal.timeout(30_000), headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("INMET indisponível HTTP " + r.status);
  const j = await r.json();
  const todos = Array.isArray(j) ? j : [...(Array.isArray(j?.hoje) ? j.hoje : []), ...(Array.isArray(j?.futuro) ? j.futuro : [])];
  if (!Array.isArray(j) && !Array.isArray(j?.hoje)) throw new Error("Resposta do INMET em formato inesperado.");
  const vistos = new Set();
  const dados = todos.map(a => {
    const id = String(a.id_aviso ?? a.id ?? "");
    const codigos = [...new Set(String(a.geocodes ?? a.geocode ?? "").split(/[,;\s]+/).filter(c => /^\d{7}$/.test(c)).map(Number))];
    const t = v => typeof v === "string" && v.trim() ? v.trim() : undefined;
    return { id, codigos, dados: Object.fromEntries(Object.entries({
      evento: t(a.descricao) ?? t(a.evento), severidade: t(a.severidade), cor: t(a.aviso_cor) ?? t(a.cor),
      inicio: t(a.inicio) ?? t(a.data_inicio), fim: t(a.fim) ?? t(a.data_fim),
    }).filter(([,v]) => v !== undefined)) };
  }).filter(a => a.id && a.codigos.length && !vistos.has(a.id) && vistos.add(a.id));
  inmetCache = { ate: Date.now() + 15 * 60_000, dados };
  return dados;
}

async function consultarAvisosInmet(db, bbox) {
  const avisos = await avisosInmetAtivos();
  if (!avisos.length) return [];
  const codigos = [...new Set(avisos.flatMap(a => a.codigos))];
  const { rows } = await db.query("select cod_ibge, geojson from monitor_malha_municipios($1,$2)", [codigos, bbox]);
  if (!rows.length) {
    // Sem malha municipal no banco não há como cruzar: falha, para não gravar um retrato vazio.
    const { rows: [m] } = await db.query("select count(*)::int n from ibge_municipios where geom is not null");
    if (!m?.n) throw new Error("Malha municipal do IBGE ausente no banco.");
    return [];
  }
  const malha = new Map(rows.map(r => [Number(r.cod_ibge), JSON.parse(r.geojson)]));
  return avisos.flatMap(a => {
    const partes = a.codigos.map(c => malha.get(c)).filter(Boolean)
      .flatMap(g => g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : []);
    if (!partes.length) return [];
    const titulo = "Aviso do INMET: " + (a.dados.evento ?? "alerta meteorológico") + (a.dados.severidade ? " (" + a.dados.severidade + ")" : "");
    return [{ id: a.id, titulo, geometry: { type: "MultiPolygon", coordinates: partes }, dados: a.dados }];
  });
}

const cache = new Map();
/** O órgão recebe só um envelope de grade. O cruzamento exato ocorre no PostGIS privado. */
export async function consultarEventosOficiais(fonte, bbox, db) {
  if (fonte === "inmet_avisos") {
    if (!db || !Array.isArray(bbox) || bbox.length!==4 || !bbox.every(Number.isFinite)) throw new Error("Consulta inválida.");
    return consultarAvisosInmet(db, bbox);
  }
  const def = fontes[fonte];
  if (!def || !Array.isArray(bbox) || bbox.length!==4 || !bbox.every(Number.isFinite)) throw new Error("Consulta inválida.");
  const janela = bbox.map((v,i) => (i<2 ? Math.floor(v*100) : Math.ceil(v*100))/100);
  const chave = [fonte,...janela].join("/");
  const anterior = cache.get(chave);
  if (anterior && anterior.ate > Date.now()) return anterior.dados;
  let qs;
  if (def.camada) {
    qs = new URLSearchParams({ service:"WFS", version:"1.0.0", request:"GetFeature", typeName:def.camada,
      outputFormat:"application/json", srsName:"EPSG:4326", maxFeatures:String(LIMITE) });
    if (def.geom) {
      qs.set("propertyName",[def.geom,...def.campos].join(","));
      qs.set("CQL_FILTER",def.filtro() + " AND BBOX(" + def.geom + "," + janela.join(",") + ",'EPSG:4326')");
    } else qs.set("bbox",janela.join(",") + ",EPSG:4326");
  } else {
    qs = new URLSearchParams({ f:"geojson", geometry:janela.join(","),geometryType:"esriGeometryEnvelope",inSR:"4326",
      outSR:"4326",spatialRel:"esriSpatialRelIntersects",outFields:["objectid",...def.campos].join(","),returnGeometry:"true" });
  }
  const r = await buscarFonte(def.url + "?" + qs, { signal:AbortSignal.timeout(45_000),headers:{Accept:"application/json"} });
  if (!r.ok) throw new Error("Fonte indisponível HTTP " + r.status);
  const j = await r.json();
  if (j.type!=="FeatureCollection" || !Array.isArray(j.features) || j.features.length>=LIMITE ||
      j.exceededTransferLimit || j.properties?.exceededTransferLimit || Number(j.numberMatched||j.totalFeatures)>j.features.length) {
    throw new Error("Leitura incompleta na fonte.");
  }
  const dados = j.features.map(f => {
    const id = def.id(f);
    if (id==null || !f.geometry || !f.properties) throw new Error("Registro sem identificação ou localização.");
    return {id:String(id),titulo:def.titulo,geometry:f.geometry,dados:atributos(f.properties,def.campos)};
  });
  // Reaproveita consultas vizinhas. Limita memória de feições grandes.
  if (cache.size>=12) cache.delete(cache.keys().next().value);
  if (Buffer.byteLength(JSON.stringify(dados))<1_000_000) cache.set(chave,{ate:Date.now()+3600000,dados});
  return dados;
}

let executando = false;
export async function verificarAreas(db) {
  if (executando) return;
  executando=true;
  try {
    for(let i=0;i<16;i++) {
      const {rows:[l]}=await db.query("select * from monitor_reservar()");
      if (!l) break;
      let dados=null;
      try { dados=await consultarEventosOficiais(l.fonte,l.bbox,db); }
      catch(e) { console.error("[monitor territorial]", l.fonte, e.message); }
      await db.query("select monitor_apurar($1,$2,$3,$4)",[l.area,l.fonte,l.token,dados===null?null:JSON.stringify(dados)]);
    }
  } finally {executando=false;}
}
