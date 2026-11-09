import "server-only";
// pacote modular, não o @turf/turf inteiro: menos código no cold start do servidor
import { simplify } from "@turf/simplify";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ufsDoEnvelope } from "@/lib/rural/ufs";
import { getComCadeia } from "@/lib/geo/tlsOrgaos";
import type { CamadaOficialId } from "@/lib/map/camadasOficiais";

/**
 * Geometria das camadas oficiais para DESENHAR no mapa (08/10/2026).
 *
 * A consulta de área (src/lib/rural/adaptadores.ts) pede contagens e atributos
 * para o relatório; aqui é outra necessidade: o polígono, enxuto, para a tela.
 * Por isso fica separado — e cada feição só leva os campos públicos que o
 * cartão do clique mostra (o CPF/CNPJ do embargado e o titular do processo
 * minerário existem nos serviços, mas não saem daqui).
 *
 * Cache por célula (tabela camadas_celulas): o órgão é consultado uma vez por
 * célula dentro da validade, não a cada movimento de cada usuário. Célula que
 * falha não é gravada como vazia — a próxima visita tenta de novo.
 */
type Feicao = { type: "Feature"; geometry: GeoJSON.Geometry; properties: Record<string, string | number | null> };
type Env = { xmin: number; ymin: number; xmax: number; ymax: number };

const UA = "AriniImoveisBrasil/1.0 (contato@arinibrasil.com.br)";
const MAX_CELULAS = 16;

type Def = {
  /** zoom da grade de células: camada de polígonos grandes usa célula grande */
  zCelula: number;
  validadeDias: number;
  /** pedidos simultâneos ao órgão (a FUNAI derruba a conexão com vários) */
  paralelo?: number;
  /** tolerância de simplificação em graus (~111 km por grau) */
  tolerancia: number;
  buscar: (env: Env) => Promise<Feicao[]>;
};

// ---------------------------------------------------------------- fontes
async function pedir(url: string, aceitar = "application/json") {
  let ultimo = "";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: aceitar }, signal: AbortSignal.timeout(45_000) });
      if (r.ok) return r;
      ultimo = `HTTP ${r.status}`;
      if (r.status !== 404 && r.status < 500) break;
    } catch (e) {
      const causa = (e as { cause?: { code?: string; message?: string } }).cause;
      ultimo = `${e instanceof Error ? e.message : String(e)}${causa ? ` (${causa.code ?? causa.message})` : ""}`;
    }
    await new Promise((ok) => setTimeout(ok, 600 * (i + 1)));
  }
  throw new Error(ultimo || "falha desconhecida");
}

async function pedirComCadeia(url: string) {
  let ultimo = "";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await getComCadeia(url, { "User-Agent": UA, Accept: "application/json" });
      if (r.status === 200) return JSON.parse(r.corpo);
      ultimo = `HTTP ${r.status}`;
    } catch (e) {
      ultimo = e instanceof Error ? e.message : String(e);
    }
    await new Promise((ok) => setTimeout(ok, 600 * (i + 1)));
  }
  throw new Error(ultimo);
}

async function wfs(base: string, camada: string, env: Env, max = 2000) {
  const url = `${base}?service=WFS&version=1.0.0&request=GetFeature&typeName=${camada}&outputFormat=application/json` +
    `&maxFeatures=${max}&bbox=${env.xmin},${env.ymin},${env.xmax},${env.ymax},EPSG:4326`;
  // FUNAI: cadeia de certificado incompleta no servidor (ver tlsOrgaos.ts)
  const j = base.includes("funai.gov.br") ? await pedirComCadeia(url) : await (await pedir(url)).json();
  if (j.exceptions) throw new Error(String(j.exceptions[0]?.text ?? "erro do WFS"));
  return (j.features ?? []) as { geometry: GeoJSON.Geometry; properties: Record<string, unknown> }[];
}

async function arcgis(base: string, camada: number, env: Env, campos: string, max: number | null = 2000) {
  const g = encodeURIComponent(JSON.stringify({ ...env, spatialReference: { wkid: 4326 } }));
  const url = `${base}/${camada}/query?f=geojson&geometry=${g}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent(campos)}&returnGeometry=true` +
    `&geometryPrecision=6&maxAllowableOffset=0.00005` + (max === null ? "" : `&resultRecordCount=${max}`);
  const j = await (await pedir(url)).json();
  if (j.error) throw new Error(j.error.message ?? "erro do serviço");
  return (j.features ?? []) as { geometry: GeoJSON.Geometry; properties: Record<string, unknown> }[];
}

