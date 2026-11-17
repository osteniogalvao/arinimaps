"use client";

import { useEffect, useRef, useState } from "react";
import AmbienteCar from "./AmbienteCar";
import AlertasDaArea from "./AlertasDaArea";
import { buffer } from "@turf/turf";
import type { Map as MLMap } from "maplibre-gl";
import { estiloSatelite } from "@/lib/map/ortofotos";
import { RADAR_ANEL, STATUS_MAPA } from "./statusMapa";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { adicionarPinosPoi, type PoiNoMapa } from "@/lib/map/pinosPoi";
import { visualPoi } from "@/lib/geo/poiVisual";
import { SeloPoi } from "./UiMapa";

type Props = {
  geometry: GeoJSON.Geometry;
  status: string;
  className?: string;
  carAmbiental?: string;
  /** área do imóvel (ha), base do % no quadro ambiental */
  areaHa?: number | null;
  /** raio da pesquisa (m): anel tracejado em volta da área, como no Tour 3D */
  raioM?: number;
  /** pontos do entorno com coordenadas: viram pinos coloridos com ícone */
  pois?: PoiNoMapa[];
};

/** Mapa satélite com a geometria do imóvel destacada (página do imóvel e admin). */
export default function MiniMapa({ geometry, status, className, carAmbiental, areaHa, raioM = 0, pois }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [mapaCar, setMapaCar] = useState<MLMap | null>(null);
  const [carregado, setCarregado] = useState<MLMap | null>(null);
  // 17/11 (áudio do Carlos, 11h49): APP, reserva e as demais camadas já abrem à mostra
  const [ambiental, setAmbiental] = useState(!!carAmbiental);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelado = false;
    let mapa: MLMap | undefined;

    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: estiloSatelite(),
        center: [-50.2, -19.73],
        zoom: 12,
        attributionControl: { compact: true },
      });
      mapa = map;
      mapRef.current = map;
      if (carAmbiental) setMapaCar(map);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        setCarregado(map);
        const cor = STATUS_MAPA[status] ?? STATUS_MAPA.publicado;
        map.addSource("imovel", { type: "geojson", data: { type: "Feature", geometry, properties: {} } });
        if (geometry.type === "Point") {
          // radar do manual: ponto de status com anel Oliva em volta
          map.addLayer({
            id: "imovel-ponto-anel", type: "circle", source: "imovel",
            paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": 17, "circle-stroke-width": 2, "circle-stroke-color": RADAR_ANEL },
          });
          map.addLayer({
            id: "imovel-ponto", type: "circle", source: "imovel",
            paint: { "circle-color": cor, "circle-radius": 9, "circle-stroke-width": 2.5, "circle-stroke-color": "#F2F2EC" },
          });
          map.jumpTo({ center: geometry.coordinates as [number, number], zoom: 16 });
        } else {
          map.addLayer({
            id: "imovel-fill", type: "fill", source: "imovel",
            paint: { "fill-color": cor, "fill-opacity": 0.28 },
          });
          map.addLayer({
            id: "imovel-linha", type: "line", source: "imovel",
            paint: { "line-color": "#D9BD6F", "line-width": 3 },
          });
          const limites = new maplibregl.LngLatBounds();
          const walk = (c: unknown): void => {
            if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") limites.extend([c[0], c[1]]);
            else if (Array.isArray(c)) c.forEach(walk);
          };
          walk((geometry as GeoJSON.Polygon).coordinates);
          // 17/11 (vídeo do Carlos, 16h37): o raio da pesquisa à vista no próprio mapa
          const anel = raioM > 0 ? buffer({ type: "Feature", geometry, properties: {} } as GeoJSON.Feature<GeoJSON.Polygon>, raioM / 1000, { units: "kilometers" }) : null;
          if (anel) {
            map.addSource("raio", { type: "geojson", data: anel });
            map.addLayer({ id: "raio-linha", type: "line", source: "raio",
              paint: { "line-color": "#FFD400", "line-width": 2.2, "line-dasharray": [2, 1.5] } });
            if (raioM <= 5000) walk((anel.geometry as GeoJSON.Polygon).coordinates);
          }
          if (!limites.isEmpty()) map.fitBounds(limites, { padding: 50, duration: 0, maxZoom: 18 });
        }
      });
    })();

    return () => {
      cancelado = true;
      mapa?.remove();
      mapRef.current = null;
      setCarregado(null);
    };
  }, [geometry, status, carAmbiental, raioM]);

  // pinos do entorno (17/11/2026): os 4 mais perto já com nome à mostra
  useEffect(() => {
    if (!carregado || !pois?.length) return;
    let tirar: (() => void) | null = null;
    let vivo = true;
    adicionarPinosPoi(carregado, pois, { fixos: 4 }).then((f) => { if (vivo) tirar = f; else f(); }).catch(() => undefined);
    return () => { vivo = false; tirar?.(); };
  }, [carregado, pois]);

  useEffect(() => {
    if (!mapaCar || mapaCar !== mapRef.current) return;
    const atualizar = () => {
      for (const id of ["imovel-fill", "imovel-linha"]) {
        if (mapaCar.getLayer(id)) mapaCar.setLayoutProperty(id, "visibility", ambiental ? "none" : "visible");
      }
    };
    if (mapaCar.getSource("imovel")) atualizar();
    else mapaCar.once("load", atualizar);
    return () => { mapaCar.off("load", atualizar); };
  }, [mapaCar, ambiental]);

  const categorias = [...new Set((pois ?? []).map((p) => p.categoria))];
  const mapa = (
    <div className="relative h-full">
      <div ref={containerRef} className={className ?? "h-80 w-full rounded-2xl overflow-hidden border border-linha"} />
      {categorias.length > 0 && (
        <ul aria-label="Legenda do entorno" className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
          {categorias.map((c) => (
            <li key={c} className="flex items-center gap-1.5 rounded-full bg-[rgba(10,34,25,0.82)] py-0.5 pl-0.5 pr-2 text-[10.5px] font-medium text-[#F2F2EC] shadow">
              <SeloPoi categoria={c} tamanho="size-4" icone="size-2.5" />
              {visualPoi(c).rotulo}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  if (!carAmbiental) return mapa;
  return <div className="space-y-3">{mapa}
    <button className="btn-contorno px-4 py-2 text-sm disabled:opacity-60" type="button" disabled={!mapaCar}
      onClick={() => setAmbiental(v => !v)} aria-expanded={ambiental}>
      {ambiental ? "Ocultar camadas ambientais" : "Mostrar APP, reserva e camadas ambientais"}
    </button>
    {ambiental && mapaCar && <AmbienteCar key={carAmbiental} mapa={mapaCar} cod={carAmbiental} quadro areaHa={areaHa} />}
    {ambiental && mapaCar && <AlertasDaArea mapa={mapaCar} geometria={geometry} />}
  </div>;
}
