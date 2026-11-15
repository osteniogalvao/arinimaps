"use client";

/**
 * Carrega o MapLibre (v6, ESM) de /vendor/maplibre-gl.mjs, fora do bundle.
 *
 * POR QUÊ: o bundle do maplibre-gl via Turbopack quebrava o web worker interno —
 * o mapa criava a UI mas nunca buscava tiles (canvas na cor de fundo, sem erro
 * no console). Por isso o MapLibre é importado em runtime direto do arquivo
 * estático, e ele mesmo resolve o worker por `import.meta.url`
 * (/vendor/maplibre-gl-worker.mjs, mesma origem), sem precisar de setWorkerUrl.
 *
 * A v6 só publica ESM (o UMD `maplibre-gl.js` acabou), então o antigo
 * `<script src>` virou `import()` com `turbopackIgnore`. Os arquivos de
 * public/vendor são copiados do pacote npm por scripts/copia-maplibre.mjs
 * (`prebuild`; no dev, `npm run vendor:maplibre` após atualizar o pacote):
 * runtime, tipos e CSS saem sempre da mesma versão.
 */

import type * as MapLibreNS from "maplibre-gl";
import { URL_MAPLIBRE } from "./config";
import { Protocol } from "pmtiles";

declare global {
  interface Window {
    maplibregl?: typeof MapLibreNS;
  }
}

let promessa: Promise<typeof MapLibreNS> | null = null;

/**
 * `pmtiles://` — arquivo de mapa único (ex.: a malha nacional do CAR na
 * Cloudflare R2): o MapLibre lê só os pedaços da tela por Range request.
 * Registrado uma vez, junto com o carregamento do MapLibre.
 */
function registrarPmtiles(ml: typeof MapLibreNS) {
  const w = window as unknown as { __pmtilesRegistrado?: boolean };
  if (w.__pmtilesRegistrado) return ml;
  ml.addProtocol("pmtiles", new Protocol({ metadata: true }).tile);
  w.__pmtilesRegistrado = true;
  return ml;
}

export function carregarMaplibre(): Promise<typeof MapLibreNS> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("carregarMaplibre só roda no navegador"));
  }
  if (window.maplibregl) return Promise.resolve(registrarPmtiles(window.maplibregl));
  if (promessa) return promessa;

  const modulo = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ URL_MAPLIBRE) as Promise<
    typeof MapLibreNS
  >;
  promessa = modulo.then(
    (ml) => {
      window.maplibregl = ml; // diagnóstico (scripts/debug-mapa.mjs) e reuso entre mapas
      return registrarPmtiles(ml);
    },
    (e: unknown) => {
      promessa = null;
      throw new Error(`falha ao carregar ${URL_MAPLIBRE}: ${e instanceof Error ? e.message : String(e)}`);
    },
  );
  return promessa;
}
