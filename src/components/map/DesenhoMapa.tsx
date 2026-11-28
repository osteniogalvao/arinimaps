"use client";

import { CORES_RURAIS } from "@/lib/map/camadasOficiais";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Map as MLMap, MapMouseEvent, GeoJSONSource, PointLike } from "maplibre-gl";
import { ESTILO_BASE, CENTRO_REGIAO } from "@/lib/map/config";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { Eraser, MapPin, MousePointerClick, PenLine, Search, Upload } from "lucide-react";
import { plural } from "@/lib/format";
import { centroDe, transformarGeoJSON, TRANSFORM_ZERO, type AjusteLocal, type Transform } from "@/lib/geo/deslocar";

export type GeometriaEscolhida = {
  geometry: GeoJSON.Geometry;
  fonte: "desenho" | "ponto" | "kml" | "kmz" | "car" | "lote";
};

export type Selecao = { tipo: "car"; cod: string } | { tipo: "lote"; id: string };

type Props = {
  onChange: (g: GeometriaEscolhida | null) => void;
  planta?: { centro?: [number, number] | null; geojson_publico?: string; tiles?: string; transform?: Transform; ajustes?: AjusteLocal[] };
  recortes?: GeoJSON.Polygon[];
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
export default function DesenhoMapa({ onChange, inicial, onSelecionar, planta, recortes }: Props) {
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

  const [busca, setBusca] = useState({ quadra: "", lote: "" });
  const [buscando, setBuscando] = useState(false);
  const [achados, setAchados] = useState<{ nome: string; contexto: string; lng: number; lat: number }[]>([]);

  /** Seleciona o lote (ou a área do CAR) que estiver no ponto da tela. */
  function selecionarNoPonto(map: MLMap, ponto: PointLike) {
    // lote urbano tem prioridade: é menor e fica por cima do CAR
    const camadas = ["sel-lotes-fill", "sel-car-fill"].filter((l) => map.getLayer(l));
    const f = map.queryRenderedFeatures(ponto, { layers: camadas })[0];
    const p = (f?.properties ?? {}) as { id?: string; cod?: string };
    if (f?.layer.id === "sel-lotes-fill" && p.id) {
      selecionarRef.current?.({ tipo: "lote", id: String(p.id) });
      setMsg("Lote selecionado. Confira a divisa; se não estiver certa, use “Redesenhar”.");
      return true;
    }
    if (f?.layer.id === "sel-car-fill" && p.cod) {
      selecionarRef.current?.({ tipo: "car", cod: String(p.cod) });
      setMsg("Área do CAR selecionada. Confira a divisa; se não estiver certa, use “Redesenhar”.");
      return true;
    }
    setMsg(map.getZoom() < 15
      ? "Aproxime o mapa: as divisas tracejadas aparecem de perto (lotes a partir do zoom de quadra)."
      : "Nenhuma divisa neste ponto. Use “Redesenhar” para desenhar a área do imóvel.");
    return false;
  }

  /** Vai ao lote pela quadra e pelo número (busca da planta, migration 0115). */
  async function irParaQuadraLote() {
    const map = mapRef.current;
    const quadra = busca.quadra.trim(), lote = busca.lote.trim();
    if (!map || (!quadra && !lote)) return;
    const termo = quadra && lote ? `quadra ${quadra} lote ${lote}` : quadra ? `quadra ${quadra}` : `lote ${lote}`;
    const c = map.getCenter();
    setBuscando(true); setAchados([]); setMsg("");
    try {
      const r = await fetch("/api/geo/busca-urbana?" + new URLSearchParams({ q: termo, lng: c.lng.toFixed(3), lat: c.lat.toFixed(3) }));
      if (!r.ok) throw Error();
      const { resultados } = await r.json() as { resultados: { nome: string; contexto: string; fonte: string; lng: number; lat: number }[] };
      const daPlanta = (resultados ?? []).filter((x) => x.fonte === "Planta ARINI");
      if (!daPlanta.length) { setMsg("Não achamos essa quadra e lote nas plantas cadastradas. Procure no mapa ou desenhe a área."); return; }
      if (daPlanta.length === 1 || (quadra && lote)) abrirAchado(daPlanta[0]);
      else setAchados(daPlanta);
    } catch {
      setMsg("A busca por quadra e lote está indisponível. Procure no mapa.");
    } finally { setBuscando(false); }
  }

  function abrirAchado(a: { lng: number; lat: number; nome: string; contexto: string }) {
    const map = mapRef.current;
    if (!map) return;
    setAchados([]);
    map.flyTo({ center: [a.lng, a.lat], zoom: 19, duration: 800 });
    map.once("idle", () => {
      if (modoRef.current === "selecionar" && busca.lote.trim()) selecionarNoPonto(map, map.project([a.lng, a.lat]));
      else setMsg(`${a.nome} · ${a.contexto}. Clique dentro do lote para selecioná-lo.`);
    });
  }

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
        center: planta?.centro ?? CENTRO_REGIAO,
        zoom: planta?.centro ? 15 : 11,
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
          paint: { "fill-color": CORES_RURAIS.car, "fill-opacity": 0.02 } });
        map.addLayer({ id: "sel-car-linha", type: "line", source: "car", "source-layer": "car", minzoom: 10,
          paint: { "line-color": CORES_RURAIS.car, "line-width": 1, "line-opacity": 0.85, "line-dasharray": [3, 2] } });
        map.addSource("lotes", { type: "vector", tiles: [`${origem}/api/tiles/lotes/{z}/{x}/{y}.pbf`], minzoom: 15, maxzoom: 17 });
        map.addLayer({ id: "sel-lotes-fill", type: "fill", source: "lotes", "source-layer": "lotes", minzoom: 15,
          paint: { "fill-color": "#FFE299", "fill-opacity": 0.02 } });
        map.addLayer({ id: "sel-lotes-linha", type: "line", source: "lotes", "source-layer": "lotes", minzoom: 15,
          paint: { "line-color": "#FFFFFF", "line-width": 1, "line-opacity": 0.8, "line-dasharray": [2, 2] } });
        // 26/11/2026 (áudio do Carlos, 14h05): quem cadastra precisa ver quadra e
        // lote sobre a planta para achar o terreno, como no mapa principal
        map.addLayer({ id: "sel-lotes-rotulos", type: "symbol", source: "lotes", "source-layer": "rotulos", minzoom: 17,
          layout: {
            "text-field": ["case",
              ["all", ["has", "numero"], ["has", "quadra"]],
              ["format", ["get", "numero"], {}, "\nQd ", { "font-scale": 0.72 }, ["get", "quadra"], { "font-scale": 0.72 }],
              ["has", "numero"], ["get", "numero"],
              ["concat", "Qd ", ["get", "quadra"]]] as never,
            "text-font": ["Open Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 17, 10, 20, 16],
            "text-padding": 2,
          },
          paint: { "text-color": "#F2C94C", "text-halo-color": "rgba(10,34,25,0.92)", "text-halo-width": 1.6 } });
        if (planta?.tiles) {
          map.addSource("planta-referencia", { type: "raster", tiles: [planta.tiles], tileSize: 256 });
          map.addLayer({ id: "planta-referencia", type: "raster", source: "planta-referencia", paint: { "raster-opacity": 0.75 } });
        } else if (planta?.geojson_publico) {
          void fetch(planta.geojson_publico).then(r => { if (!r.ok) throw Error(); return r.json(); })
            .then((fc: GeoJSON.FeatureCollection) => {
              if (cancelado) return;
              const data = transformarGeoJSON(fc, planta.centro ?? centroDe(fc), planta.transform ?? TRANSFORM_ZERO, [], planta.ajustes);
              map.addSource("planta-referencia", { type: "geojson", data });
              map.addLayer({ id: "planta-referencia", type: "line", source: "planta-referencia",
                paint: { "line-color": "#FFE299", "line-width": 1.5 } }, "desenho-fill");
            }).catch(() => { if (!cancelado) setMsg("Falha ao carregar o desenho da planta."); });
        }
        if (planta) {
          map.addSource("recortes-existentes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "recortes-existentes", type: "fill", source: "recortes-existentes",
            paint: { "fill-color": "#67d6b1", "fill-opacity": 0.25, "fill-outline-color": "#67d6b1" } });
        }
        map.addSource("desenho", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "desenho-fill", type: "fill", source: "desenho",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#D9BD6F", "fill-opacity": 0.35 },
        });
        // 25/11/2026 (Stenio): o lote escolhido precisa acender como a fazenda —
        // contorno escuro por baixo e traço dourado grosso, legível sobre a planta
        map.addLayer({
          id: "desenho-contorno", type: "line", source: "desenho",
          filter: ["==", ["geometry-type"], "Polygon"],
          layout: { "line-join": "round" },
          paint: { "line-color": "#1A1405", "line-width": 7, "line-opacity": 0.8 },
        });
        map.addLayer({
          id: "desenho-linha", type: "line", source: "desenho",
          filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
          layout: { "line-join": "round" },
          paint: { "line-color": "#F2C94C", "line-width": 4 },
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
          selecionarNoPonto(map, e.point);
          return;
        }
        if (modoRef.current === "ponto") {
          // Áudio do Carlos (28/11/2026, 09h17): ponto em cima de um lote da
          // planta vira o lote inteiro, em destaque, e não um ponto solto
          const noLote = selecionarRef.current && map.getLayer("sel-lotes-fill")
            ? map.queryRenderedFeatures(e.point, { layers: ["sel-lotes-fill"] })[0] : undefined;
          if (noLote?.properties?.id) {
            selecionarRef.current?.({ tipo: "lote", id: String(noLote.properties.id) });
            setMsg("O ponto caiu num lote da planta: o lote inteiro foi selecionado.");
            return;
          }
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

  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>("recortes-existentes");
    if (pronto && source && recortes) source.setData({ type: "FeatureCollection", features: recortes.map(geometry => ({ type: "Feature", properties: {}, geometry })) });
  }, [recortes, pronto]);

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
        {(planta ? (["poligono"] as const) : onSelecionar ? (["selecionar", "poligono", "ponto"] as const) : (["poligono", "ponto"] as const)).map((m) => (
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
      {!planta && <div className="flex flex-wrap items-end gap-2 text-sm" role="search" aria-label="Ir para quadra e lote"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void irParaQuadraLote(); } }}>
        <label className="font-semibold text-texto-2">Quadra
          <input className="mt-1 block w-24 rounded-[10px] border border-linha bg-superficie px-3 py-2 text-texto" maxLength={20}
            value={busca.quadra} onChange={(e) => setBusca({ ...busca, quadra: e.target.value })} placeholder="Ex.: 15" />
        </label>
        <label className="font-semibold text-texto-2">Lote
          <input className="mt-1 block w-24 rounded-[10px] border border-linha bg-superficie px-3 py-2 text-texto" maxLength={20}
            value={busca.lote} onChange={(e) => setBusca({ ...busca, lote: e.target.value })} placeholder="Ex.: 04" />
        </label>
        <button type="button" onClick={() => void irParaQuadraLote()} disabled={buscando || !pronto || (!busca.quadra.trim() && !busca.lote.trim())}
          className="btn-contorno inline-flex items-center gap-1.5 px-3.5 py-2 disabled:opacity-50">
          <Search className="size-4" /> {buscando ? "Buscando…" : "Ir para quadra e lote"}
        </button>
        {achados.length > 0 && <ul className="w-full max-h-48 overflow-auto divide-y divide-linha rounded-xl border border-linha">
          {achados.map((a) => <li key={[a.nome, a.contexto, a.lng, a.lat].join("|")}>
            <button type="button" className="block w-full p-2 text-left hover:bg-verde/10" onClick={() => abrirAchado(a)}>
              <strong>{a.nome}</strong> <span className="text-xs text-texto-2">· {a.contexto}</span>
            </button></li>)}
        </ul>}
      </div>}
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
