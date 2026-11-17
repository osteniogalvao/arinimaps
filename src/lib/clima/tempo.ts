import "server-only";

/**
 * Previsão do tempo e avisos meteorológicos da área (item 19 do PDF do Carlos,
 * 17/11/2026; plano em docs/PILOTO-METEOROLOGIA.md).
 *
 *  - Previsão: modelo global GFS da NOAA/NCEP (grade de 0,25°), lido pela API
 *    do Open-Meteo, que entrega o GFS já decodificado do GRIB2. Uso comercial
 *    pede a chave paga do Open-Meteo em OPEN_METEO_API_KEY (vai para o
 *    endereço customer-api); sem ela usa o endereço aberto.
 *  - Avisos: os avisos oficiais do INMET para o município (código IBGE). O
 *    serviço de alertas do NWS cobre só os EUA e não serve para o Brasil.
 *
 * Nenhuma das duas consultas leva a divisa do imóvel: só o centro da área
 * (previsão) e o código do município (avisos).
 */

export type PrevisaoDia = { data: string; tmin: number | null; tmax: number | null; chuvaMm: number | null; chanceChuva: number | null; ventoMaxKmh: number | null };
export type Previsao = { fonte: string; modelo: string; latitude: number; longitude: number; dias: PrevisaoDia[]; consultado_em: string };
export type AvisoMeteorologico = {
  id: string; evento: string; severidade: string; cor: string | null; inicio: string | null; fim: string | null;
  descricao: string | null; riscos: string[]; instrucoes: string[]; link: string;
};

const TEMPO_MS = 12_000;

export async function previsaoGfs(lat: number, lng: number): Promise<Previsao> {
  const chave = process.env.OPEN_METEO_API_KEY?.trim();
  const base = chave ? "https://customer-api.open-meteo.com/v1/gfs" : "https://api.open-meteo.com/v1/gfs";
  const qs = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lng.toFixed(3), timezone: "America/Sao_Paulo", forecast_days: "7",
    daily: "temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
    ...(chave ? { apikey: chave } : {}),
  });
  const r = await fetch(`${base}?${qs}`, { signal: AbortSignal.timeout(TEMPO_MS), next: { revalidate: 3600 } });
  if (!r.ok) throw new Error(`Open-Meteo GFS ${r.status}`);
  const j = await r.json() as {
    latitude: number; longitude: number;
    daily?: Record<string, (number | string | null)[]>;
  };
  const d = j.daily ?? {};
  const n = (k: string, i: number) => { const v = d[k]?.[i]; return typeof v === "number" ? v : null; };
  const dias = ((d.time ?? []) as string[]).map((data, i) => ({
    data, tmin: n("temperature_2m_min", i), tmax: n("temperature_2m_max", i), chuvaMm: n("precipitation_sum", i),
    chanceChuva: n("precipitation_probability_max", i), ventoMaxKmh: n("wind_speed_10m_max", i),
  }));
  return { fonte: "NOAA/NCEP GFS via Open-Meteo", modelo: "GFS 0,25°", latitude: j.latitude, longitude: j.longitude, dias, consultado_em: new Date().toISOString() };
}

type AvisoInmet = Record<string, unknown>;
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const lista = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\r?\n|;/) : [])
  .map((x) => String(x).replace(/^[-•\s]+/, "").trim()).filter(Boolean);

/** Avisos ativos do INMET (hoje e futuros) que incluem o município. */
export async function avisosInmet(codIbge: number): Promise<AvisoMeteorologico[]> {
  const r = await fetch("https://apiprevmet3.inmet.gov.br/avisos/ativos", {
    signal: AbortSignal.timeout(TEMPO_MS), next: { revalidate: 900 }, headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`INMET avisos ${r.status}`);
  const j = await r.json() as { hoje?: AvisoInmet[]; futuro?: AvisoInmet[] } | AvisoInmet[];
  const todos = Array.isArray(j) ? j : [...(j.hoje ?? []), ...(j.futuro ?? [])];
  const cod = String(codIbge);
  const vistos = new Set<string>();
  return todos.filter((a) => {
    const geocodes = String(a.geocodes ?? a.geocode ?? "");
    return geocodes.split(/[,\s]+/).includes(cod);
  }).map((a) => {
    const id = String(a.id_aviso ?? a.id ?? `${a.descricao}-${a.inicio}`);
    return {
      id, evento: texto(a.descricao) ?? texto(a.evento) ?? "Aviso meteorológico",
      severidade: texto(a.severidade) ?? "—", cor: texto(a.aviso_cor) ?? texto(a.cor),
      inicio: texto(a.inicio) ?? texto(a.data_inicio), fim: texto(a.fim) ?? texto(a.data_fim),
      descricao: texto(a.descricao_aviso) ?? texto(a.texto), riscos: lista(a.riscos), instrucoes: lista(a.instrucoes),
      link: `https://alertas2.inmet.gov.br/${encodeURIComponent(id)}`,
    };
  }).filter((a) => !vistos.has(a.id) && vistos.add(a.id));
}
