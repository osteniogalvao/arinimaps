import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { ufsDoEnvelope } from "./ufs";
// relativo (não "@/"): scripts/testa-apis-rurais.mjs carrega este arquivo pelo jiti, sem os aliases do Next
import { EsperaEsgotada, fila, inteiroDoAmbiente } from "../seguranca/fila";
import { getComCadeia } from "../geo/tlsOrgaos";
import { supabaseAdmin } from "../supabase/admin";
import { TEMAS_CAR, type TemaCar } from "../geo/temasCar";
import { buscarCenas, ndviDaArea, processamentoLigado, type EstatisticaNdvi } from "../sentinel/copernicus";

/**
 * Adaptadores das fontes oficiais de consulta rural.
 *
 * Cada fonte tem seu próprio contrato (ArcGIS, WFS, Overpass); o resto do
 * sistema só enxerga `ResultadoFonte`. Nenhum adaptador lança: fonte fora do
 * ar vira `erro` no relatório, com a data da tentativa — o documento técnico
 * exige rastrear origem e indisponibilidade.
 *
 * Endpoints sondados em 28/08/2026 e de novo em 07/10/2026 por
 * `scripts/sonda-fontes*.mjs`; a matriz completa está em `docs/FONTES.md`.
 * O que não está aqui não tem consulta pública por polígono e fica marcado no
 * banco como "depende de importação" — nunca como "nada encontrado".
 *
 * Origem (PENDENCIAS 3.15): todo resultado e todo item sai carimbado com
 * órgão, base, tipo (oficial/terceiro/derivado), data da consulta e — quando o
 * serviço expõe — data ou versão da base. O carimbo vai DENTRO de cada item
 * porque as rotas guardam só `resultado.itens`; assim a origem sobrevive ao
 * cache sem mudar nenhuma rota.
 */

const UA = "AriniImoveisBrasil/1.0 (contato@arinibrasil.com.br)";
/** teto de cada requisição */
const TIMEOUT = 20_000;
/** teto do adaptador inteiro, tentativas incluídas: o relatório não espera mais que isso */
const PRAZO = 40_000;

export type Bbox = { xmin: number; ymin: number; xmax: number; ymax: number; lng: number; lat: number };

/** oficial = órgão responsável; terceiro = base não governamental; derivado = cálculo do Arini; usuario = informado por quem cadastrou. */
export type TipoOrigem = "oficial" | "terceiro" | "derivado" | "usuario";

export type Origem = {
  orgao: string;
  base: string;
  tipo: TipoOrigem;
  /** ISO — quando o Arini perguntou ao serviço */
  consultado_em: string;
  /** ISO — última atualização da base, quando o serviço informa */
  atualizado_em?: string | null;
  /** versão declarada da base (ex.: "SNV 202607A") */
  versao?: string | null;
};

export type ItemEncontrado = {
  titulo: string;
  detalhe?: string;
  extra?: Record<string, string | number | null>;
  origem?: Origem;
};

export type ResultadoFonte = {
  fonte_id: string;
  quantidade: number;
  incide: boolean;
  itens: ItemEncontrado[];
  erro?: string;
  origem?: Origem;
};

/**
 * Limite de pedidos simultâneos POR ÓRGÃO (docs/INFRA-NACIONAL.md §5, item 1).
 *
 * Cada consulta de área dispara ~25 pedidos a ~12 servidores; com 25 consultas
 * ao mesmo tempo são centenas por minuto, e os serviços do governo caem ou
 * bloqueiam o IP. A chave é o HOST, não a fonte: PRODES, DETER, Queimadas, UCs
 * e Hidrografia são todos o geoserver do INPE, e SIGEF/SNCI o mesmo i3geo do
 * INCRA — o freio tem de valer para o servidor que de fato recebe a carga.
 *
 * Quem não ganha vaga em ESPERA_FONTE desiste e a fonte sai com `erro`
 * ("indisponível agora"), NUNCA como "nada encontrado": a regra do relatório é
 * que fonte não consultada não vale como ausência de restrição. Como o erro não
 * entra no cache válido, a próxima consulta pergunta de novo.
 */
const MAX_POR_ORGAO = inteiroDoAmbiente("ARINI_FONTES_MAX_SIMULTANEOS", 4);
const ESPERA_FONTE = inteiroDoAmbiente("ARINI_FONTES_ESPERA_MS", 25_000);

/**
 * Sinal de cancelamento do adaptador em andamento. Quando o PRAZO estoura o
 * relatório já desistiu da fonte; sem isto os pedidos dela continuariam na fila
 * do órgão (e as repetições, saindo) só para ninguém ler a resposta — carga
 * inútil justo no pico. Vai por contexto assíncrono para não ter de passar um
 * `signal` por todos os helpers.
 */
const contexto = new AsyncLocalStorage<AbortSignal>();

/** Um pedido HTTP dentro da vaga do órgão; o corpo é lido ainda com a vaga ocupada. */
async function pedir(url: string, opcoes: RequestInit, cancelado?: AbortSignal): Promise<Response> {
  const host = new URL(url).host;
  return fila(`orgao:${host}`, MAX_POR_ORGAO).executar({ esperaMs: ESPERA_FONTE, signal: cancelado }, async () => {
    // FUNAI: o servidor não manda o certificado intermediário e o fetch do
    // Node recusa (UNABLE_TO_VERIFY_LEAF_SIGNATURE) — ver ../geo/tlsOrgaos.ts
    if (host === "geoserver.funai.gov.br") {
      const r = await getComCadeia(url, { "User-Agent": UA, Accept: "application/json", ...(opcoes.headers as Record<string, string> ?? {}) }, TIMEOUT);
      return new Response(r.corpo, { status: r.status });
    }
    const tempo = AbortSignal.timeout(TIMEOUT);
    const r = await fetch(url, {
      ...opcoes,
      headers: { "User-Agent": UA, Accept: "application/json", ...(opcoes.headers ?? {}) },
      signal: cancelado ? AbortSignal.any([tempo, cancelado]) : tempo,
    });
    // baixar o corpo também é carga no órgão: só devolve a vaga depois dele
    const corpo = await r.arrayBuffer();
    return new Response(corpo, { status: r.status, statusText: r.statusText, headers: r.headers });
  });
}

/**
 * Uma chamada, com repetição.
 *
 * O geoserver do Programa Queimadas é um cluster e nem todo nó tem o
 * workspace: medido em 28/08, 3 de 8 chamadas idênticas voltam 404. Por isso
 * 404 é tratado como retentável junto com os 5xx — o que não existe mesmo
 * continua falhando depois das tentativas, e a fonte cai para `erro`.
 *
 * Fila do órgão cheia não repete: esperar de novo só alongaria o relatório.
 */
async function buscar(url: string, opcoes: RequestInit = {}, tentativas = 3) {
  const cancelado = contexto.getStore();
  let ultimo = "";
  for (let i = 0; i < tentativas; i++) {
    if (cancelado?.aborted) break;
    try {
      const r = await pedir(url, opcoes, cancelado);
      if (r.ok) return r;
      ultimo = `HTTP ${r.status}`;
      if (r.status !== 404 && r.status < 500) break; // 4xx real: insistir não ajuda
    } catch (e) {
      if (e instanceof EsperaEsgotada) {
        throw new Error(e.motivo === "cancelado"
          ? "consulta encerrada pelo prazo"
          : "muitas consultas a este órgão agora — indisponível no momento, tente de novo em instantes");
      }
      ultimo = msg(e);
    }
    if (i < tentativas - 1) await new Promise((ok) => setTimeout(ok, 400 * (i + 1)));
  }
  throw new Error(ultimo || "falha desconhecida");
}

type Props = Record<string, string | number | null>;

/** Junta a query string respeitando endpoints que já trazem `?` (i3geo: `ogc.php?tema=`). */
const juntar = (base: string, qs: string) => base + (base.includes("?") ? "&" : "?") + qs;

