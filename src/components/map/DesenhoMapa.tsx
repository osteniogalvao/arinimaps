"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Map as MLMap, MapMouseEvent, GeoJSONSource } from "maplibre-gl";
import { ESTILO_BASE, CENTRO_REGIAO } from "@/lib/map/config";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { Eraser, MapPin, MousePointerClick, PenLine, Upload } from "lucide-react";
import { plural } from "@/lib/format";

export type GeometriaEscolhida = {
  geometry: GeoJSON.Geometry;
  fonte: "desenho" | "ponto" | "kml" | "kmz" | "car" | "lote";
};

export type Selecao = { tipo: "car"; cod: string } | { tipo: "lote"; id: string };

type Props = {
  onChange: (g: GeometriaEscolhida | null) => void;
  /** Geometria que já chega pronta (ex.: a área clicada no CAR). */
  inicial?: GeometriaEscolhida | null;
  /**
   * Modo "Selecionar no mapa" (revisão do Carlos, 29/10, etapa 2): o mapa
   * mostra só as divisas básicas tracejadas (CAR e lotes da planta) e o clique
   * escolhe o imóvel. Quem chama busca a divisa completa e devolve em `inicial`.
   */
  onSelecionar?: (s: Selecao) => void;
};

const CAR_NACIONAL = process.env.NEXT_PUBLIC_CAR_NACIONAL_URL?.trim() || "";

/** Enquadra o mapa numa geometria qualquer. */
function enquadrar(map: MLMap, geom: GeoJSON.Geometry) {
  const coords: [number, number][] = [];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk((geom as { coordinates?: unknown }).coordinates);
  if (!coords.length) return;
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, duration: 0 });
}

/**
 * Define a localização do imóvel: desenhar polígono (clique nos vértices,
 * duplo clique fecha), marcar um ponto, ou subir KML/KMZ (processado no navegador).
 */
