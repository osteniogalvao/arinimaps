import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Malha do CAR (SICAR) — importação por município.
 *
 * Em 28/08/2026 o WFS do SICAR publicava zero camadas e o CAR ficou como
 * "depende de arquivo". Sondado de novo em 24/09: `sicar:sicar_imoveis_<uf>`
 * responde com geometria e atributos, sem teto de feições (Campina Verde,
 * 3.495 imóveis, veio inteira em 1,6 s). Pagina de 2.000 em 2.000 mesmo assim,
 * ordenado por código, e confere o total contra `numberMatched`: importação
 * pela metade calada é pior que importação que falha.
 */
export const CAR_WFS = "https://geoserver.car.gov.br/geoserver/sicar/ows";
const UA = "AriniImoveisBrasil/1.0 (contato@arinibrasil.com.br)";
const PAGINA = 2000;

// Um CAR clicável no arquivo nacional de tiles pode ainda não estar no banco regional.
// Página, matrícula e exportações reutilizam o mesmo perímetro oficial.
const buscando = new Map<string, Promise<void>>();

async function importarUmCar(codigo: string) {
  const url = new URL(CAR_WFS);
  url.search = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature",
    typeNames: "sicar:sicar_imoveis_" + codigo.slice(0, 2).toLowerCase(),
    count: "1", outputFormat: "application/json", CQL_FILTER: `cod_imovel='${codigo}'`,
  }).toString();
  const resposta = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!resposta.ok) throw new Error("SICAR indisponível.");
  const fc = await resposta.json();
  if (!Array.isArray(fc.features)) throw new Error("Resposta inválida do SICAR.");
  if (!fc.features.length) return;
  if (fc.features[0]?.properties?.cod_imovel !== codigo || !fc.features[0]?.geometry) throw new Error("Perímetro inválido no SICAR.");
  const { error } = await supabaseAdmin().rpc("fn_car_upsert", { p_fc: fc });
  if (error) throw new Error("Falha ao registrar perímetro do SICAR.");
}

export const consultarCar = cache(async (cod: string) => {
  const codigo = cod.trim().toUpperCase();
  const admin = supabaseAdmin();
  const ler = () => admin.rpc("fn_car_imovel", { p_cod: codigo });
  const local = await ler();
  if (local.error || local.data || !/^[A-Z]{2}-\d{7}-[0-9A-F]{32}$/.test(codigo)) return local;
  let busca = buscando.get(codigo);
  if (!busca) {
    busca = importarUmCar(codigo).finally(() => buscando.delete(codigo));
    buscando.set(codigo, busca);
  }
  try {
    await busca;
    return await ler();
  } catch {
    return { data: null, error: { message: "A consulta ao SICAR está indisponível. Tente novamente em instantes." } };
  }
});

export type ResultadoCar = { municipio: string; cod_ibge: number; gravados: number; total: number };

export async function importarCarMunicipio(
  admin: SupabaseClient,
  m: { nome: string; uf: string; codigo_ibge: number | string }
): Promise<ResultadoCar> {
  const camada = `sicar:sicar_imoveis_${m.uf.toLowerCase()}`;
  const cod = Number(m.codigo_ibge);
  let inicio = 0;
  let total = Infinity;
  let gravados = 0;

  while (inicio < total) {
    const url = `${CAR_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${camada}` +
      `&outputFormat=application/json&count=${PAGINA}&startIndex=${inicio}&sortBy=cod_imovel` +
      `&CQL_FILTER=cod_municipio_ibge=${cod}`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
    if (!r.ok) throw new Error(`SICAR respondeu HTTP ${r.status} para ${m.nome}`);
    const fc = await r.json();
    if (!Array.isArray(fc.features)) throw new Error(`SICAR devolveu resposta sem feições para ${m.nome}`);
    total = Number(fc.numberMatched ?? fc.totalFeatures ?? fc.features.length);

    const { data, error } = await admin.rpc("fn_car_upsert", { p_fc: fc });
    if (error) throw new Error(`banco recusou o CAR de ${m.nome}: ${error.message}`);
    gravados += Number(data ?? 0);

    if (!fc.features.length) break;
    inicio += fc.features.length;
  }

  if (gravados < total) {
    throw new Error(`${m.nome}: o SICAR informou ${total} imóveis e só ${gravados} foram gravados`);
  }
  return { municipio: m.nome, cod_ibge: cod, gravados, total };
}

/** Importa todos os municípios cadastrados, um de cada vez (o SICAR é serviço público). */
export async function importarCarTodos(admin: SupabaseClient) {
  const { data: ms, error } = await admin.from("municipalities").select("nome, uf, codigo_ibge").order("nome");
  if (error) throw new Error(error.message);
  const resultados: (ResultadoCar | { municipio: string; erro: string })[] = [];
  for (const m of ms ?? []) {
    try {
      resultados.push(await importarCarMunicipio(admin, m));
    } catch (e) {
      resultados.push({ municipio: m.nome, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return resultados;
}
