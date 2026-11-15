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

const cache = new Map();
/** O órgão recebe só um envelope de grade. O cruzamento exato ocorre no PostGIS privado. */
export async function consultarEventosOficiais(fonte, bbox) {
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
      try { dados=await consultarEventosOficiais(l.fonte,l.bbox); }
      catch(e) { console.error("[monitor territorial]", l.fonte, e.message); }
      await db.query("select monitor_apurar($1,$2,$3,$4)",[l.area,l.fonte,l.token,dados===null?null:JSON.stringify(dados)]);
    }
  } finally {executando=false;}
}