/**
 * i3geo do INCRA: só GML 2 (`gml:coordinates` "x,y x,y"), um tema por UF.
 * O bbox vai SEM sufixo EPSG (com ele o WFS inverte os eixos — ver adaptadores.ts).
 */
async function i3geo(tema: string, env: Env, max = 2000) {
  const url = `https://acervofundiario.incra.gov.br/i3geo/ogc.php?tema=${tema}&service=WFS&version=1.0.0&request=GetFeature` +
    `&typeName=${tema}&maxFeatures=${max}&bbox=${env.xmin},${env.ymin},${env.xmax},${env.ymax}`;
  const xml = await (await pedir(url, "application/xml")).text();
  if (xml.includes("ServiceException")) throw new Error("o INCRA recusou a consulta");
  const anel = (s: string) => s.trim().split(/\s+/).map((par) => par.split(",").map(Number).slice(0, 2));
  return xml.split("<gml:featureMember>").slice(1).flatMap((bloco) => {
    const props: Record<string, unknown> = {};
    for (const m of bloco.matchAll(/<ms:([A-Za-z0-9_]+)>([^<]*)<\/ms:\1>/g)) props[m[1]] = m[2];
    const poligonos = [...bloco.matchAll(/<gml:Polygon[^>]*>([\s\S]*?)<\/gml:Polygon>/g)].map((p) => {
      const ext = p[1].match(/<gml:outerBoundaryIs>[\s\S]*?<gml:coordinates>([^<]+)<\/gml:coordinates>/)?.[1];
      const ints = [...p[1].matchAll(/<gml:innerBoundaryIs>[\s\S]*?<gml:coordinates>([^<]+)<\/gml:coordinates>/g)].map((i) => anel(i[1]));
      return ext ? [anel(ext), ...ints] : null;
    }).filter((p): p is number[][][] => !!p);
    if (!poligonos.length) return [];
    const geometry: GeoJSON.Geometry = poligonos.length === 1
      ? { type: "Polygon", coordinates: poligonos[0] }
      : { type: "MultiPolygon", coordinates: poligonos };
    return [{ geometry, properties: props }];
  });
}

const s = (v: unknown) => (v == null ? null : String(v).trim() || null);
const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const dataBr = (v: unknown) => {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1"));
  return Number.isNaN(d.getTime()) ? s(v) : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
};
const feicao = (geometry: GeoJSON.Geometry, properties: Feicao["properties"]): Feicao => ({ type: "Feature", geometry, properties });

