"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { ESTILO_BASE } from "@/lib/map/config";
import { carregarMaplibre } from "@/lib/map/maplibre";

type Props = {
  geometrias: GeoJSON.FeatureCollection;
  /** cor de cada lote pelo id da unidade */
  cores: Record<string, string>;
  /** rótulo curto (Q/L) de cada lote, aparece com zoom */
  rotulos: Record<string, string>;
  selecionado: string | null;
  onSelecionar: (id: string) => void;
  className?: string;
};

/**
 * Mapa do espelho de vendas: satélite com os lotes pintados pela situação.
 * Toque no lote = seleciona (o painel abre fora daqui). As cores mudam sem
 * recriar o mapa: só o dado da fonte é trocado.
 */
export default function MapaEspelho({ geometrias, cores, rotulos, selecionado, onSelecionar, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const prontoRef = useRef(false);
  const selecionarRef = useRef(onSelecionar);
  useEffect(() => { selecionarRef.current = onSelecionar; }, [onSelecionar]);

  const dados = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: geometrias.features.map((f) => {
      const id = String(f.properties?.id ?? "");
      return { ...f, properties: { id, cor: cores[id] ?? "#7E9187", rotulo: rotulos[id] ?? "", sel: id === selecionado ? 1 : 0 } };
    }),
  }), [geometrias, cores, rotulos, selecionado]);
  const dadosRef = useRef(dados);

  // cria o mapa uma vez por conjunto de divisas
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelado = false;
    let mapa: MLMap | undefined;
    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado || !containerRef.current) return;
      const estilo = structuredClone(ESTILO_BASE);
      estilo.layers = estilo.layers.map((l) => ({
        ...l, layout: { visibility: l.id === "base-satelite" ? "visible" : "none" },
      })) as typeof estilo.layers;
      const map = new maplibregl.Map({
        container: containerRef.current, style: estilo, center: [-50.2, -19.73], zoom: 14,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      mapa = map;
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        map.addSource("lotes", { type: "geojson", data: dadosRef.current });
        map.addLayer({ id: "lotes-fill", type: "fill", source: "lotes",
          paint: { "fill-color": ["get", "cor"], "fill-opacity": ["case", ["==", ["get", "sel"], 1], 0.85, 0.6] } });
        map.addLayer({ id: "lotes-linha", type: "line", source: "lotes",
          paint: {
            "line-color": ["case", ["==", ["get", "sel"], 1], "#D9BD6F", "#F2F2EC"],
            "line-width": ["case", ["==", ["get", "sel"], 1], 3.5, 1],
          } });
        map.addLayer({ id: "lotes-rotulo", type: "symbol", source: "lotes", minzoom: 17,
          layout: { "text-field": ["get", "rotulo"], "text-size": 11, "text-allow-overlap": false },
          paint: { "text-color": "#10241B", "text-halo-color": "#F2F2EC", "text-halo-width": 1.2 } });

        map.on("click", "lotes-fill", (ev) => {
          const id = ev.features?.[0]?.properties?.id;
          if (id) selecionarRef.current(String(id));
        });
        map.on("mouseenter", "lotes-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "lotes-fill", () => { map.getCanvas().style.cursor = ""; });

        const coords: [number, number][] = [];
        const walk = (c: unknown): void => {
          if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
          else if (Array.isArray(c)) c.forEach(walk);
        };
        for (const f of geometrias.features) walk((f.geometry as GeoJSON.Polygon | null)?.coordinates);
        if (coords.length) {
          const lngs = coords.map((c) => c[0]);
          const lats = coords.map((c) => c[1]);
          map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 40, duration: 0, maxZoom: 18 });
        }
        prontoRef.current = true;
      });
    })();
    return () => {
      cancelado = true;
      prontoRef.current = false;
      mapa?.remove();
      mapRef.current = null;
    };
  }, [geometrias]);

  // situação ou seleção mudou: só troca o dado
  useEffect(() => {
    dadosRef.current = dados;
    const map = mapRef.current;
    if (!map || !prontoRef.current) return;
    (map.getSource("lotes") as GeoJSONSource | undefined)?.setData(dados);
  }, [dados]);

  return <div ref={containerRef} className={className ?? "h-[420px] w-full overflow-hidden rounded-2xl border border-linha"} />;
}