export default function DesenhoMapa({ onChange, inicial, onSelecionar }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [modo, setModo] = useState<"selecionar" | "poligono" | "ponto">(onSelecionar ? "selecionar" : "poligono");
  const selecionarRef = useRef(onSelecionar);
  selecionarRef.current = onSelecionar;
  const modoRef = useRef(modo);
  modoRef.current = modo;
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const verticesRef = useRef(vertices);
  verticesRef.current = vertices;
  const [pronto, setPronto] = useState(false);
  const [msg, setMsg] = useState("");

  const render = useCallback((geom: GeoJSON.Geometry | null, emEdicao: [number, number][]) => {
    const map = mapRef.current;
    if (!map || !map.getSource("desenho")) return;
    const features: GeoJSON.Feature[] = [];
    if (geom) features.push({ type: "Feature", geometry: geom, properties: {} });
    if (emEdicao.length) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: emEdicao },
        properties: { edicao: true },
      });
      for (const v of emEdicao) {
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: v }, properties: { vertice: true } });
      }
    }
    (map.getSource("desenho") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelado = false;
    let mapa: MLMap | undefined;

    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado || !containerRef.current) return;
      const estilo = structuredClone(ESTILO_BASE);
      estilo.layers = estilo.layers.map((l) => ({
        ...l,
        layout: { visibility: l.id === "base-satelite" ? "visible" : "none" },
      })) as typeof estilo.layers;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: estilo,
        center: CENTRO_REGIAO,
        zoom: 11,
        doubleClickZoom: false,
        attributionControl: { compact: true },
      });
      mapa = map;
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        // divisas básicas, tracejadas: CAR (rural) e lotes da planta (urbano)
        const origem = window.location.origin;
        map.addSource("car", CAR_NACIONAL
          ? { type: "vector", url: `pmtiles://${CAR_NACIONAL.startsWith("/") ? origem + CAR_NACIONAL : CAR_NACIONAL}` }
          : { type: "vector", tiles: [`${origem}/api/tiles/car/{z}/{x}/{y}.pbf`], minzoom: 7, maxzoom: 13 });
        map.addLayer({ id: "sel-car-fill", type: "fill", source: "car", "source-layer": "car", minzoom: 10,
          paint: { "fill-color": "#FF9D3D", "fill-opacity": 0.02 } });
        map.addLayer({ id: "sel-car-linha", type: "line", source: "car", "source-layer": "car", minzoom: 10,
          paint: { "line-color": "#FFD3A3", "line-width": 1, "line-opacity": 0.85, "line-dasharray": [3, 2] } });
        map.addSource("lotes", { type: "vector", tiles: [`${origem}/api/tiles/lotes/{z}/{x}/{y}.pbf`], minzoom: 15, maxzoom: 17 });
        map.addLayer({ id: "sel-lotes-fill", type: "fill", source: "lotes", "source-layer": "lotes", minzoom: 15,
          paint: { "fill-color": "#FFE299", "fill-opacity": 0.02 } });
        map.addLayer({ id: "sel-lotes-linha", type: "line", source: "lotes", "source-layer": "lotes", minzoom: 15,
          paint: { "line-color": "#FFFFFF", "line-width": 1, "line-opacity": 0.8, "line-dasharray": [2, 2] } });
        map.addSource("desenho", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "desenho-fill", type: "fill", source: "desenho",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#2E9E6B", "fill-opacity": 0.3 },
        });
        map.addLayer({
          id: "desenho-linha", type: "line", source: "desenho",
          filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
          paint: { "line-color": "#D9BD6F", "line-width": 2.5 },
        });
        map.addLayer({
          id: "desenho-vertices", type: "circle", source: "desenho",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-color": "#fff", "circle-radius": 4.5, "circle-stroke-color": "#D9BD6F", "circle-stroke-width": 2 },
        });
        setPronto(true);
      });

      map.on("click", (e: MapMouseEvent) => {
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (modoRef.current === "selecionar") {
          // lote urbano tem prioridade: é menor e fica por cima do CAR
          const camadas = ["sel-lotes-fill", "sel-car-fill"].filter((l) => map.getLayer(l));
          const f = map.queryRenderedFeatures(e.point, { layers: camadas })[0];
          const p = (f?.properties ?? {}) as { id?: string; cod?: string };
          if (f?.layer.id === "sel-lotes-fill" && p.id) {
            selecionarRef.current?.({ tipo: "lote", id: String(p.id) });
            setMsg("Lote selecionado. Confira a divisa; se não estiver certa, use “Redesenhar”.");
          } else if (f?.layer.id === "sel-car-fill" && p.cod) {
            selecionarRef.current?.({ tipo: "car", cod: String(p.cod) });
            setMsg("Área do CAR selecionada. Confira a divisa; se não estiver certa, use “Redesenhar”.");
          } else {
            setMsg(map.getZoom() < 15
              ? "Aproxime o mapa: as divisas tracejadas aparecem de perto (lotes a partir do zoom de quadra)."
              : "Nenhuma divisa neste ponto. Use “Redesenhar” para desenhar a área do imóvel.");
          }
          return;
        }
        if (modoRef.current === "ponto") {
          const geom: GeoJSON.Point = { type: "Point", coordinates: lngLat };
          setVertices([]);
          render(geom, []);
          onChange({ geometry: geom, fonte: "ponto" });
          setMsg("Ponto marcado. Arraste o mapa e clique de novo para reposicionar.");
        } else {
          const novos = [...verticesRef.current, lngLat];
          setVertices(novos);
          render(null, novos);
          setMsg(`${plural(novos.length, "vértice")} — duplo clique para fechar o polígono.`);
        }
      });

      map.on("dblclick", () => {
        if (modoRef.current !== "poligono") return;
        const vs = verticesRef.current;
        if (vs.length < 3) { setMsg("Um polígono precisa de pelo menos 3 pontos."); return; }
        const anel = [...vs, vs[0]];
        const geom: GeoJSON.Polygon = { type: "Polygon", coordinates: [anel] };
        setVertices([]);
        render(geom, []);
        onChange({ geometry: geom, fonte: "desenho" });
        setMsg("Polígono fechado. Use “Limpar” para refazer.");
      });
    })();

    return () => {
      cancelado = true;
      mapa?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importarArquivo(file: File) {
    try {
      let kmlTexto: string;
      if (file.name.toLowerCase().endsWith(".kmz")) {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const entrada = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(".kml"));
        if (!entrada) throw new Error("KMZ sem arquivo KML dentro.");
        kmlTexto = await entrada.async("string");
      } else {
        kmlTexto = await file.text();
      }
      const { kml } = await import("@tmcw/togeojson");
      const doc = new DOMParser().parseFromString(kmlTexto, "text/xml");
      const geojson = kml(doc) as GeoJSON.FeatureCollection;
      const feature = geojson.features.find((f) =>
        ["Polygon", "MultiPolygon"].includes(f.geometry?.type ?? "")
      ) ?? geojson.features.find((f) => f.geometry);
      if (!feature?.geometry) throw new Error("Nenhuma geometria encontrada no arquivo.");

      setVertices([]);
      render(feature.geometry, []);
      onChange({
        geometry: feature.geometry,
        fonte: file.name.toLowerCase().endsWith(".kmz") ? "kmz" : "kml",
      });

      // enquadra
      const coords: [number, number][] = [];
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
        else if (Array.isArray(c)) c.forEach(walk);
      };
      walk((feature.geometry as GeoJSON.Polygon).coordinates);
      if (coords.length && mapRef.current) {
        const lngs = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        mapRef.current.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60 }
        );
      }
      setMsg(`Geometria importada de ${file.name}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
    }
  }

  // área que já chegou pronta (CAR): desenha e enquadra assim que o mapa carrega
  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map || !inicial) return;
    render(inicial.geometry, []);
    enquadrar(map, inicial.geometry);
  }, [pronto, inicial, render]);

  function limpar() {
    setVertices([]);
    render(null, []);
    onChange(null);
    setMsg("");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(onSelecionar ? (["selecionar", "poligono", "ponto"] as const) : (["poligono", "ponto"] as const)).map((m) => (
          <button key={m} type="button" onClick={() => { setModo(m); limpar(); }}
            className={`inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 border font-semibold transition ${modo === m ? "bg-verde text-fundo border-verde" : "border-linha-forte text-texto-3 hover:border-verde hover:text-verde"}`}>
            {m === "selecionar" ? <><MousePointerClick className="size-4" /> Selecionar no mapa</>
              : m === "poligono" ? <><PenLine className="size-4" /> {onSelecionar ? "Redesenhar" : "Desenhar área"}</>
              : <><MapPin className="size-4" /> Marcar ponto</>}
          </button>
        ))}
        <label className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 border border-linha-forte font-semibold text-texto-3 transition hover:border-verde hover:text-verde cursor-pointer">
          <Upload className="size-4" /> Subir KML/KMZ
          <input type="file" accept=".kml,.kmz" className="hidden"
            onChange={(e) => e.target.files?.[0] && importarArquivo(e.target.files[0])} />
        </label>
        <button type="button" onClick={limpar} className="btn-contorno inline-flex items-center gap-1.5 px-3.5 py-2">
          <Eraser className="size-4" /> Limpar
        </button>
      </div>
      <div ref={containerRef} className="h-96 w-full rounded-2xl overflow-hidden border border-linha shadow-[0_18px_40px_-34px_rgb(0_0_0/0.6)]" />
      <p className="text-sm text-texto-2 min-h-5 leading-relaxed">
        {msg || (pronto && inicial?.fonte === "car" ? "Divisa trazida do CAR. Se ela não estiver certa, use Limpar e desenhe a área."
          : pronto && inicial?.fonte === "lote" ? "Divisa trazida da planta da cidade. Se ela não estiver certa, use Limpar e desenhe o lote."
          : pronto && modo === "selecionar" ? "Aproxime o mapa até o seu imóvel e clique dentro da divisa tracejada para selecioná-lo."
          : pronto ? "Clique no mapa para desenhar a divisa do imóvel, ou suba o KML/KMZ da propriedade." : "Carregando mapa…")}
      </p>
    </div>
  );
}