/** GetFeature WFS por envelope, já em GeoJSON. */
async function wfs(base: string, camada: string, bbox: Bbox, max = 50, extra = ""): Promise<Props[]> {
  // o nome da camada vai CRU: o geoserver do Programa Queimadas devolve 404
  // quando o ':' chega escapado como %3A.
  const url = juntar(base, `service=WFS&version=1.0.0&request=GetFeature&typeName=${camada}` +
    `&outputFormat=application/json&maxFeatures=${max}` +
    `&bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax},EPSG:4326${extra}`);
  const j = await (await buscar(url)).json();
  if (j.exceptions) throw new Error(String(j.exceptions[0]?.text ?? "erro do WFS"));
  return ((j.features ?? []) as { properties: Props }[]).map((f) => f.properties ?? {});
}

/**
 * Contagem real de feições no envelope (`resultType=hits`), sem baixar nada.
 *
 * Serve para não publicar o teto de `maxFeatures` como se fosse o total: no
 * imóvel de teste o teto de 500 escondia 1.048 focos.
 */
async function wfsTotal(base: string, camada: string, bbox: Bbox): Promise<number> {
  const url = juntar(base, `service=WFS&version=1.1.0&request=GetFeature&typeName=${camada}` +
    `&resultType=hits&bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax},EPSG:4326`);
  const xml = await (await buscar(url, { headers: { Accept: "application/xml" } })).text();
  const n = xml.match(/number(?:OfFeatures|Matched)="(\d+)"/)?.[1];
  if (!n) throw new Error("o serviço não devolveu a contagem");
  return Number(n);
}

const geometriaEsri = (bbox: Bbox) => encodeURIComponent(JSON.stringify({
  xmin: bbox.xmin, ymin: bbox.ymin, xmax: bbox.xmax, ymax: bbox.ymax,
  spatialReference: { wkid: 4326 },
}));
const filtroEsri = (bbox: Bbox) =>
  `geometry=${geometriaEsri(bbox)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`;

/** query ArcGIS REST por envelope. */
// max = null para servidores que recusam paginação (o SIGMINE responde
// "Pagination is not supported" e zera a consulta inteira).
async function arcgis(base: string, camada: string | number, bbox: Bbox, campos = "*", max: number | null = 50): Promise<Props[]> {
  const url = `${base}/${camada}/query?f=json&${filtroEsri(bbox)}&outFields=${encodeURIComponent(campos)}` +
    "&returnGeometry=false" + (max === null ? "" : `&resultRecordCount=${max}`);
  const j = await (await buscar(url)).json();
  if (j.error) throw new Error(j.error.message ?? "erro do serviço");
  return ((j.features ?? []) as { attributes: Props }[]).map((f) => f.attributes ?? {});
}

/** Total no envelope (`returnCountOnly`) — o teto de registros não vira número. */
async function arcgisTotal(base: string, camada: string | number, bbox: Bbox): Promise<number> {
  const j = await (await buscar(`${base}/${camada}/query?f=json&${filtroEsri(bbox)}&returnCountOnly=true`)).json();
  if (j.error || typeof j.count !== "number") throw new Error(j.error?.message ?? "o serviço não devolveu a contagem");
  return j.count;
}

/**
 * Maior valor de um campo de data na camada inteira (outStatistics) — é a
 * "data de atualização da base" quando o órgão grava a data de alteração em
 * cada registro. Guardado por 6 h: a pergunta varre a camada toda.
 */
const memoriaAtualizacao = new Map<string, { em: number; valor: string | null }>();
async function arcgisUltimaData(base: string, camada: string | number, campo: string): Promise<string | null> {
  const chave = `${base}/${camada}/${campo}`;
  const guardado = memoriaAtualizacao.get(chave);
  if (guardado && Date.now() - guardado.em < 6 * 3600_000) return guardado.valor;
  try {
    const est = encodeURIComponent(JSON.stringify([{ statisticType: "max", onStatisticField: campo, outStatisticFieldName: "m" }]));
    const j = await (await buscar(`${base}/${camada}/query?f=json&where=1%3D1&outStatistics=${est}`, {}, 1)).json();
    const v = j.features?.[0]?.attributes?.m;
    const valor = typeof v === "number" ? new Date(v).toISOString() : null;
    memoriaAtualizacao.set(chave, { em: Date.now(), valor });
    return valor;
  } catch {
    return null; // a data é complemento: nunca derruba a consulta
  }
}

/**
 * i3geo do INCRA (MapServer). Só fala GML, um tema por UF, e o `bbox` vai SEM
 * o sufixo EPSG — com ele o WFS 1.1.0 inverte os eixos e devolve zero (medido
 * em 07/10/2026: 135 sem sufixo, 0 com).
 */
const I3GEO = "https://acervofundiario.incra.gov.br/i3geo/ogc.php";

async function i3geoTotal(tema: string, bbox: Bbox): Promise<number> {
  const url = `${I3GEO}?tema=${tema}&service=WFS&version=1.1.0&request=GetFeature&typeName=${tema}` +
    `&resultType=hits&bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
  const xml = await (await buscar(url, { headers: { Accept: "application/xml" } })).text();
  const n = xml.match(/numberOfFeatures="(\d+)"/)?.[1];
  if (!n) throw new Error(xml.includes("ServiceException") ? "o INCRA recusou a consulta" : "o serviço não devolveu a contagem");
  return Number(n);
}

async function i3geo(tema: string, bbox: Bbox, campos: string[], max = 40): Promise<Props[]> {
  const url = `${I3GEO}?tema=${tema}&service=WFS&version=1.0.0&request=GetFeature&typeName=${tema}` +
    `&maxFeatures=${max}&propertyName=${campos.join(",")}&bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
  const xml = await (await buscar(url, { headers: { Accept: "application/xml" } })).text();
  if (xml.includes("ServiceException")) throw new Error("o INCRA recusou a consulta");
  return xml.split(`<ms:${tema}>`).slice(1).map((bloco) => {
    const p: Props = {};
    for (const m of bloco.matchAll(/<ms:([A-Za-z0-9_]+)>([^<]*)<\/ms:\1>/g)) p[m[1]] = desescapar(m[2]);
    return p;
  });
}

const desescapar = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const texto = (v: unknown, padrao = "") => (v === null || v === undefined || v === "" ? padrao : String(v).trim());
const numero = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
/** data do serviço (epoch ArcGIS, ISO ou "dd/mm/aaaa") em dd/mm/aaaa */
const dataBr = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return new Date(v).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const s = String(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : s;
};

// ---------------------------------------------------------------------------
// Proveniência
// ---------------------------------------------------------------------------

/** Órgão, base e tipo de cada fonte — o que o relatório mostra ao lado de cada bloco. */
export const ORIGENS: Record<string, { orgao: string; base: string; tipo: TipoOrigem }> = {
  car: { orgao: "Serviço Florestal Brasileiro", base: "SICAR — Cadastro Ambiental Rural", tipo: "oficial" },
  car_ambiental: { orgao: "Serviço Florestal Brasileiro", base: "SICAR — camadas ambientais (arquivo importado)", tipo: "oficial" },
  ibge_biomas: { orgao: "IBGE", base: "Biomas do Brasil 1:250.000 (limite oficial)", tipo: "oficial" },
  sentinel: { orgao: "Copernicus (ESA/UE) — cálculo da Arini", base: "Sentinel-2 L2A · NDVI", tipo: "derivado" },
  sigef: { orgao: "INCRA", base: "SIGEF — parcelas certificadas", tipo: "oficial" },
  snci: { orgao: "INCRA", base: "SNCI — imóveis certificados (até 2013)", tipo: "oficial" },
  ibama_embargos: { orgao: "IBAMA", base: "SISCOM — áreas embargadas", tipo: "oficial" },
  anm: { orgao: "ANM", base: "SIGMINE — processos minerários ativos", tipo: "oficial" },
  funai: { orgao: "FUNAI", base: "Terras indígenas (poligonais)", tipo: "oficial" },
  prodes_cerrado: { orgao: "INPE", base: "PRODES Cerrado", tipo: "oficial" },
  deter_cerrado: { orgao: "INPE", base: "DETER Cerrado", tipo: "oficial" },
  inpe_queimadas: { orgao: "INPE", base: "Programa Queimadas — focos de calor", tipo: "oficial" },
  ucs: { orgao: "MMA/CNUC (compilado pelo INPE)", base: "Unidades de conservação do Cerrado", tipo: "oficial" },
  hidrografia: { orgao: "INPE", base: "Hidrografia do Cerrado (Sentinel-2)", tipo: "oficial" },
  ana: { orgao: "ANA", base: "SNIRH — cursos d'água", tipo: "oficial" },
  aneel: { orgao: "ANEEL", base: "SIGEL — geração e transmissão (base ONS)", tipo: "oficial" },
  quilombolas: { orgao: "INCRA (republicado pelo IBAMA)", base: "Territórios quilombolas", tipo: "oficial" },
  iphan: { orgao: "IPHAN", base: "SICG — bens e sítios arqueológicos", tipo: "oficial" },
  dnit: { orgao: "DNIT", base: "SNV (federais) e CIDE (estaduais)", tipo: "oficial" },
};