const DEFS: Record<CamadaOficialId, Def> = {
  sigef: {
    zCelula: 12, validadeDias: 30, tolerancia: 0.00002,
    buscar: async (env) => {
      const temas = ufsDoEnvelope(env).flatMap((uf) => [`certificada_sigef_particular_${uf}`, `certificada_sigef_publico_${uf}`]);
      const porTema = await Promise.all(temas.map(async (t) => (await i3geo(t, env)).map((f) => feicao(f.geometry, {
        id: s(f.properties.parcela_codigo) ?? s(f.properties.codigo_imovel),
        nome: s(f.properties.nome_area),
        situacao: s(f.properties.status),
        natureza: t.includes("publico") ? "imóvel público" : "imóvel particular",
        certificada_em: dataBr(f.properties.data_aprovacao),
        codigo_incra: s(f.properties.codigo_imovel),
      }))));
      return porTema.flat();
    },
  },
  ibama_embargos: {
    zCelula: 10, validadeDias: 7, tolerancia: 0.00005,
    buscar: async (env) => (await arcgis("https://pamgia.ibama.gov.br/server/rest/services/SISCOM/publico/MapServer", 3, env,
      "objectid,num_tad,serie_tad,dat_embargo,municipio,uf,des_infracao,qtd_area_embargada")).map((f) => feicao(f.geometry, {
      id: s(f.properties.objectid),
      termo: [s(f.properties.num_tad), s(f.properties.serie_tad)].filter(Boolean).join("-"),
      data: dataBr(f.properties.dat_embargo),
      area_ha: n(f.properties.qtd_area_embargada),
      infracao: s(f.properties.des_infracao)?.slice(0, 140) ?? null,
      municipio: [s(f.properties.municipio), s(f.properties.uf)].filter(Boolean).join("/"),
    })),
  },
  anm: {
    // o SIGMINE recusa paginação: sem resultRecordCount
    zCelula: 10, validadeDias: 30, tolerancia: 0.00005,
    buscar: async (env) => (await arcgis("https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer", 0, env,
      "OBJECTID,PROCESSO,FASE,SUBS,USO,AREA_HA,ULT_EVENTO", null)).map((f) => feicao(f.geometry, {
      id: s(f.properties.OBJECTID) ?? s(f.properties.PROCESSO),
      processo: s(f.properties.PROCESSO),
      fase: s(f.properties.FASE),
      substancia: s(f.properties.SUBS),
      uso: s(f.properties.USO),
      area_ha: n(f.properties.AREA_HA),
    })),
  },
  funai: {
    zCelula: 8, validadeDias: 90, tolerancia: 0.0003, paralelo: 1,
    buscar: async (env) => (await wfs("https://geoserver.funai.gov.br/geoserver/Funai/ows", "Funai:tis_poligonais", env, 500)).map((f) => feicao(f.geometry, {
      id: s(f.properties.terrai_codigo) ?? s(f.properties.gid),
      nome: s(f.properties.terrai_nome),
      fase: s(f.properties.fase_ti),
      etnia: s(f.properties.etnia_nome),
    })),
  },
  ucs: {
    zCelula: 8, validadeDias: 90, tolerancia: 0.0003,
    buscar: async (env) => (await wfs("https://terrabrasilis.dpi.inpe.br/geoserver/ows", "prodes-cerrado-nb:conservation_units_cerrado_biome", env, 500)).map((f) => feicao(f.geometry, {
      id: s(f.properties.id),
      nome: s(f.properties.nome),
      categoria: s(f.properties.categoria),
      esfera: s(f.properties.esfera),
    })),
  },
  quilombolas: {
    zCelula: 8, validadeDias: 90, tolerancia: 0.0002,
    buscar: async (env) => (await arcgis("https://pamgia.ibama.gov.br/server/rest/services/BasesSincronizadas/lim_quilombos_incra_a/MapServer", 0, env,
      "objectid,nm_comunid,nm_municip,fase", 500)).map((f) => feicao(f.geometry, {
      id: s(f.properties.objectid),
      nome: s(f.properties.nm_comunid),
      municipio: s(f.properties.nm_municip),
      fase: s(f.properties.fase),
    })),
  },
  inpe_queimadas: {
    // histórico desde 1998: só o último ano, que é o que pesa numa negociação
    zCelula: 10, validadeDias: 1, tolerancia: 0,
    buscar: async (env) => {
      const desde = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const filtro = encodeURIComponent(`data_hora_gmt >= '${desde}' AND BBOX(geometria,${env.xmin},${env.ymin},${env.xmax},${env.ymax})`);
      const url = `https://data.inpe.br/queimadas/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature` +
        `&typeName=bdqueimadas:focos&outputFormat=application/json&maxFeatures=3000&CQL_FILTER=${filtro}`;
      const j = await (await pedir(url)).json();
      return ((j.features ?? []) as { geometry: GeoJSON.Geometry; properties: Record<string, unknown> }[]).map((f) => feicao(f.geometry, {
        id: s(f.properties.id_foco_bdq) ?? `${JSON.stringify((f.geometry as GeoJSON.Point).coordinates)}${s(f.properties.data_hora_gmt)}`,
        data: dataBr(f.properties.data_hora_gmt),
        satelite: s(f.properties.satelite),
      }));
    },
  },
  // limite oficial do IBGE já no banco (migration 0051) e já simplificado lá (~900 m);
  // célula grande porque a camada é de visão regional
  ibge_biomas: {
    zCelula: 4, validadeDias: 365, tolerancia: 0,
    buscar: async (env) => {
      const { data, error } = await supabaseAdmin().rpc("fn_biomas_mapa", {
        p_xmin: env.xmin, p_ymin: env.ymin, p_xmax: env.xmax, p_ymax: env.ymax,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Feicao[];
    },
  },
  prodes_cerrado: {
    zCelula: 12, validadeDias: 90, tolerancia: 0.00002,
    buscar: async (env) => (await wfs("https://terrabrasilis.dpi.inpe.br/geoserver/ows", "prodes-cerrado-nb:yearly_deforestation", env, 3000)).map((f) => feicao(f.geometry, {
      id: s(f.properties.uuid) ?? s(f.properties.fid),
      ano: n(f.properties.year),
      area_ha: f.properties.area_km == null ? null : Math.round(Number(f.properties.area_km) * 10000) / 100,
    })),
  },
};

// ---------------------------------------------------------------- células
const lon2x = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const y2lat = (y: number, z: number) => {
  const k = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k)));
};

