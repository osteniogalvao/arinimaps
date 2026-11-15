import type { GeoJSONSource, Map as MLMap, MapSourceDataEvent } from "maplibre-gl";
import { CORES_RURAIS } from "@/lib/map/camadasOficiais";
import { recortarEmWorker } from "./camadasOficiaisMapa";

const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Usa os mesmos tiles da camada CAR, inclusive quando a fonte é o PMTiles nacional. */
export function exibirCarNasAreas(map: MLMap, areas: GeoJSON.Polygon[], aoFalhar: (aviso: string) => void) {
  if (!map.getSource("car-areas")) {
    map.addSource("car-areas", { type: "geojson", data: VAZIO });
    const antes = "imoveis-fill";
    map.addLayer(
      {
        id: "car-areas-leitura",
        source: "car",
        "source-layer": "car",
        type: "fill",
        minzoom: 7,
        paint: { "fill-opacity": 0, "fill-antialias": false },
      },
      antes,
    );
    map.addLayer(
      {
        id: "car-areas-fill",
        source: "car-areas",
        type: "fill",
        minzoom: 7,
        paint: { "fill-color": CORES_RURAIS.car, "fill-opacity": 0.04 },
      },
      antes,
    );
    map.addLayer(
      {
        id: "car-areas-linha",
        source: "car-areas",
        type: "line",
        minzoom: 7,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": CORES_RURAIS.car,
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.25, 10, 0.5, 12, 0.9, 15, 1.6],
        },
      },
      antes,
    );
  }
  return lerVetoresNasAreas(map, areas, ["car-areas-leitura"], "car", "car-areas", aoFalhar);
}

export function lerVetoresNasAreas(
  map: MLMap,
  areas: GeoJSON.Polygon[],
  leitores: string[],
  origem: string,
  destino: string,
  aoFalhar: (aviso: string) => void,
) {
  const car = origem === "car";
  const dados = map.getSource(destino) as GeoJSONSource;
  for (const leitor of leitores) map.setLayoutProperty(leitor, "visibility", "visible");
  let pedido: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function atualizar() {
    if (map.isMoving() || !map.isSourceLoaded(origem) || (car && map.getZoom() < 7)) return;
    pedido?.abort();
    const atual = new AbortController();
    pedido = atual;
    const tela = map.getCanvas();
    const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const vistas = new Set<string>();
    for (const area of areas) {
      const caixa = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [lng, lat] of area.coordinates[0]) {
        const { x, y } = map.project([lng, lat]);
        caixa[0] = Math.min(caixa[0], x);
        caixa[1] = Math.min(caixa[1], y);
        caixa[2] = Math.max(caixa[2], x);
        caixa[3] = Math.max(caixa[3], y);
      }
      const oeste = Math.max(0, caixa[0]),
        sul = Math.min(tela.clientHeight, caixa[3]);
      const leste = Math.min(tela.clientWidth, caixa[2]),
        norte = Math.max(0, caixa[1]);
      if (oeste >= leste || norte >= sul) continue;
      for (const f of map.queryRenderedFeatures(
        [
          [oeste, norte],
          [leste, sul],
        ],
        { layers: leitores },
      )) {
        if (!car && areas.length > 1) {
          const chave = JSON.stringify([f.properties, f.geometry]);
          if (vistas.has(chave)) continue;
          vistas.add(chave);
        }
        geojson.features.push({ type: "Feature", geometry: f.geometry, properties: f.properties });
      }
    }
    try {
      const resultado = geojson.features.length
        ? await recortarEmWorker(geojson, areas, atual.signal, car, car)
        : VAZIO;
      if (!atual.signal.aborted) dados.setData(resultado);
    } catch {
      if (!atual.signal.aborted) aoFalhar("Não foi possível recortar a camada nesta área.");
    }
  }
  function agendar() {
    clearTimeout(timer);
    timer = setTimeout(() => void atualizar(), 150);
  }
  function aoCarregar(e: MapSourceDataEvent) {
    if (e.sourceId === origem && e.isSourceLoaded) agendar();
  }
  map.on("sourcedata", aoCarregar);
  map.on("moveend", agendar);
  agendar();
  return () => {
    clearTimeout(timer);
    pedido?.abort();
    map.off("sourcedata", aoCarregar);
    map.off("moveend", agendar);
    if (leitores.length && map.style && map.getLayer(leitores[0])) {
      for (const leitor of leitores) map.setLayoutProperty(leitor, "visibility", "none");
      dados.setData(VAZIO);
    }
  };
}
