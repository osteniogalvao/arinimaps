import "server-only";
import { buscarSigef } from "@/lib/geo/sigef";
// pacote modular, não o @turf/turf inteiro: menos código no cold start do servidor
import { simplify } from "@turf/simplify";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ufsDoEnvelope } from "@/lib/rural/ufs";
import { buscarFonte } from "@/lib/geo/tlsOrgaos";
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
      const r = await buscarFonte(url, { headers: { "User-Agent": UA, Accept: aceitar }, signal: AbortSignal.timeout(45_000) });
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

async function wfs(base: string, camada: string, env: Env, max = 2000) {
  const url = `${base}?service=WFS&version=1.0.0&request=GetFeature&typeName=${camada}&outputFormat=application/json` +
    `&maxFeatures=${max}&bbox=${env.xmin},${env.ymin},${env.xmax},${env.ymax},EPSG:4326`;
  const j = await (await pedir(url)).json();
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
  if (!/<(?:[\\w.-]+:)?FeatureCollection\\b/.test(xml) || xml.includes("ServiceException")) throw new Error("o INCRA não devolveu uma coleção de feições");
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

/** Primeiro campo preenchido entre os nomes possíveis, sem ligar para maiúsculas (o SIGEL não padroniza). */
const campo = (p: Record<string, unknown>, ...nomes: string[]) => {
  const chaves = new Map(Object.keys(p).map((k) => [k.toLowerCase(), k]));
  for (const nome of nomes) {
    const k = chaves.get(nome.toLowerCase());
    if (k && p[k] != null && String(p[k]).trim() !== "") return p[k];
  }
  return null;
};

/** Camada de pontos: usina que vier como polígono vira o centro do retângulo dela. */
function comoPonto(g: GeoJSON.Geometry): GeoJSON.Geometry {
  if (g.type === "Point" || g.type === "MultiPoint") return g;
  const lim = [Infinity, Infinity, -Infinity, -Infinity];
  const visitar = (c: unknown) => {
    if (typeof (c as number[])[0] === "number") {
      const [x, y] = c as number[];
      lim[0] = Math.min(lim[0], x); lim[1] = Math.min(lim[1], y); lim[2] = Math.max(lim[2], x); lim[3] = Math.max(lim[3], y);
    } else (c as unknown[]).forEach(visitar);
  };
  if ("coordinates" in g) visitar(g.coordinates);
  return Number.isFinite(lim[0]) ? { type: "Point", coordinates: [(lim[0] + lim[2]) / 2, (lim[1] + lim[3]) / 2] } : g;
}

// ANEEL/SIGEL: os mesmos serviços e índices da consulta de área (medidos em 07/10/2026)
const SIGEL = "https://sigel.aneel.gov.br/arcgis/rest/services/PORTAL";
async function usinasSigel(env: Env, camadas: { servico: string; id: number; tipo: string }[]) {
  const listas = await Promise.allSettled(camadas.map(async (c) => (await arcgis(`${SIGEL}/${c.servico}/MapServer`, c.id, env, "*", 1000))
    .flatMap((f) => f.geometry ? [feicao(c.servico === "Camadas" || c.tipo === "Subestação" ? comoPonto(f.geometry) : f.geometry, {
      id: `${c.servico}-${c.id}-${s(campo(f.properties, "objectid", "fid", "ceg", "id")) ?? JSON.stringify(f.geometry).slice(0, 60)}`,
      tipo: c.tipo,
      nome: s(campo(f.properties, "nome", "nome_empre", "nom_empreendimento", "denominacao", "descricao", "name")),
      situacao: s(campo(f.properties, "fase", "situacao", "estagio", "status")),
      agente: s(campo(f.properties, "proprietar", "proprietario", "agente", "concession", "empresa")),
      potencia_kw: n(campo(f.properties, "pot_kw", "potencia", "pot_outorg", "potencia_kw")),
      tensao: s(campo(f.properties, "tensao", "tensao_kv", "nivel_tens", "kv")),
    })] : [])));
  // uma camada fora do ar não zera as outras; todas fora é a fonte fora
  if (listas.every((l) => l.status === "rejected")) throw (listas[0] as PromiseRejectedResult).reason;
  return listas.flatMap((l) => (l.status === "fulfilled" ? l.value : []));
}

// ---------------------------------------------------------------- serviços achados pelo nome
/**
 * Segundo lote (17/11/2026): o serviço é achado pelo nome dentro da pasta do
 * órgão (`?f=json` lista serviços e camadas), em vez de um endereço fixo que
 * ninguém aqui conseguiu medir (a rede do ambiente de desenvolvimento não
 * alcança os .gov.br). Achado ou não, o resultado fica 12 h (não achado: 30 min)
 * em memória, para não listar a pasta a cada célula.
 */
type Alvo = { pasta: string; servico: RegExp; camada?: RegExp } | { servicoUrl: string; camada?: RegExp };
const achados = new Map<string, { em: number; url?: string; id?: number; erro?: string }>();

async function descobrir(chave: string, alvos: Alvo[]): Promise<{ url: string; id: number }> {
  const guardado = achados.get(chave);
  if (guardado && Date.now() - guardado.em < (guardado.url ? 12 : 0.5) * 3_600_000) {
    if (guardado.url) return { url: guardado.url, id: guardado.id! };
    throw new Error(guardado.erro);
  }
  for (const alvo of alvos) {
    try {
      let url: string;
      if ("servicoUrl" in alvo) url = alvo.servicoUrl;
      else {
        const lista = await (await pedir(`${alvo.pasta}?f=json`)).json() as { services?: { name: string; type: string }[] };
        const svc = (lista.services ?? []).find((x) => alvo.servico.test(x.name) && /^(MapServer|FeatureServer)$/.test(x.type));
        if (!svc) continue;
        url = `${alvo.pasta.replace(/\/rest\/services\/.*$/, "/rest/services")}/${svc.name}/${svc.type}`;
      }
      const info = await (await pedir(`${url}?f=json`)).json() as { layers?: { id: number; name: string; subLayerIds?: number[] | null }[] };
      const camadas = (info.layers ?? []).filter((l) => !l.subLayerIds?.length);
      const camada = alvo.camada ? camadas.find((l) => alvo.camada!.test(l.name)) : camadas[0];
      if (!camada) continue;
      achados.set(chave, { em: Date.now(), url, id: camada.id });
      return { url, id: camada.id };
    } catch (e) {
      console.error(`camada ${chave}: pasta do órgão falhou:`, e instanceof Error ? e.message : e);
    }
  }
  const erro = "o serviço não foi encontrado na pasta do órgão";
  achados.set(chave, { em: Date.now(), erro });
  throw new Error(erro);
}

/** Campos de nome, descrição e área variam por órgão: pega o que houver. */
function propsGenericas(p: Record<string, unknown>) {
  const chaves = Object.keys(p);
  const nome = campo(p, "nome", "nome_uc", "nm_uc", "nomeuc", "nome_proje", "nome_projeto", "nm_projeto", "nome_pa", "nm_pa",
    "nome_aerod", "nm_aerodromo", "nome_barra", "nm_barragem", "nome_flore", "nm_floresta", "denominacao", "name")
    ?? (() => { const k = chaves.find((c) => /^(nm_|nome|no_)/i.test(c) && p[c] != null && String(p[c]).trim()); return k ? p[k] : null; })();
  const curtos = chaves.filter((c) => /categ|esfera|grupo|fase|situa|tipo|classe|uso|munic|^uf$|^sg_uf/i.test(c))
    .map((c) => s(p[c])).filter((v): v is string => !!v && v.length <= 60);
  const data = chaves.find((c) => /^(dat|data|dt_)/i.test(c) && p[c] != null && p[c] !== "");
  const detalhe = [...new Set(curtos)].slice(0, 3).join(" · ") + (data ? `${curtos.length ? " · " : ""}${dataBr(p[data])}` : "");
  const area = campo(p, "area_ha", "areahectar", "area_hecta", "qtd_area", "area_haa", "nu_area_ha", "area");
  return { nome: s(nome)?.slice(0, 120) ?? null, detalhe: detalhe || null, area_ha: n(area) };
}

async function arcgisAchado(chave: string, alvos: Alvo[], env: Env, max = 2000) {
  const { url, id } = await descobrir(chave, alvos);
  // serviço sem paginação recusa resultRecordCount (como o SIGMINE): tenta de novo sem
  const linhas = await arcgis(url, id, env, "*", max).catch(() => arcgis(url, id, env, "*", null));
  return linhas.flatMap((f) => f.geometry ? [feicao(f.geometry, {
    id: `${chave}-${s(campo(f.properties, "objectid", "fid", "gid", "id")) ?? JSON.stringify(f.geometry).slice(0, 60)}`,
    ...propsGenericas(f.properties),
  })] : []);
}

const PAMGIA = "https://pamgia.ibama.gov.br/server/rest/services/BasesSincronizadas";
const SNIRH = "https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS";

/** PRODES dos outros biomas no TerraBrasilis; só pergunta aos biomas que cruzam a célula (limite do IBGE já no banco). */
const PRODES_BIOMAS: Record<string, string> = {
  "Amazônia": "prodes-legal-amz:yearly_deforestation",
  "Mata Atlântica": "prodes-mata-atlantica-nb:yearly_deforestation",
  "Caatinga": "prodes-caatinga-nb:yearly_deforestation",
  "Pampa": "prodes-pampa-nb:yearly_deforestation",
  "Pantanal": "prodes-pantanal-nb:yearly_deforestation",
};

const DEFS: Record<CamadaOficialId, Def> = {
  sigef: {
    zCelula: 12, validadeDias: 30, tolerancia: 0.00002,
    buscar: async (env) => {
      const { features } = await buscarSigef({ bbox: env, max: 2000, geometria: true });
      return features.flatMap(f => f.geometry ? [feicao(f.geometry, {
        id: s(f.properties.parcela_codigo), nome: s(f.properties.nome_area), situacao: s(f.properties.status),
        natureza: s(f.properties.natureza), certificada_em: dataBr(f.properties.data_aprovacao),
        codigo_incra: s(f.properties.codigo_imovel),
      })] : []);
    },
  },
  snci: {
    zCelula: 12, validadeDias: 30, tolerancia: 0.00002,
    buscar: async (env) => {
      const ufs = ufsDoEnvelope(env);
      // O IAT publica as duas bases do INCRA para o Paraná. Use-o só em
      // células internas ao estado, sem confundir uma borda com ausência.
      if (ufs.length === 1 && ufs[0] === "pr") {
        const base = "https://geopr.iat.pr.gov.br/server/rest/services/Hosted/Registros_de_Im%C3%B3veis___INCRA/FeatureServer";
        const listas = await Promise.all([3,4].map(async camada => (await arcgis(base, camada, env,
          "fid,num_certif,nome_imove,qtd_area_p")).map(f => feicao(f.geometry, {
          id: `pr-${camada}-${f.properties.fid}`, nome: s(f.properties.nome_imove),
          certificacao: s(f.properties.num_certif), area_ha: n(f.properties.qtd_area_p),
          natureza: camada === 3 ? "Imóvel público" : "Imóvel particular", fonte: "INCRA / IAT-PR",
        }))));
        return listas.flat();
      }
      const temas = ufs.flatMap(uf => ["privado", "publico"].map(tipo => `imoveiscertificados_${tipo}_${uf}`));
      const listas = await Promise.all(temas.map(async tema => (await i3geo(tema, env)).map(f => feicao(f.geometry, {
        id: s(f.properties.num_certificacao) ?? s(f.properties.cod_imovel_rural),
        nome: s(f.properties.nome_imovel), natureza: tema.includes("publico") ? "Imóvel público" : "Imóvel particular",
        certificacao: s(f.properties.num_certificacao), area_ha: n(f.properties.qtd_area_peca_tecnica),
      }))));
      return listas.flat();
    },
  },
  credito_rural: {
    zCelula: 12, validadeDias: 7, tolerancia: 0.00002,
    buscar: async env => {
      const { data, error } = await supabaseAdmin().rpc("fn_sicor_glebas_mapa", {
        p_xmin: env.xmin, p_ymin: env.ymin, p_xmax: env.xmax, p_ymax: env.ymax,
      });
      if (error || !Array.isArray(data)) throw new Error("A base regional do SICOR está indisponível.");
      return data as Feicao[];
    },
  },
  outorgas_federais: {
    zCelula: 10, validadeDias: 7, tolerancia: 0,
    buscar: async env => (await arcgis("https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS/outorgas_federais_superficial/MapServer", 4, env,
      "objectid,int_nm_corpohidrico,ing_nm_municipio,out_nu_ato,out_dt_outorgafinal,outorga_valida")).map(f => feicao(f.geometry, {
        id: s(f.properties.objectid), curso: s(f.properties.int_nm_corpohidrico), municipio: s(f.properties.ing_nm_municipio),
        ato: s(f.properties.out_nu_ato), validade: dataBr(f.properties.out_dt_outorgafinal),
        status: f.properties.outorga_valida == null ? null : Number(f.properties.outorga_valida) === 1 ? "Vigente na base" : "Sem vigência na base",
      })),
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
    // 17/11: validade de 3 h (era 1 dia), mais perto do "tempo real" do Dados Fazenda
    zCelula: 10, validadeDias: 0.125, tolerancia: 0,
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
  aneel_transmissao: {
    zCelula: 9, validadeDias: 30, tolerancia: 0.0001,
    buscar: (env) => usinasSigel(env, [
      { servico: "Transmiss%C3%A3o", id: 1, tipo: "Linha de transmissão" },
      { servico: "Transmiss%C3%A3o", id: 3, tipo: "Subestação" },
    ]),
  },
  aneel_hidreletricas: {
    zCelula: 8, validadeDias: 30, tolerancia: 0,
    buscar: (env) => usinasSigel(env, [
      { servico: "Camadas", id: 1, tipo: "Usina hidrelétrica" },
      { servico: "Camadas", id: 3, tipo: "Pequena central hidrelétrica" },
      { servico: "Camadas", id: 5, tipo: "Central geradora hidrelétrica" },
    ]),
  },
  aneel_termeletricas: {
    zCelula: 8, validadeDias: 30, tolerancia: 0,
    buscar: (env) => usinasSigel(env, [{ servico: "Camadas", id: 2, tipo: "Usina termelétrica" }]),
  },
  aneel_solar: {
    zCelula: 8, validadeDias: 30, tolerancia: 0,
    buscar: (env) => usinasSigel(env, [{ servico: "Camadas", id: 7, tipo: "Usina fotovoltaica" }]),
  },
  iphan_sitios: {
    zCelula: 10, validadeDias: 30, tolerancia: 0,
    buscar: async (env) => (await wfs("https://geoserver.iphan.gov.br/geoserver/ows", "SICG:tg_bem_classificacao", env, 1000)).flatMap((f) => f.geometry ? [feicao(comoPonto(f.geometry), {
      id: s(f.properties.id_bem) ?? s(f.properties.co_iphan),
      nome: s(f.properties.identificacao_bem),
      tipo: s(f.properties.ds_tipo_bem) ?? s(f.properties.ds_natureza),
      classificacao: s(f.properties.ds_classificacao),
      codigo: s(f.properties.co_iphan),
    })] : []),
  },
  ana_rios: {
    zCelula: 11, validadeDias: 90, tolerancia: 0.00005,
    buscar: async (env) => (await arcgis("https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS/Curso_d%C3%81gua/MapServer", 0, env, "*", 2000))
      .flatMap((f) => f.geometry ? [feicao(f.geometry, {
        id: s(campo(f.properties, "objectid", "fid", "cocursodag")) ?? JSON.stringify(f.geometry).slice(0, 60),
        nome: s(campo(f.properties, "BHB_NM_NORIOCOMP", "BHB_CD_NORIO", "nome", "noriocomp")),
      })] : []),
  },
  prodes_biomas: {
    zCelula: 12, validadeDias: 90, tolerancia: 0.00002,
    buscar: async (env) => {
      const { data, error } = await supabaseAdmin().rpc("fn_biomas_mapa", {
        p_xmin: env.xmin, p_ymin: env.ymin, p_xmax: env.xmax, p_ymax: env.ymax,
      });
      if (error) throw new Error(error.message);
      const biomas = [...new Set(((data ?? []) as Feicao[]).map((f) => String(f.properties.nome)))].filter((b) => PRODES_BIOMAS[b]);
      if (!biomas.length) return [];
      const listas = await Promise.allSettled(biomas.map(async (bioma) => (await wfs("https://terrabrasilis.dpi.inpe.br/geoserver/ows", PRODES_BIOMAS[bioma], env, 3000))
        .map((f) => feicao(f.geometry, {
          id: `${bioma}-${s(f.properties.uuid) ?? s(f.properties.fid) ?? s(f.properties.id)}`,
          ano: n(f.properties.year ?? f.properties.ano),
          area_ha: f.properties.area_km == null ? null : Math.round(Number(f.properties.area_km) * 10000) / 100,
          bioma,
        }))));
      if (listas.every((l) => l.status === "rejected")) throw (listas[0] as PromiseRejectedResult).reason;
      return listas.flatMap((l) => (l.status === "fulfilled" ? l.value : []));
    },
  },
  assentamentos: {
    zCelula: 10, validadeDias: 30, tolerancia: 0.0001,
    buscar: (env) => arcgisAchado("assentamentos", [{ pasta: PAMGIA, servico: /assentament/i }], env),
  },
  ucs_brasil: {
    zCelula: 8, validadeDias: 90, tolerancia: 0.0003,
    buscar: (env) => arcgisAchado("ucs_brasil", [{ pasta: PAMGIA, servico: /unidade.*conserv|(^|[/_])ucs?(_|$)|cnuc/i }], env, 500),
  },
  ibama_autos: {
    zCelula: 10, validadeDias: 7, tolerancia: 0.00005,
    buscar: (env) => arcgisAchado("ibama_autos", [
      { servicoUrl: "https://pamgia.ibama.gov.br/server/rest/services/SISCOM/publico/MapServer", camada: /auto/i },
      { pasta: PAMGIA, servico: /auto.*infra/i },
    ], env),
  },
  florestas_publicas: {
    zCelula: 8, validadeDias: 90, tolerancia: 0.0003,
    buscar: (env) => arcgisAchado("florestas_publicas", [{ pasta: PAMGIA, servico: /floresta.*publica|cnfp/i }], env, 500),
  },
  aerodromos: {
    zCelula: 8, validadeDias: 90, tolerancia: 0,
    buscar: (env) => arcgisAchado("aerodromos", [{ pasta: PAMGIA, servico: /aer[oó]dromo|aeroporto/i }], env),
  },
  ana_pivos: {
    zCelula: 10, validadeDias: 90, tolerancia: 0.00005,
    buscar: (env) => arcgisAchado("ana_pivos", [{ pasta: SNIRH, servico: /piv/i }, { pasta: PAMGIA, servico: /piv/i }], env),
  },
  barragens: {
    zCelula: 9, validadeDias: 90, tolerancia: 0.0001,
    buscar: async (env) => {
      const listas = await Promise.allSettled([
        arcgisAchado("barragens", [{ pasta: SNIRH, servico: /barrag|snisb/i }, { pasta: PAMGIA, servico: /barrag/i }], env),
        usinasSigel(env, [{ servico: "Camadas", id: 8, tipo: "Reservatório" }]).then((fs) => fs.map((f) => ({
          ...f, properties: { id: f.properties.id, nome: f.properties.nome, detalhe: ["Reservatório (ANEEL)", f.properties.agente].filter(Boolean).join(" · "), area_ha: null },
        }))),
      ]);
      if (listas.every((l) => l.status === "rejected")) throw (listas[0] as PromiseRejectedResult).reason;
      return listas.flatMap((l) => (l.status === "fulfilled" ? l.value : []));
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
  const x0 = lon2x(env.xmin, def.zCelula), x1 = lon2x(env.xmax, def.zCelula);
  const y0 = lat2y(env.ymax, def.zCelula), y1 = lat2y(env.ymin, def.zCelula);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELULAS) throw new JanelaGrande();
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) celulas.push({ x, y });

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