type Retorno = {
  quantidade: number;
  itens: ItemEncontrado[];
  incide?: boolean;
  atualizado_em?: string | null;
  versao?: string | null;
};

/** Embrulha o adaptador: erro vira campo, nunca exceção; prazo rígido; origem carimbada. */
async function adaptador(fonte_id: string, fn: () => Promise<Retorno>): Promise<ResultadoFonte> {
  const consultado_em = new Date().toISOString();
  const meta = ORIGENS[fonte_id] ?? { orgao: fonte_id, base: fonte_id, tipo: "oficial" as const };
  let estourou: ReturnType<typeof setTimeout> | undefined;
  const cancelar = new AbortController();
  try {
    const r = await Promise.race([
      contexto.run(cancelar.signal, fn),
      new Promise<never>((_, falhou) => {
        estourou = setTimeout(() => falhou(new Error(`serviço não respondeu em ${PRAZO / 1000} s`)), PRAZO);
      }),
    ]);
    const origem: Origem = { ...meta, consultado_em, atualizado_em: r.atualizado_em ?? null, versao: r.versao ?? null };
    return {
      fonte_id, quantidade: r.quantidade, incide: r.incide ?? r.quantidade > 0,
      itens: r.itens.map((i) => ({ ...i, origem: i.origem ?? origem })),
      origem,
    };
  } catch (e) {
    return { fonte_id, quantidade: 0, incide: false, itens: [], erro: msg(e), origem: { ...meta, consultado_em } };
  } finally {
    clearTimeout(estourou);
    // desistiu (prazo) ou terminou: o que ainda estiver na fila do órgão sai dela
    cancelar.abort();
  }
}

// ---------------------------------------------------------------------------
// Fundiário / mineral
// ---------------------------------------------------------------------------

/** ANM/SIGMINE — processos minerários ativos. Não aceita paginação. */
export function consultarAnm(bbox: Bbox) {
  return adaptador("anm", async () => {
    const base = "https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer";
    const [total, linhas] = await Promise.all([
      arcgisTotal(base, 0, bbox),
      arcgis(base, 0, bbox, "PROCESSO,FASE,NOME,SUBS,USO,AREA_HA,ULT_EVENTO", null),
    ]);
    return {
      quantidade: Math.max(total, linhas.length),
      versao: "atualização diária declarada pela ANM",
      itens: linhas.slice(0, 40).map((p) => ({
        titulo: `${texto(p.SUBS, "substância não informada")} — ${texto(p.FASE, "fase não informada")}`,
        detalhe: texto(p.NOME),
        extra: {
          processo: texto(p.PROCESSO),
          uso: texto(p.USO),
          area_ha: numero(p.AREA_HA),
          ultimo_evento: texto(p.ULT_EVENTO),
        },
      })),
    };
  });
}

/**
 * CAR / SICAR — imóveis rurais declarados no raio da consulta.
 *
 * Em 28/08/2026 o WFS publicava zero camadas; em 24/09 passou a publicar
 * `sicar_imoveis_<uf>`. O Pontal faz divisa com SP, GO e MS pelos rios, e o
 * raio de uma fazenda na beira do Paranaíba atravessa — por isso consulta as
 * UFs cujo envelope encosta no da consulta (`ufsDoEnvelope`). O total vem de
 * `hits`: teto de amostra não vira número.
 *
 * As camadas AMBIENTAIS do CAR (APP, reserva legal, vegetação nativa, área
 * consolidada) não estão no WFS — só na base de downloads, com reCAPTCHA
 * (sondado em 07/10/2026). Entram por importação manual: `consultarCarAmbiental`.
 */
export function consultarCar(bbox: Bbox) {
  return adaptador("car", async () => {
    const base = "https://geoserver.car.gov.br/geoserver/sicar/ows";
    const porUf = await Promise.all(ufsDoEnvelope(bbox).map(async (uf) => {
      const camada = `sicar:sicar_imoveis_${uf}`;
      const [total, linhas] = await Promise.all([wfsTotal(base, camada, bbox), wfs(base, camada, bbox, 40)]);
      return { total, linhas };
    }));
    const linhas = porUf.flatMap((u) => u.linhas);
    return {
      quantidade: porUf.reduce((s, u) => s + u.total, 0),
      itens: linhas.slice(0, 40).map((p) => ({
        titulo: `${texto(p.municipio, "Município não informado")} — ${numero(p.area).toLocaleString("pt-BR")} ha`,
        detalhe: texto(p.condicao, "situação não informada"),
        extra: {
          codigo: texto(p.cod_imovel),
          tipo: texto(p.tipo_imovel),
          modulos_fiscais: numero(p.m_fiscal),
          atualizado_no_sicar: dataBr(p.dat_atualizacao),
        },
      })),
    };
  });
}

/**
 * CAR — camadas ambientais importadas à mão (migration 0050, Central › CAR:
 * importação e cobertura). Não pergunta ao SICAR: lê `car_temas` no banco.
 *
 * Só fala do que foi importado. Se nenhum município da área tem arquivo, a
 * fonte sai com `erro` ("ainda não importado") — regra do relatório: fonte
 * sem dado não vale como "nada encontrado". Cobertura parcial vira um item de
 * aviso com a porcentagem coberta.
 */
export function consultarCarAmbiental(bbox: Bbox) {
  return adaptador("car_ambiental", async () => {
    const { data, error } = await supabaseAdmin().rpc("fn_car_ambiental_envelope", {
      p_xmin: bbox.xmin, p_ymin: bbox.ymin, p_xmax: bbox.xmax, p_ymax: bbox.ymax,
    });
    if (error) throw new Error(error.message);
    const r = data as {
      cobertura_pct: number | null;
      municipios: { municipio: string; uf: string; data_base: string; temas: string[] }[];
      temas: { tema: string; poligonos: number; imoveis: number; area_ha: number }[];
    };
    if (!r.municipios.length) {
      throw new Error("camadas ambientais do CAR ainda não importadas para os municípios desta área");
    }
    const bases = r.municipios.map((m) => m.data_base).sort();
    const pct = Number(r.cobertura_pct ?? 0);
    const itens: ItemEncontrado[] = r.temas
      .filter((t) => t.tema !== "area_imovel")
      .map((t) => ({
        titulo: `${TEMAS_CAR[t.tema as TemaCar] ?? t.tema} — ${Number(t.area_ha).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha`,
        detalhe: `${t.poligonos.toLocaleString("pt-BR")} polígono(s) declarado(s) por ${t.imoveis.toLocaleString("pt-BR")} imóvel(is) na área consultada`,
        extra: { tema: t.tema, area_ha: Number(t.area_ha), poligonos: t.poligonos, imoveis: t.imoveis },
      }));
    if (pct < 99) {
      itens.push({
        titulo: `Cobertura parcial: ${pct.toLocaleString("pt-BR")}% da área está em município já importado`,
        detalhe: `Importados: ${r.municipios.map((m) => `${m.municipio}/${m.uf}`).join(", ")}. O restante da área ainda não tem as camadas ambientais no sistema.`,
      });
    }
    return {
      quantidade: itens.filter((i) => i.extra?.tema).length,
      incide: itens.some((i) => i.extra?.tema),
      atualizado_em: bases.length ? `${bases[0]}T12:00:00-03:00` : null,
      versao: r.municipios.map((m) => `${m.municipio}: base de ${new Date(`${m.data_base}T12:00:00`).toLocaleDateString("pt-BR")}`).join(" · "),
      itens,
    };
  });
}