function arredondar(g: GeoJSON.Geometry): GeoJSON.Geometry {
  const r = (c: unknown): unknown => (typeof (c as number[])[0] === "number"
    ? [Math.round((c as number[])[0] * 1e6) / 1e6, Math.round((c as number[])[1] * 1e6) / 1e6]
    : (c as unknown[]).map(r));
  return { ...g, coordinates: r((g as GeoJSON.Polygon).coordinates) } as GeoJSON.Geometry;
}

// a mesma célula pedida por duas telas ao mesmo tempo: uma busca só
const emAndamento = new Map<string, Promise<Feicao[]>>();

async function buscarCelula(id: CamadaOficialId, def: Def, x: number, y: number): Promise<Feicao[]> {
  const env = { xmin: x2lon(x, def.zCelula), xmax: x2lon(x + 1, def.zCelula), ymin: y2lat(y + 1, def.zCelula), ymax: y2lat(y, def.zCelula) };
  const brutas = await def.buscar(env);
  const feicoes = brutas.filter((f) => f.geometry).map((f) => {
    if (!def.tolerancia) return f;
    try {
      const simples = simplify(f as GeoJSON.Feature, { tolerance: def.tolerancia, highQuality: false, mutate: false });
      return { ...f, geometry: arredondar(simples.geometry) };
    } catch {
      return f;
    }
  });
  await supabaseAdmin().from("camadas_celulas").upsert({
    camada: id, z: def.zCelula, x, y, buscado_em: new Date().toISOString(),
    quantidade: feicoes.length, geojson: { type: "FeatureCollection", features: feicoes }, erro: null,
  });
  return feicoes;
}

export class JanelaGrande extends Error {}

/** Feições da camada na janela: do cache quando possível, do órgão quando faltar ou vencer. */
export async function camadaNaJanela(id: CamadaOficialId, env: Env) {
  const def = DEFS[id];
  const celulas: { x: number; y: number }[] = [];
  for (let x = lon2x(env.xmin, def.zCelula); x <= lon2x(env.xmax, def.zCelula); x++)
    for (let y = lat2y(env.ymax, def.zCelula); y <= lat2y(env.ymin, def.zCelula); y++) celulas.push({ x, y });
  if (celulas.length > MAX_CELULAS) throw new JanelaGrande();

  const corte = new Date(Date.now() - def.validadeDias * 86_400_000).toISOString();
  const { data: guardadas } = await supabaseAdmin().from("camadas_celulas")
    .select("x, y, geojson").eq("camada", id).eq("z", def.zCelula).is("erro", null).gte("buscado_em", corte)
    .in("x", [...new Set(celulas.map((c) => c.x))]).in("y", [...new Set(celulas.map((c) => c.y))]);
  const porCelula = new Map((guardadas ?? []).map((g) => [`${g.x}/${g.y}`, ((g.geojson as { features?: Feicao[] })?.features ?? [])]));

  const faltando = celulas.filter((c) => !porCelula.has(`${c.x}/${c.y}`));
  let falhas = 0;
  const umaCelula = (c: { x: number; y: number }) => {
    const chave = `${id}/${c.x}/${c.y}`;
    let p = emAndamento.get(chave);
    if (!p) {
      p = buscarCelula(id, def, c.x, c.y).finally(() => emAndamento.delete(chave));
      emAndamento.set(chave, p);
    }
    return p;
  };
  const passo = def.paralelo ?? 4;
  const res: PromiseSettledResult<Feicao[]>[] = [];
  for (let i = 0; i < faltando.length; i += passo) {
    res.push(...await Promise.allSettled(faltando.slice(i, i + passo).map(umaCelula)));
  }
  res.forEach((r, i) => {
    if (r.status === "fulfilled") porCelula.set(`${faltando[i].x}/${faltando[i].y}`, r.value);
    else {
      falhas++;
      console.error(`camada ${id} célula ${faltando[i].x}/${faltando[i].y}:`, r.reason instanceof Error ? r.reason.message : r.reason);
    }
  });

  // a mesma feição atravessa várias células: entra uma vez
  const vistas = new Set<string>();
  const features: Feicao[] = [];
  for (const lista of porCelula.values()) {
    for (const f of lista) {
      const k = String(f.properties.id ?? JSON.stringify(f.geometry).slice(0, 80));
      if (vistas.has(k)) continue;
      vistas.add(k);
      features.push(f);
    }
  }
  return { type: "FeatureCollection" as const, features, falhas, celulas: celulas.length };
}