/**
 * IBGE — bioma oficial da área (limite 1:250.000, migration 0051). Lê o banco
 * (`ibge_biomas_partes`, carregado por scripts/ibge-importa.mjs): o WFS do IBGE
 * devolve o bioma inteiro para qualquer envelope, pesado demais para a hora da
 * consulta. Área na divisa entre biomas sai com a porcentagem de cada um — o
 * que muda a regra de reserva legal e de supressão de vegetação.
 */
export function consultarBiomas(bbox: Bbox) {
  return adaptador("ibge_biomas", async () => {
    const { data, error } = await supabaseAdmin().rpc("fn_biomas_envelope", {
      p_xmin: bbox.xmin, p_ymin: bbox.ymin, p_xmax: bbox.xmax, p_ymax: bbox.ymax,
    });
    if (error) throw new Error(error.message);
    const r = data as { total_ha: number; biomas: { bioma: string; area_ha: number; pct: number }[]; importado_em: string | null };
    if (!r.importado_em) throw new Error("limites dos biomas ainda não importados (scripts/ibge-importa.mjs)");
    return {
      quantidade: r.biomas.length,
      // bioma não é restrição: é contexto — não acende o alerta de "incide"
      incide: false,
      // a data que temos é a da cópia para o banco, não a da edição do IBGE
      versao: `IBGE 1:250.000 · copiado em ${new Date(r.importado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      itens: r.biomas.map((b) => ({
        titulo: r.biomas.length === 1 ? b.bioma : `${b.bioma} — ${Number(b.pct).toLocaleString("pt-BR")}% da área`,
        detalhe: `${Number(b.area_ha).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ha na área consultada (com o raio)`,
        extra: { bioma: b.bioma, pct: Number(b.pct), area_ha: Number(b.area_ha) },
      })),
    };
  });
}

/**
 * Vegetação pelo NDVI do Sentinel-2 (Copernicus Data Space, migration 0052).
 *
 * Acha no catálogo as passagens dos últimos 120 dias e mede o NDVI na que
 * tiver menos nuvem DENTRO da área (a nuvem do catálogo é da quadrícula de
 * ~110 km, então tenta até 3 cenas). Depois a mesma época do ano anterior,
 * para mostrar se a área ganhou ou perdeu vegetação — com a ressalva de que
 * pasto e lavoura mudam com a estação e a safra.
 */
const fmtNdvi = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dataBrIso = (d: string) => d.split("-").reverse().join("/");

async function melhorNdvi(b4: [number, number, number, number], de: string, ate: string): Promise<EstatisticaNdvi | null> {
  const cenas = (await buscarCenas(b4, { de, ate, nuvemMax: 60, limite: 60 }))
    .sort((a, b) => a.nuvem - b.nuvem || b.data.localeCompare(a.data)).slice(0, 3);
  let melhor: EstatisticaNdvi | null = null;
  for (const c of cenas) {
    const e = await ndviDaArea(b4, c.data).catch(() => null);
    if (e && (!melhor || e.nuvemPct < melhor.nuvemPct)) melhor = e;
    if (melhor && melhor.nuvemPct < 10) break;
  }
  return melhor;
}

export function consultarNdvi(bbox: Bbox) {
  return adaptador("sentinel", async () => {
    const b4: [number, number, number, number] = [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax];
    const agora = Date.now();
    const atual = await melhorNdvi(b4, dataIso(agora - 120 * 86_400_000), dataIso(agora));
    if (!atual) throw new Error("nenhuma passagem do Sentinel-2 sem nuvem sobre a área nos últimos 120 dias");
    const t = new Date(`${atual.data}T12:00:00Z`).getTime();
    const anterior = await melhorNdvi(b4, dataIso(t - 410 * 86_400_000), dataIso(t - 320 * 86_400_000)).catch(() => null);
    const principal = [...atual.faixas].sort((a, b) => b.pct - a.pct)[0];
    const itens: ItemEncontrado[] = [{
      titulo: `NDVI médio ${fmtNdvi(atual.media)} — ${principal.nome} em ${principal.pct}% da área`,
      detalhe: `Passagem de ${dataBrIso(atual.data)}. ${atual.faixas.filter((f) => f.pct > 0).map((f) => `${f.nome} ${f.pct}%`).join(", ")}`
        + (atual.nuvemPct >= 1 ? `. ${atual.nuvemPct.toLocaleString("pt-BR")}% da área sem leitura (nuvem ou sombra).` : "."),
      extra: { ndvi_medio: atual.media, data_cena: atual.data, sem_leitura_pct: atual.nuvemPct },
    }];
    if (anterior) {
      const dif = Math.round((atual.media - anterior.media) * 100) / 100;
      itens.push({
        titulo: `Um ano antes: NDVI médio ${fmtNdvi(anterior.media)} (${dataBrIso(anterior.data)})`,
        detalhe: `${dif === 0 ? "Sem mudança" : dif > 0 ? `Subiu ${fmtNdvi(dif)}` : `Caiu ${fmtNdvi(-dif)}`} em relação à passagem atual. `
          + "Pasto e lavoura variam com a estação e a safra: diferença pequena não indica desmatamento.",
        extra: { ndvi_medio: anterior.media, data_cena: anterior.data, diferenca: dif },
      });
    }
    return { quantidade: 1, incide: false, atualizado_em: `${atual.data}T12:00:00Z`, versao: "Sentinel-2 L2A", itens };
  });
}

/**
 * Parcelas certificadas no i3geo do INCRA: um tema por UF e por natureza
 * (particular/pública). O espelho do IBAMA da mesma base está parado em
 * abr/2022 — por isso vai direto ao INCRA, que tem registro de set/2026.
 */
async function temasIncra(prefixos: string[], bbox: Bbox, campos: string[]) {
  const temas = ufsDoEnvelope(bbox).flatMap((uf) => prefixos.map((p) => `${p}_${uf}`));
  const porTema = await Promise.all(temas.map(async (tema) => {
    const total = await i3geoTotal(tema, bbox);
    const linhas = total ? await i3geo(tema, bbox, campos, 40) : [];
    return { tema, total, linhas };
  }));
  return {
    total: porTema.reduce((s, t) => s + t.total, 0),
    linhas: porTema.flatMap((t) => t.linhas.map((l): Props => ({ ...l, _publico: t.tema.includes("publico") ? 1 : 0 }))),
  };
}

/** Parcela do SIGEF com a divisa, para cruzar com um imóvel (matrícula). */
export type ParcelaSigef = {
  matricula: string; nome: string; codigoIncra: string; parcela: string; situacao: string;
  publico: boolean; geometria: GeoJSON.MultiPolygon;
};

/** "x,y x,y …" do GML 2 → anel [[x, y], …]. */
const anelGml = (t: string): [number, number][] =>
  t.trim().split(/\s+/).map((par) => par.split(",").map(Number) as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

/**
 * INCRA/SIGEF com a geometria de cada parcela (GML 2 do i3geo, que não fala
 * GeoJSON). Usado para achar a matrícula do imóvel clicado: o SIGEF traz
 * `registro_matricula` em toda parcela certificada (344 de 344 na amostra do
 * piloto, 20/10/2026). Só na janela pedida, até `max` parcelas por tema.
 */
export async function parcelasSigefComGeometria(bbox: Bbox, max = 80): Promise<ParcelaSigef[]> {
  const temas = ufsDoEnvelope(bbox).flatMap((uf) => ["certificada_sigef_particular", "certificada_sigef_publico"].map((p) => `${p}_${uf}`));
  const porTema = await Promise.all(temas.map(async (tema) => {
    const url = `${I3GEO}?tema=${tema}&service=WFS&version=1.0.0&request=GetFeature&typeName=${tema}` +
      `&maxFeatures=${max}&bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
    return lerParcelasGml(await (await buscar(url, { headers: { Accept: "application/xml" } })).text(), tema);
  }));
  return porTema.flat();
}

/** GML 2 do i3geo → parcelas do SIGEF com a divisa. */
function lerParcelasGml(xml: string, tema: string): ParcelaSigef[] {
  if (xml.includes("ServiceException")) throw new Error("o INCRA recusou a consulta");
  return xml.split(`<ms:${tema}>`).slice(1).map((bloco): ParcelaSigef | null => {
    const p: Props = {};
    for (const m of bloco.matchAll(/<ms:([A-Za-z0-9_]+)>([^<]*)<\/ms:\1>/g)) p[m[1]] = desescapar(m[2]);
    const poligonos = [...bloco.matchAll(/<gml:Polygon[^>]*>([\s\S]*?)<\/gml:Polygon>/g)].map(([, corpo]) => {
      const externo = corpo.match(/<gml:outerBoundaryIs>[\s\S]*?<gml:coordinates[^>]*>([^<]+)<\/gml:coordinates>/)?.[1];
      const internos = [...corpo.matchAll(/<gml:innerBoundaryIs>[\s\S]*?<gml:coordinates[^>]*>([^<]+)<\/gml:coordinates>/g)].map((m) => anelGml(m[1]));
      return externo ? [anelGml(externo), ...internos] : null;
    }).filter((x): x is [number, number][][] => !!x && x[0].length >= 4);
    if (!poligonos.length) return null;
    return {
      matricula: texto(p.registro_matricula), nome: texto(p.nome_area, "Parcela sem denominação"),
      codigoIncra: texto(p.codigo_imovel), parcela: texto(p.parcela_codigo), situacao: texto(p.status),
      publico: tema.includes("publico"), geometria: { type: "MultiPolygon", coordinates: poligonos },
    };
  }).filter((x): x is ParcelaSigef => !!x);
}

/** Campos do SIGEF que a busca do mapa aceita (ideia do Geomart, 11/11/2026). */
export type CampoBuscaSigef = "parcela_codigo" | "codigo_imovel" | "registro_matricula";

/**
 * Parcelas do SIGEF por código, nas UFs dadas: código da parcela (UUID da
 * certificação), código do imóvel no INCRA (SNCR, o número do CCIR) ou número
 * da matrícula. O i3geo publica um tema por UF, então a busca vai às UFs da
 * tela do mapa, não ao Brasil inteiro (54 temas por busca seria abuso do
 * serviço do INCRA). Filtro OGC do WFS 1.0.0 (MapServer); cada valor vai em
 * mais de uma grafia (com e sem pontuação), porque a base mistura as duas.
 */
export async function parcelasSigefPorCodigo(campo: CampoBuscaSigef, valores: string[], ufs: string[], max = 10): Promise<ParcelaSigef[]> {
  const literal = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const iguais = [...new Set(valores)].map((v) =>
    `<PropertyIsEqualTo><PropertyName>${campo}</PropertyName><Literal>${literal(v)}</Literal></PropertyIsEqualTo>`).join("");
  const filtro = `<Filter>${valores.length > 1 ? `<Or>${iguais}</Or>` : iguais}</Filter>`;
  const temas = ufs.flatMap((uf) => ["certificada_sigef_particular", "certificada_sigef_publico"].map((p) => `${p}_${uf}`));
  const porTema = await Promise.allSettled(temas.map(async (tema) => {
    const url = `${I3GEO}?tema=${tema}&service=WFS&version=1.0.0&request=GetFeature&typeName=${tema}` +
      `&maxFeatures=${max}&FILTER=${encodeURIComponent(filtro)}`;
    return lerParcelasGml(await (await buscar(url, { headers: { Accept: "application/xml" } })).text(), tema);
  }));
  const ok = porTema.filter((r): r is PromiseFulfilledResult<ParcelaSigef[]> => r.status === "fulfilled");
  if (!ok.length && porTema.length) throw new Error("o INCRA não respondeu");
  return ok.flatMap((r) => r.value).slice(0, max);
}

/** INCRA/SIGEF — parcelas georreferenciadas e certificadas. */
export function consultarSigef(bbox: Bbox) {
  return adaptador("sigef", async () => {
    const { total, linhas } = await temasIncra(
      ["certificada_sigef_particular", "certificada_sigef_publico"], bbox,
      ["nome_area", "status", "codigo_imovel", "data_aprovacao", "registro_matricula", "codigo_municipio", "parcela_codigo"],
    );
    // a parcela aprovada mais recentemente mostra até onde a base está em dia
    // (entre as baixadas: até 40 por tema, então "pelo menos até")
    const maisRecente = linhas.map((p) => texto(p.data_aprovacao)).filter(Boolean).sort().pop();
    const ordenadas = [...linhas].sort((a, b) => texto(b.data_aprovacao).localeCompare(texto(a.data_aprovacao)));
    return {
      quantidade: total,
      versao: maisRecente ? `base com certificações até pelo menos ${dataBr(maisRecente)}` : null,
      itens: ordenadas.slice(0, 40).map((p) => ({
        titulo: texto(p.nome_area, "Parcela sem denominação"),
        detalhe: [texto(p.status), p._publico ? "imóvel público" : "imóvel particular",
          p.data_aprovacao ? `certificada em ${dataBr(p.data_aprovacao)}` : ""].filter(Boolean).join(" · "),
        extra: {
          codigo_incra: texto(p.codigo_imovel),
          matricula: texto(p.registro_matricula),
          municipio_ibge: texto(p.codigo_municipio),
          parcela: texto(p.parcela_codigo),
        },
      })),
    };
  });
}

/** INCRA/SNCI — certificações anteriores ao SIGEF (Lei 10.267, até 2013). */
export function consultarSnci(bbox: Bbox) {
  return adaptador("snci", async () => {
    const { total, linhas } = await temasIncra(
      ["imoveiscertificados_privado", "imoveiscertificados_publico"], bbox,
      ["nome_imovel", "num_certificacao", "data_certificacao", "cod_imovel_rural", "qtd_area_peca_tecnica", "num_processo"],
    );
    return {
      quantidade: total,
      versao: "base histórica (certificações até 2013)",
      itens: linhas.slice(0, 40).map((p) => ({
        titulo: texto(p.nome_imovel, "Imóvel sem denominação"),
        detalhe: [
          numero(p.qtd_area_peca_tecnica) ? `${numero(p.qtd_area_peca_tecnica).toLocaleString("pt-BR")} ha` : "",
          p.data_certificacao ? `certificado em ${dataBr(p.data_certificacao)}` : "",
          p._publico ? "imóvel público" : "",
        ].filter(Boolean).join(" · "),
        extra: {
          certificacao: texto(p.num_certificacao),
          codigo_incra: texto(p.cod_imovel_rural),
          processo: texto(p.num_processo),
        },
      })),
    };
  });
}

/** FUNAI — terras indígenas (poligonais). */
export function consultarFunai(bbox: Bbox) {
  return adaptador("funai", async () => {
    const linhas = await wfs("https://geoserver.funai.gov.br/geoserver/Funai/ows", "Funai:tis_poligonais", bbox, 20);
    return {
      quantidade: linhas.length,
      itens: linhas.map((p) => ({
        titulo: texto(p.terrai_nom ?? p.nome, "Terra indígena"),
        detalhe: texto(p.fase_ti ?? p.modalidade),
        extra: { etnia: texto(p.etnia_nome), uf: texto(p.uf_sigla) },
      })),
    };
  });
}

/**
 * Territórios quilombolas — base do INCRA republicada no ArcGIS do IBAMA.
 * O tema do INCRA no i3geo não é localizável (a lista de temas dá 504).
 */
export function consultarQuilombolas(bbox: Bbox) {
  return adaptador("quilombolas", async () => {
    const base = "https://pamgia.ibama.gov.br/server/rest/services/BasesSincronizadas/lim_quilombos_incra_a/MapServer";
    const [total, linhas] = await Promise.all([
      arcgisTotal(base, 0, bbox),
      arcgis(base, 0, bbox, "nm_comunid,nm_municip,cd_uf,fase,nr_familia,dt_publica,dt_decreto,dt_titulac,esfera,st_titulad", 30),
    ]);
    return {
      quantidade: total,
      itens: linhas.map((p) => ({
        titulo: texto(p.nm_comunid, "Comunidade quilombola"),
        detalhe: [texto(p.nm_municip), texto(p.fase) && `fase: ${texto(p.fase)}`,
          numero(p.nr_familia) ? `${numero(p.nr_familia)} famílias` : ""].filter(Boolean).join(" · "),
        extra: {
          esfera: texto(p.esfera),
          titulado: texto(p.st_titulad),
          publicacao: dataBr(p.dt_publica),
          decreto: dataBr(p.dt_decreto),
          titulacao: dataBr(p.dt_titulac),
        },
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Ambiental — embargos, desmatamento, alertas, fogo, unidades de conservação
// ---------------------------------------------------------------------------

/**
 * IBAMA — áreas embargadas (SISCOM, ArcGIS do IBAMA).
 *
 * O geoserver antigo do SISCOM sumiu (404 em 07/10/2026); a mesma base está no
 * ArcGIS do IBAMA, camada 3. O CPF/CNPJ do autuado é público no serviço mas
 * NÃO entra no relatório — o que interessa à negociação é a área e o motivo.
 */
export function consultarEmbargosIbama(bbox: Bbox) {
  return adaptador("ibama_embargos", async () => {
    const base = "https://pamgia.ibama.gov.br/server/rest/services/SISCOM/publico/MapServer";
    const [total, linhas, atualizado_em] = await Promise.all([
      arcgisTotal(base, 3, bbox),
      arcgis(base, 3, bbox,
        "num_tad,serie_tad,dat_embargo,municipio,uf,nome_imovel,des_localizacao,des_infracao,qtd_area_embargada,num_processo,unid_controle,sit_desmatamento", 40),
      arcgisUltimaData(base, 3, "dat_ult_alteracao"),
    ]);
    const ordenadas = [...linhas].sort((a, b) => numero(b.dat_embargo) - numero(a.dat_embargo));
    // há termos com o município digitado errado (medido: polígono em Iturama
    // com "Aracruz/ES" no termo). O polígono é o que vale; o aviso fica no item.
    const ufs = ufsDoEnvelope(bbox);
    return {
      quantidade: total,
      atualizado_em,
      itens: ordenadas.map((p) => ({
        titulo: `Embargo ${texto(p.num_tad)}${texto(p.serie_tad) ? `-${texto(p.serie_tad)}` : ""} — ${texto(p.municipio)}/${texto(p.uf)}`,
        detalhe: [
          p.dat_embargo ? `embargado em ${dataBr(p.dat_embargo)}` : "",
          numero(p.qtd_area_embargada) ? `${numero(p.qtd_area_embargada).toLocaleString("pt-BR")} ha embargados` : "",
          texto(p.des_infracao).slice(0, 160),
          texto(p.uf) && !ufs.includes(texto(p.uf).toLowerCase())
            ? "o município do termo não confere com a posição do polígono (erro de cadastro no IBAMA)" : "",
        ].filter(Boolean).join(" · "),
        extra: {
          imovel: texto(p.nome_imovel) || texto(p.des_localizacao).slice(0, 80),
          processo: texto(p.num_processo),
          unidade: texto(p.unid_controle),
          desmatamento: texto(p.sit_desmatamento) === "S" ? "sim" : texto(p.sit_desmatamento) === "N" ? "não" : "",
        },
      })),
    };
  });
}

/** INPE/TerraBrasilis — desmatamento PRODES no bioma Cerrado, agregado por ano. */
export function consultarProdes(bbox: Bbox) {
  return adaptador("prodes_cerrado", async () => {
    const base = "https://terrabrasilis.dpi.inpe.br/geoserver/ows";
    const camada = "prodes-cerrado-nb:yearly_deforestation";
    // o total vem de hits: o teto de maxFeatures não pode virar "o número de polígonos"
    const total = await wfsTotal(base, camada, bbox);
    const linhas = total ? await wfs(base, camada, bbox, 400) : [];
    const porAno = new Map<string, number>();
    for (const p of linhas) {
      const ano = texto(p.year ?? p.ano, "—");
      porAno.set(ano, (porAno.get(ano) ?? 0) + numero(p.area_km));
    }
    return {
      quantidade: total,
      itens: [...porAno.entries()].sort().map(([ano, km2]) => ({
        titulo: `Ano ${ano}`,
        detalhe: `${(km2 * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha de supressão registrada no entorno`,
      })),
    };
  });
}

/** INPE/DETER — alertas de alteração da cobertura vegetal (Cerrado). */
export function consultarDeter(bbox: Bbox) {
  return adaptador("deter_cerrado", async () => {
    const base = "https://terrabrasilis.dpi.inpe.br/geoserver/ows";
    const camada = "deter-cerrado-nb:deter_cerrado";
    const total = await wfsTotal(base, camada, bbox);
    const linhas = total ? await wfs(base, camada, bbox, 200) : [];
    // o alerta mais recente primeiro: é o que muda a conversa numa negociação
    const ordenadas = [...linhas].sort((a, b) => texto(b.view_date).localeCompare(texto(a.view_date)));
    return {
      quantidade: total,
      itens: ordenadas.slice(0, 20).map((p) => ({
        titulo: texto(p.classname, "Alerta DETER").replace(/_/g, " "),
        detalhe: `${numero(p.areatotalkm) * 100 > 0
          ? `${(numero(p.areatotalkm) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha · `
          : ""}detectado em ${texto(p.view_date, "data não informada")}`,
        extra: {
          satelite: texto(p.satellite),
          sensor: texto(p.sensor),
          area_ha: Number((numero(p.areatotalkm) * 100).toFixed(2)),
          data_deteccao: texto(p.view_date),
        },
      })),
    };
  });
}

/**
 * INPE Programa Queimadas — focos de calor.
 *
 * A camada `bdqueimadas:focos` é o histórico inteiro desde 1998, então:
 *  - o TOTAL vem de `resultType=hits`, não do que foi baixado (senão o teto de
 *    maxFeatures viraria "o número de focos", o que é falso);
 *  - o detalhamento baixa os mais recentes primeiro (`sortBy=data_hora_gmt D`),
 *    porque o que pesa numa negociação é fogo recente, não o de 1998;
 *  - se o histórico não coube na amostra, o relatório diz isso em vez de
 *    apresentar a quebra por ano como se fosse completa.
 */
const AMOSTRA_FOCOS = 2000;

export function consultarQueimadas(bbox: Bbox) {
  return adaptador("inpe_queimadas", async () => {
    const base = "https://data.inpe.br/queimadas/geoserver/ows";
    const camada = "bdqueimadas:focos";
    const total = await wfsTotal(base, camada, bbox);
    if (total === 0) return { quantidade: 0, itens: [] };

    const url = `${base}?service=WFS&version=1.0.0&request=GetFeature&typeName=${camada}` +
      `&outputFormat=application/json&maxFeatures=${AMOSTRA_FOCOS}&sortBy=data_hora_gmt+D` +
      `&bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax},EPSG:4326`;
    const j = await (await buscar(url)).json();
    const linhas = ((j.features ?? []) as { properties: Props }[]).map((f) => f.properties ?? {});

    const porAno = new Map<string, number>();
    let recentes = 0;
    const limite = new Date();
    limite.setFullYear(limite.getFullYear() - 1);
    for (const p of linhas) {
      const dh = texto(p.data_hora_gmt);
      porAno.set(dh.slice(0, 4) || "—", (porAno.get(dh.slice(0, 4) || "—") ?? 0) + 1);
      if (dh && new Date(dh) >= limite) recentes++;
    }
    const completo = linhas.length >= total;
    const itens: ItemEncontrado[] = [{
      titulo: `${recentes} foco(s) nos últimos 12 meses`,
      detalhe: `${total.toLocaleString("pt-BR")} foco(s) no histórico do INPE para o raio consultado` +
        (completo ? "" : ` · a quebra por ano abaixo cobre os ${linhas.length.toLocaleString("pt-BR")} mais recentes`),
    }];
    // 6 anos bastam para ler a tendência; a lista inteira afogava o relatório
    for (const [ano, n] of [...porAno.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)) {
      itens.push({ titulo: `Ano ${ano}`, detalhe: `${n} foco(s) de calor` });
    }
    return { quantidade: total, itens };
  });
}

/**
 * Unidades de conservação que incidem sobre o Cerrado.
 *
 * Vem da camada que o INPE publica no TerraBrasilis (compilada do CNUC/MMA):
 * o geoserviço do ICMBio e o do MMA não resolveram DNS na sondagem de 28/08.
 * A proveniência guardada é essa — não se apresenta como consulta ao CNUC.
 */
export function consultarUnidadesConservacao(bbox: Bbox) {
  return adaptador("ucs", async () => {
    const linhas = await wfs("https://terrabrasilis.dpi.inpe.br/geoserver/ows",
      "prodes-cerrado-nb:conservation_units_cerrado_biome", bbox, 20);
    return {
      quantidade: linhas.length,
      itens: linhas.map((p) => ({
        titulo: texto(p.nome, "Unidade de conservação"),
        detalhe: [texto(p.categoria), texto(p.esfera)].filter(Boolean).join(" · "),
        extra: {
          grupo: texto(p.grupo) === "PI" ? "Proteção Integral" : texto(p.grupo) === "US" ? "Uso Sustentável" : texto(p.grupo),
          ano_criacao: texto(p.ano_cria),
        },
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Patrimônio
// ---------------------------------------------------------------------------

/**
 * IPHAN/SICG — bens culturais e sítios arqueológicos.
 *
 * Os pontos (`tg_bem_classificacao`) cobrem todo bem cadastrado; os polígonos
 * (`bem_poligono`) pegam o sítio cujo ponto cai fora do raio mas a área entra.
 * `Bem_Protecao` diz se é tombamento, registro de sítio etc.
 */
export function consultarIphan(bbox: Bbox) {
  return adaptador("iphan", async () => {
    const base = "https://geoserver.iphan.gov.br/geoserver/ows";
    const [totalPontos, pontos, poligonos, protecoes] = await Promise.all([
      wfsTotal(base, "SICG:tg_bem_classificacao", bbox),
      wfs(base, "SICG:tg_bem_classificacao", bbox, 100),
      wfs(base, "SICG:bem_poligono", bbox, 100),
      wfs(base, "SICG:Bem_Protecao", bbox, 200).catch(() => [] as Props[]),
    ]);
    const protecao = new Map<string, string>();
    for (const p of protecoes) {
      const id = texto(p.id_bem);
      const tipo = texto(p.ds_tipo_protecao);
      if (id && tipo) protecao.set(id, [protecao.get(id), tipo].filter(Boolean).join(", "));
    }
    const porBem = new Map<string, Props>();
    for (const p of [...pontos, ...poligonos]) {
      const id = texto(p.id_bem);
      if (id && !porBem.has(id)) porBem.set(id, p);
    }
    const soPoligono = [...porBem.keys()].filter((id) => !pontos.some((p) => texto(p.id_bem) === id)).length;
    return {
      quantidade: totalPontos + soPoligono,
      itens: [...porBem.values()].slice(0, 40).map((p) => ({
        titulo: texto(p.identificacao_bem, "Bem cadastrado"),
        detalhe: [texto(p.ds_natureza), texto(p.ds_tipo_bem), texto(p.ds_classificacao)].filter(Boolean).join(" · "),
        extra: {
          codigo_iphan: texto(p.co_iphan),
          protecao: protecao.get(texto(p.id_bem)) ?? "",
          cadastrado_em: dataBr(p.dt_cadastro),
        },
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Hídrico, energia e logística
// ---------------------------------------------------------------------------

/** ANA/SNIRH — cursos d'água do entorno. */
export function consultarAna(bbox: Bbox) {
  return adaptador("ana", async () => {
    const linhas = await arcgis(
      "https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS/Curso_d%C3%81gua/MapServer",
      0, bbox, "*", 30,
    );
    // o serviço não padroniza o nome do campo; pega o primeiro que pareça nome
    // nomes medidos no serviço em 28/08: BHB_NM_NORIOCOMP é o nome composto
    const nomeDe = (p: Props) =>
      texto(p.BHB_NM_NORIOCOMP ?? p.BHB_CD_NORIO, "Curso d'água sem nome cadastrado");
    const nomes = new Map<string, number>();
    for (const p of linhas) nomes.set(nomeDe(p), (nomes.get(nomeDe(p)) ?? 0) + 1);
    return {
      quantidade: linhas.length,
      itens: [...nomes.entries()].slice(0, 20).map(([nome, n]) => ({
        titulo: nome,
        detalhe: n > 1 ? `${n} trecho(s) no raio consultado` : "1 trecho no raio consultado",
      })),
    };
  });
}

/** INPE/TerraBrasilis — corpos d'água e represas mapeados no Cerrado. */
export function consultarHidrografia(bbox: Bbox) {
  return adaptador("hidrografia", async () => {
    const base = "https://terrabrasilis.dpi.inpe.br/geoserver/ows";
    const camada = "prodes-cerrado-nb:hydrography";
    const total = await wfsTotal(base, camada, bbox);
    const linhas = total ? await wfs(base, camada, bbox, 400) : [];
    const porClasse = new Map<string, { n: number; km2: number }>();
    for (const p of linhas) {
      const c = texto(p.class_name ?? p.main_class, "corpo d'água");
      const at = porClasse.get(c) ?? { n: 0, km2: 0 };
      porClasse.set(c, { n: at.n + 1, km2: at.km2 + numero(p.area_km) });
    }
    return {
      quantidade: total,
      itens: [...porClasse.entries()].map(([classe, v]) => ({
        titulo: classe.charAt(0).toUpperCase() + classe.slice(1).replace(/_/g, " "),
        detalhe: `${v.n} feição(ões)${v.km2 > 0 ? ` · ${(v.km2 * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha` : ""}`,
      })),
    };
  });
}

/**
 * ANEEL/SIGEL — usinas, reservatórios, linhas de transmissão e subestações.
 *
 * Em 28/08 só achamos a camada de empreendimentos; em 07/10/2026 a pasta
 * PORTAL/Transmissão respondeu com as linhas (camada 1) e subestações
 * (camada 3) da base do ONS — 7 linhas na região de Iturama.
 */
const SIGEL = "https://sigel.aneel.gov.br/arcgis/rest/services/PORTAL";
const ANEEL_CAMADAS: { servico: string; id: number; rotulo: string }[] = [
  { servico: "Camadas", id: 0, rotulo: "Central geradora eólica" },
  { servico: "Camadas", id: 1, rotulo: "Usina hidrelétrica" },
  { servico: "Camadas", id: 2, rotulo: "Usina termelétrica" },
  { servico: "Camadas", id: 3, rotulo: "Pequena central hidrelétrica" },
  { servico: "Camadas", id: 5, rotulo: "Central geradora hidrelétrica" },
  { servico: "Camadas", id: 7, rotulo: "Usina fotovoltaica" },
  { servico: "Camadas", id: 8, rotulo: "Reservatório" },
  { servico: "Transmiss%C3%A3o", id: 1, rotulo: "Linha de transmissão" },
  { servico: "Transmiss%C3%A3o", id: 3, rotulo: "Subestação" },
];

export function consultarAneel(bbox: Bbox) {
  return adaptador("aneel", async () => {
    // uma camada fora do ar não pode zerar as outras — mas se TODAS falharem,
    // é a fonte que está fora, e o relatório tem de dizer isso
    const porCamada = await Promise.all(
      ANEEL_CAMADAS.map(async (c) => {
        try { return { ...c, ok: true, linhas: await arcgis(`${SIGEL}/${c.servico}/MapServer`, c.id, bbox, "*", 20) }; }
        catch { return { ...c, ok: false, linhas: [] as Props[] }; }
      }),
    );
    if (porCamada.every((c) => !c.ok)) throw new Error("nenhuma camada do SIGEL respondeu");
    const itens: ItemEncontrado[] = [];
    for (const c of porCamada) {
      for (const p of c.linhas.slice(0, 10)) {
        itens.push({
          titulo: `${c.rotulo} — ${texto(p.NOME ?? p.nome ?? p.NOME_EMPRE ?? p.DESCRICAO ?? p.Name, "sem nome")}`,
          detalhe: [texto(p.FASE ?? p.SITUACAO), texto(p.PROPRIETAR ?? p.PROPRIETARIO)].filter(Boolean).join(" · "),
          extra: { tipo: c.rotulo, potencia_kw: numero(p.POT_KW ?? p.POTENCIA) || null },
        });
      }
    }
    const falharam = porCamada.filter((c) => !c.ok).map((c) => c.rotulo);
    if (falharam.length) {
      itens.unshift({ titulo: "Camadas que não responderam", detalhe: falharam.join(", ") });
    }
    return { quantidade: porCamada.reduce((s, c) => s + c.linhas.length, 0), itens };
  });
}

/**
 * DNIT — rodovias federais (SNV) e estaduais (base CIDE, que inclui as do DER/MG).
 *
 * `vw_snv_rod` guarda TODAS as versões do SNV desde 2013 (548 trechos no
 * entorno de Iturama, a maioria vencida); o filtro `dt_fim` deixa só a versão
 * vigente. O DER/MG não publica serviço — as estaduais vêm daqui.
 */
const SUPERFICIE: Record<string, string> = {
  PAV: "pavimentada", DUP: "duplicada", EOD: "em obras de duplicação", EOP: "em obras de pavimentação",
  IMP: "implantada", EOI: "em obras de implantação", LEN: "leito natural", PLA: "planejada", TRV: "travessia",
};

export function consultarDnit(bbox: Bbox) {
  return adaptador("dnit", async () => {
    const base = "https://servicos.dnit.gov.br/dnitgeo/geoserver/ows";
    const hoje = new Date().toISOString().slice(0, 10);
    const cql = encodeURIComponent(`BBOX(geom,${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}) AND dt_fim > '${hoje}'`);
    const urlSnv = `${base}?service=WFS&version=1.0.0&request=GetFeature&typeName=vgeo:vw_snv_rod` +
      "&outputFormat=application/json&maxFeatures=300" +
      "&propertyName=Codigo_BR,Unidade_Federacao,Codigo_SNV,Superficie_Federal,Local_Inicio,Local_Fim,Extensao,Estadual_Coincidente,Versao_SNV" +
      `&CQL_FILTER=${cql}`;
    const [snvJ, cide] = await Promise.all([
      buscar(urlSnv).then((r) => r.json()),
      wfs(base, "vgeo:vw_cide_rod_2021", bbox, 300,
        "&propertyName=Codigo_Rodovia,Unidade_Federacao,Codigo_SRE,Superficie_Estadual,Local_Inicio,Local_Fim,Extensao,Jurisdicao"),
    ]);
    if (snvJ.exceptions) throw new Error(String(snvJ.exceptions[0]?.text ?? "erro do WFS"));
    const snv = ((snvJ.features ?? []) as { properties: Props }[]).map((f) => f.properties ?? {});

    type Rod = { nome: string; jurisdicao: string; km: number; trechos: number; superficies: Set<string> };
    const rodovias = new Map<string, Rod>();
    const somar = (nome: string, jurisdicao: string, km: number, sup: string) => {
      const r = rodovias.get(nome) ?? { nome, jurisdicao, km: 0, trechos: 0, superficies: new Set<string>() };
      r.km += km; r.trechos += 1;
      if (sup) r.superficies.add(SUPERFICIE[sup] ?? sup);
      rodovias.set(nome, r);
    };
    for (const p of snv) somar(`BR-${texto(p.Codigo_BR)}`, "federal", numero(p.Extensao), texto(p.Superficie_Federal));
    for (const p of cide) {
      somar(`${texto(p.Unidade_Federacao)}-${texto(p.Codigo_Rodovia)}`, texto(p.Jurisdicao, "estadual").toLowerCase(),
        numero(p.Extensao), texto(p.Superficie_Estadual));
    }
    const versoes = [...new Set(snv.map((p) => texto(p.Versao_SNV)).filter(Boolean))].sort();
    return {
      quantidade: rodovias.size,
      versao: [versoes.length ? `SNV ${versoes[versoes.length - 1]}` : "", "CIDE 2021"].filter(Boolean).join(" · "),
      itens: [...rodovias.values()]
        .sort((a, b) => (a.jurisdicao === b.jurisdicao ? a.nome.localeCompare(b.nome) : a.jurisdicao === "federal" ? -1 : 1))
        .map((r) => ({
          titulo: `${r.nome} · ${r.jurisdicao}`,
          detalhe: `${[...r.superficies].join(", ") || "superfície não informada"} · ${r.trechos} trecho(s) cadastrado(s) que tocam o raio`,
          extra: { extensao_dos_trechos_km: Number(r.km.toFixed(1)) },
        })),
    };
  });
}

/** Todas as fontes que consultam ao vivo, na ordem do relatório. */
export const ADAPTADORES: { id: string; fn: (b: Bbox) => Promise<ResultadoFonte> }[] = [
  { id: "car", fn: consultarCar },
  { id: "car_ambiental", fn: consultarCarAmbiental },
  { id: "ibge_biomas", fn: consultarBiomas },
  // sem a conta do Copernicus a fonte fica fora (consultaArea também a esconde da lista)
  ...(processamentoLigado() ? [{ id: "sentinel", fn: consultarNdvi }] : []),
  { id: "sigef", fn: consultarSigef },
  { id: "snci", fn: consultarSnci },
  { id: "ibama_embargos", fn: consultarEmbargosIbama },
  { id: "anm", fn: consultarAnm },
  { id: "funai", fn: consultarFunai },
  { id: "quilombolas", fn: consultarQuilombolas },
  { id: "prodes_cerrado", fn: consultarProdes },
  { id: "deter_cerrado", fn: consultarDeter },
  { id: "inpe_queimadas", fn: consultarQueimadas },
  { id: "ucs", fn: consultarUnidadesConservacao },
  { id: "iphan", fn: consultarIphan },
  { id: "hidrografia", fn: consultarHidrografia },
  { id: "ana", fn: consultarAna },
  { id: "aneel", fn: consultarAneel },
  { id: "dnit", fn: consultarDnit },
];

const msg = (e: unknown) =>
  e instanceof Error ? (e.name === "TimeoutError" ? "serviço não respondeu a tempo" : e.message) : "falha desconhecida";

/**
 * Consulta as fontes com uma SEGUNDA RODADA para as que falharam.
 *
 * Vídeo do Carlos (10/11/2026): numa consulta, UCs, terras indígenas, poços,
 * mineração, PRODES, DETER e imóvel certificado vieram "indisponível". Os
 * serviços do governo caem por minutos e voltam; cada adaptador já repete o
 * pedido 3 vezes em sequência, o que não cobre uma queda de 20–30 s. Aqui as
 * que falharam são perguntadas de novo depois de uma pausa, todas juntas, uma
 * vez só — o custo para o órgão é o de uma consulta, e só das que falharam.
 * Fila do órgão cheia não repete (repetir só piora o pico).
 */
const PAUSA_SEGUNDA_RODADA_MS = 6_000;

export async function consultarFontes(
  lista: { id: string; fn: (b: Bbox) => Promise<ResultadoFonte> }[],
  bbox: Bbox,
  opcoes: { segundaRodada?: boolean } = {},
): Promise<ResultadoFonte[]> {
  const primeira = await Promise.all(lista.map((a) => a.fn(bbox)));
  if (opcoes.segundaRodada === false) return primeira;
  const repetir = primeira
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.erro && !/muitas consultas a este órgão/.test(r.erro));
  if (!repetir.length) return primeira;
  await new Promise((ok) => setTimeout(ok, PAUSA_SEGUNDA_RODADA_MS));
  const segunda = await Promise.all(repetir.map(({ i }) => lista[i].fn(bbox)));
  const final = [...primeira];
  repetir.forEach(({ i }, k) => { if (!segunda[k].erro) final[i] = segunda[k]; });
  return final;
}

/**
 * Resultado a gravar quando a fonte falhou mas já havia uma resposta VÁLIDA
 * guardada: mantém a anterior (com a data dela) e anota a falha nova, em vez de
 * trocar dados reais por "indisponível". Sem resposta válida anterior, grava a
 * falha como sempre — fonte não consultada nunca vale como "nada encontrado".
 */
export type LinhaConsulta = {
  resultado: Record<string, unknown> | null;
  quantidade: number; incide: boolean; erro: string | null; consultado_em: string;
};

export function linhaParaGravar(r: ResultadoFonte, anterior: LinhaConsulta | null | undefined, extra: Record<string, unknown> = {}): LinhaConsulta {
  const agora = new Date().toISOString();
  if (r.erro && anterior && !anterior.erro) {
    return {
      resultado: { ...(anterior.resultado ?? {}), ultima_falha: { em: agora, erro: r.erro } },
      quantidade: anterior.quantidade, incide: anterior.incide, erro: null, consultado_em: anterior.consultado_em,
    };
  }
  return {
    resultado: { itens: r.itens, ...extra },
    quantidade: r.quantidade, incide: r.incide, erro: r.erro ?? null, consultado_em: agora,
  };
}
