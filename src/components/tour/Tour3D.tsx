"use client";

/**
 * Tour 3D do imóvel: terreno real (DEM Terrarium) + satélite + polígono dourado
 * + roteiro de câmera determinístico em função do tempo t.
 *
 * O MESMO roteiro serve para:
 *  - reprodução ao vivo (requestAnimationFrame);
 *  - gravação do vídeo no worker (?record=1 expõe window.__ARINI_TOUR.seek(t)
 *    e o Puppeteer captura frame a frame com clock virtual).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { buffer } from "@turf/turf";
import { RotateCcw } from "lucide-react";
import type { Map as MLMap, ErrorEvent as MLErrorEvent } from "maplibre-gl";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { SATELITE } from "@/lib/map/config";
import type { CamadasTour } from "@/lib/map/acesso-tour";
import CamadasDoTour from "./CamadasDoTour";
import AmbienteCar from "@/components/map/AmbienteCar";

export type TourData = {
  codigo: string;
  titulo: string;
  valor: number | null;
  tipo: string;
  areaLabel: string;
  geometry: GeoJSON.Geometry;
  centroid: { lng: number; lat: number };
  municipio: { nome: string; sede_lng: number | null; sede_lat: number | null } | null;
  pois: { nome: string | null; categoria: string; lng: number; lat: number; distancia_m: number; destaque: boolean }[];
  record?: boolean;
  camadas?: CamadasTour | null;
  consulta?: { voltar: string; limites: [number, number, number, number]; car?: string; raio?: number; caminho?: string };
};

type Cam = { lng: number; lat: number; zoom: number; pitch: number; bearing: number };
type Key = { t: number; cam: Cam };

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Ritmo do tour ao vivo. O roteiro original (ritmo 1) foi pensado para o vídeo
 * e passava rápido demais para quem assiste na tela — pedido do Carlos em
 * 01/10/2026: "reduzir a velocidade e deixar o movimento mais suave". O vídeo
 * gravado pelo worker continua no ritmo 1, para não alongar a renderização.
 */
const RITMO_AO_VIVO = 1.7;

/** Raios do painel do tour (17/11/2026, vídeo do Carlos: "o raio aqui, até X km, e navegar vendo os pontos"). */
const RAIOS_TOUR = [0, 1000, 2000, 5000, 10000];

/** Espera o mapa terminar de baixar e desenhar o que está na tela, com teto. */
function esperarMapa(map: MLMap, tetoMs: number) {
  return new Promise<void>((ok) => {
    if (map.loaded() && map.areTilesLoaded()) { ok(); return; }
    const fim = () => { clearTimeout(timer); map.off("idle", fim); ok(); };
    const timer = setTimeout(fim, tetoMs);
    map.on("idle", fim);
  });
}

const distancia = (m: number) =>
  m >= 1000 ? `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;

function buildKeyframes(d: TourData, ritmo = 1, zoomArea?: number): { keys: Key[]; orbit: { start: number; end: number; base: Cam } } {
  const c = d.centroid;
  const sede = d.municipio?.sede_lng != null
    ? { lng: d.municipio.sede_lng!, lat: d.municipio.sede_lat! }
    : null;
  const destaque = d.pois.filter((p) => p.destaque).slice(0, 3);

  const keys: Key[] = [
    { t: 0, cam: { lng: c.lng, lat: c.lat + 0.9, zoom: 6.2, pitch: 0, bearing: 0 } },
    { t: 5, cam: { lng: c.lng, lat: c.lat, zoom: 13.2, pitch: 58, bearing: 0 } },
  ];
  // órbita 5s→15s tratada à parte (bearing contínuo)
  let t = 15;
  const orbit = { start: 5, end: 15, base: { lng: c.lng, lat: c.lat, zoom: 13.6, pitch: 58, bearing: 0 } };

  if (sede) {
    keys.push({ t, cam: { lng: c.lng, lat: c.lat, zoom: 13.6, pitch: 58, bearing: 0 } });
    t += 5;
    keys.push({ t, cam: { lng: (c.lng + sede.lng) / 2, lat: (c.lat + sede.lat) / 2, zoom: 10.2, pitch: 40, bearing: 15 } });
  }
  for (const p of destaque) {
    t += 4;
    keys.push({ t, cam: { lng: p.lng, lat: p.lat, zoom: 13.5, pitch: 50, bearing: 25 } });
  }
  t += 5;
  keys.push({ t, cam: { lng: c.lng, lat: c.lat, zoom: 14, pitch: 55, bearing: 340 } });
  if (ritmo !== 1) {
    for (const k of keys) k.t *= ritmo;
    orbit.start *= ritmo;
    orbit.end *= ritmo;
  }
  if (zoomArea != null) {
    const zoom = Math.min(18, Math.max(3, zoomArea - 0.4));
    orbit.base.zoom = zoom;
    for (const key of keys) {
      key.cam.lat = c.lat;
      key.cam.lng = c.lng;
      key.cam.zoom = key.t === 0 ? zoom - 1.5 : zoom;
    }
  }
  return { keys, orbit };
}

function camAt(t: number, keys: Key[], orbit: { start: number; end: number; base: Cam }): Cam {
  if (t >= orbit.start && t < orbit.end) {
    const frac = (t - orbit.start) / (orbit.end - orbit.start);
    return { ...orbit.base, bearing: frac * 360 };
  }
  let prev = keys[0], next = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) { prev = keys[i]; next = keys[i + 1]; break; }
  }
  if (t >= next.t) return next.cam;
  const k = easeInOut((t - prev.t) / Math.max(0.001, next.t - prev.t));
  return {
    lng: lerp(prev.cam.lng, next.cam.lng, k),
    lat: lerp(prev.cam.lat, next.cam.lat, k),
    zoom: lerp(prev.cam.zoom, next.cam.zoom, k),
    pitch: lerp(prev.cam.pitch, next.cam.pitch, k),
    bearing: lerp(prev.cam.bearing, next.cam.bearing, k),
  };
}

const CATEGORIA_NOME: Record<string, string> = {
  combustivel: "Posto", farmacia: "Farmácia", supermercado: "Supermercado", hospital: "Hospital",
  escola: "Escola", centro: "Centro", acesso_rodovia: "Acesso à rodovia",
};

/* Marcador da etiqueta do tour: ponto colorido por categoria, em vez de emoji
   (que muda de desenho em cada sistema e sai diferente no vídeo gravado). */
const CATEGORIA_COR: Record<string, string> = {
  combustivel: "#FFE299", farmacia: "#FFE299", supermercado: "#7CC4FF", hospital: "#FF8A80",
  escola: "#B18CFF", centro: "#FFFFFF", acesso_rodovia: "#FFB74D",
};
const ponto = (cor: string) =>
  `<i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${cor};margin-right:5px;vertical-align:1px"></i>`;

export default function Tour3D(dados: TourData) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [mapaPronto, setMapaPronto] = useState<MLMap | null>(null);
  const velocidade = useRef(1);
  const controlar = useRef<(reiniciar: boolean) => void>(() => {});
  const pausar = useRef<() => void>(() => {});
  const [relevo, setRelevo] = useState(1.4);
  const [esperandoTiles, setEsperandoTiles] = useState(false);
  // 17/11 (vídeo do Carlos, 16h37): a camada ambiental já abre ligada no tour
  const [ambienteCar, setAmbienteCar] = useState(!!dados.consulta?.car);
  const [raio, setRaio] = useState(dados.consulta?.raio ?? 0);
  const raios = RAIOS_TOUR.includes(raio) ? RAIOS_TOUR : [...RAIOS_TOUR, raio].sort((a, b) => a - b);
  // com raio, as camadas oficiais (usinas, linhas de energia, aeródromos...) valem para todo o entorno
  const anel = useMemo(() => {
    const g = dados.geometry;
    if (raio <= 0 || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
    return buffer({ type: "Feature", geometry: g, properties: {} } as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>, raio / 1000, { units: "kilometers" }) ?? null;
  }, [dados.geometry, raio]);
  useEffect(() => {
    const map = mapaPronto;
    if (!map) return;
    const dadosAnel: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: anel ? [anel] : [] };
    const fonte = map.getSource("raio-tour") as import("maplibre-gl").GeoJSONSource | undefined;
    if (fonte) fonte.setData(dadosAnel);
    else {
      map.addSource("raio-tour", { type: "geojson", data: dadosAnel });
      map.addLayer({ id: "raio-tour-linha", type: "line", source: "raio-tour",
        paint: { "line-color": "#FFD400", "line-width": 2.5, "line-dasharray": [2, 1.5] } });
    }
  }, [mapaPronto, anel]);
  const voltarConsulta = dados.consulta?.caminho ? `${dados.consulta.caminho}?raio_m=${raio}` : dados.consulta?.voltar;
  const [fase, setFase] = useState<"carregando" | "tocando" | "pausado" | "fim">("carregando");
  const [etapa, setEtapa] = useState("Carregando o mapa…");
  const faseRef = useRef(fase);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelado = false;
    let mapa: MLMap | undefined;
    let raf = 0;

    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
          sources: {
            satelite: SATELITE,
            dem: {
              type: "raster-dem",
              tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
              encoding: "terrarium", tileSize: 256, maxzoom: 15,
            },
          },
          layers: [{ id: "satelite", type: "raster", source: "satelite" }],
          terrain: { source: "dem", exaggeration: 1.4 },
        },
        center: [dados.centroid.lng, dados.centroid.lat + 0.9],
        zoom: 6.2,
        ...(dados.consulta ? {
          bounds: dados.consulta.limites, fitBoundsOptions: {padding: 48, maxZoom: 18},
        } : {}),
        pitch: 0,
        maxPitch: 75,
        attributionControl: { compact: true },
      });
      mapa = map;
      mapRef.current = map;
      map.on("error", (e: MLErrorEvent) => console.error("[tour] erro do mapa:", e.error?.message ?? e));

      map.on("load", async () => {
        const b = dados.consulta?.limites;
        const zoomArea = b && map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], {padding: 48, maxZoom: 18})?.zoom;
        const { keys, orbit } = buildKeyframes(dados, dados.record ? 1 : RITMO_AO_VIVO, zoomArea);
        const duracao = keys[keys.length - 1].t;
        map.addSource("imovel", { type: "geojson", data: { type: "Feature", geometry: dados.geometry, properties: {} } });
        if (dados.geometry.type !== "Point") {
          map.addLayer({ id: "imovel-fill", type: "fill", source: "imovel", paint: { "fill-color": "#D9BD6F", "fill-opacity": 0.22 } });
          map.addLayer({ id: "imovel-linha", type: "line", source: "imovel", paint: { "line-color": "#D9BD6F", "line-width": 3.5 } });
        } else {
          map.addLayer({ id: "imovel-ponto", type: "circle", source: "imovel", paint: { "circle-color": "#D9BD6F", "circle-radius": 10, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
        }

        if (dados.pois.length) {
          map.addSource("pois", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: dados.pois.map((p) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [p.lng, p.lat] },
                properties: { rotulo: (p.nome ? p.nome.split(";").map((s) => s.trim()).join(" / ") : null) ?? CATEGORIA_NOME[p.categoria] ?? p.categoria },
              })),
            },
          });
          map.addLayer({
            id: "pois-pontos", type: "circle", source: "pois",
            paint: { "circle-color": "#ffffff", "circle-radius": 5, "circle-stroke-color": "#0E4D36", "circle-stroke-width": 2 },
          });
        }

        // Pontos de referência com nome e distância, como etiquetas sobre o
        // mapa. São elementos HTML (não camada de texto do MapLibre) porque
        // assim independem de fonte remota e aparecem iguais no vídeo.
        const etiquetados = [...dados.pois]
          .sort((a, b) => Number(b.destaque) - Number(a.destaque) || a.distancia_m - b.distancia_m)
          .slice(0, 8);
        for (const p of etiquetados) {
          const el = document.createElement("div");
          el.className = "tour-etiqueta";
          el.innerHTML =
            `<b>${ponto(CATEGORIA_COR[p.categoria] ?? "#FFFFFF")}${((p.nome ? p.nome.split(";").map((s) => s.trim()).join(" / ") : null) ?? CATEGORIA_NOME[p.categoria] ?? p.categoria).replace(/[<>&]/g, "")}</b>` +
            `<span>${distancia(p.distancia_m)}</span>`;
          new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -8] }).setLngLat([p.lng, p.lat]).addTo(map);
        }
        if (dados.municipio?.sede_lng != null && dados.municipio.sede_lat != null) {
          const el = document.createElement("div");
          el.className = "tour-etiqueta tour-etiqueta-cidade";
          el.innerHTML = `<b>${dados.municipio.nome.replace(/[<>&]/g, "")}</b>`;
          new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -8] })
            .setLngLat([dados.municipio.sede_lng, dados.municipio.sede_lat]).addTo(map);
        }

        const seek = (t: number) => {
          const cam = camAt(Math.min(t, duracao), keys, orbit);
          map.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing });
        };

        if (dados.record) {
          // API determinística para o worker de vídeo
          (window as unknown as Record<string, unknown>).__ARINI_TOUR = {
            duracao, fps: 30, seek,
            pronto: () => map.loaded() && map.areTilesLoaded(),
          };
          seek(0);
          setFase("pausado");
          return;
        }

        // Antes de tocar, o mapa carrega: primeiro a vista de perto do imóvel
        // (é onde o tour passa mais tempo e onde a imagem pesa), depois a vista
        // de abertura. Sem isso o tour começava sobre uma tela cinza e chegava
        // ao imóvel antes do satélite — queixa do Carlos em 01/10/2026.
        setEtapa("Carregando a imagem do imóvel…");
        seek(orbit.start);
        await esperarMapa(map, 12_000);
        if (cancelado) return;
        // Pré-carrega cada parada do roteiro (PDF do Carlos, 17/11/2026: "alguns
        // elementos não estão sendo carregados a tempo durante a apresentação").
        // Os tiles ficam no cache do navegador e o sobrevoo não chega antes deles.
        const paradas = keys.filter((k) => k.t > orbit.start);
        for (let i = 0; i < paradas.length; i++) {
          setEtapa(`Carregando o percurso (${i + 1} de ${paradas.length})…`);
          seek(paradas[i].t);
          await esperarMapa(map, 5_000);
          if (cancelado) return;
        }
        setEtapa("Preparando o sobrevoo…");
        seek(0);
        await esperarMapa(map, 8_000);
        if (cancelado) return;

        setMapaPronto(map);
        let t = 0, ultimo = 0, verificarEm = 0, aguardarAte = 0;
        let aguardando = false;
        const tick = (agora: number) => {
          if (cancelado || faseRef.current !== "tocando") return;
          const passo = Math.min(120, Math.max(0, agora - ultimo)) / 1000;
          ultimo = agora;
          // Com conexão lenta, conserva a câmera até o tile chegar. Um órgão
          // indisponível não pode suspender o roteiro indefinidamente.
          if (agora >= verificarEm) {
            verificarEm = agora + 400;
            if (map.areTilesLoaded()) aguardarAte = 0;
            else if (!aguardarAte || agora > aguardarAte + 5000) aguardarAte = agora + 6000;
            const esperar = agora < aguardarAte;
            if (esperar !== aguardando) { aguardando = esperar; setEsperandoTiles(esperar); }
          }
          if (!aguardando && !document.hidden) t += passo * velocidade.current;
          if (t >= duracao) { seek(duracao); faseRef.current = "fim"; setFase("fim"); return; }
          if (!aguardando && !document.hidden) seek(t);
          raf = requestAnimationFrame(tick);
        };
        controlar.current = (reiniciar) => {
          if (reiniciar || faseRef.current === "fim") t = 0;
          cancelAnimationFrame(raf);
          ultimo = performance.now();
          faseRef.current = "tocando"; setFase("tocando");
          raf = requestAnimationFrame(tick);
        };
        controlar.current(true);

        // qualquer interação devolve o controle ao usuário
        const parar = () => {
          if (faseRef.current !== "tocando") return;
          faseRef.current = "pausado"; setFase("pausado");
        };
        pausar.current = parar;
        map.on("mousedown", parar);
        map.on("touchstart", parar);
        map.on("wheel", parar);
      });
    })();

    return () => {
      cancelado = true;
      cancelAnimationFrame(raf);
      mapa?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const brl = dados.valor?.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) ?? "Sob consulta";

  return (
    <div className="relative h-screen w-full bg-black">
      {/* inline: o CSS do maplibre força position:relative na classe e colapsaria a altura */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {!dados.record && (
        <>
          <div className="absolute top-4 left-4 max-w-[min(22rem,calc(100vw-2rem))] rounded-[20px] bg-[#0A2219]/92 px-5 py-4 text-[#F2F2EC]">
            <span className="block h-0.5 w-7 rounded bg-[#D9BD6F]" aria-hidden />
            <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#D3DCD2]">Tour 3D · {dados.codigo}</p>
            <p className="lp-display mt-1.5 text-3xl text-[#F2F2EC]">{dados.titulo}</p>
            {!dados.consulta && <p className="lp-display mt-2 text-2xl text-[#FFE299]">{brl}</p>}
            <p className="mt-1 text-xs text-[#B3C3B8]">{dados.areaLabel}{dados.municipio ? ` · ${dados.municipio.nome}` : ""}</p>
            <label className="mt-3 block text-sm">Velocidade <select className="ml-1 rounded bg-[#123b2a] px-1" defaultValue={1}
              onChange={e => { velocidade.current = Number(e.target.value); }}>
              {[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map(v => <option key={v} value={v}>{v.toLocaleString("pt-BR")}×</option>)}
            </select></label>
            {/* quanto o relevo sobe na imersão 3D (17/11/2026) */}
            <label className="mt-2 flex items-center gap-2 text-sm">Relevo
              <input type="range" min={0} max={3} step={0.1} value={relevo} className="w-28 accent-[#D9BD6F]"
                onChange={e => { const v = Number(e.target.value); setRelevo(v); mapRef.current?.setTerrain(v > 0 ? { source: "dem", exaggeration: v } : null); }} />
              <span className="tabular-nums text-xs">{relevo.toLocaleString("pt-BR")}×</span>
            </label>
            {dados.consulta && <label className="mt-2 block text-sm">Raio <select className="ml-1 rounded bg-[#123b2a] px-1" value={raio}
              onChange={e => setRaio(Number(e.target.value))}>
              {raios.map(m => <option key={m} value={m}>{m === 0 ? "só a área" : `até ${m < 1000 ? m + " m" : m / 1000 + " km"}`}</option>)}
            </select>{raio > 0 && <small className="block text-[#B3C3B8]">As camadas abaixo mostram o que há até {raio < 1000 ? raio + " m" : raio / 1000 + " km"} da área.</small>}</label>}
            {mapaPronto && dados.camadas && (dados.camadas.oficiais.length > 0 || dados.camadas.relevo.length > 0)
              && (dados.geometry.type === "Polygon" || dados.geometry.type === "MultiPolygon")
              && <CamadasDoTour mapa={mapaPronto} geometria={(anel?.geometry ?? dados.geometry) as GeoJSON.Polygon | GeoJSON.MultiPolygon} permitidas={dados.camadas} />}
            {mapaPronto && dados.consulta?.car && !!dados.camadas?.ambiente.length && <>
              <label className="mt-2 block text-sm"><input type="checkbox" checked={ambienteCar} onChange={e => setAmbienteCar(e.target.checked)} /> Ambiente do CAR</label>
              {ambienteCar && <div className="mt-2 max-h-[24vh] overflow-auto"><AmbienteCar cod={dados.consulta.car} mapa={mapaPronto} tour /></div>}
            </>}
            {dados.consulta && <a className="mt-2 block text-sm underline" href={voltarConsulta}>Voltar à consulta</a>}
          </div>

          {(fase === "pausado" || fase === "fim") && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
              <button
                className="rounded-full border-[1.5px] border-[#F2F2EC]/80 bg-[#0A2219]/85 text-[#F2F2EC] font-semibold px-5 py-2.5 hover:bg-[#F2F2EC] hover:text-[#124431]"
                onClick={() => controlar.current(fase === "fim")}>
                <RotateCcw className="mr-1.5 inline size-4 -translate-y-px" />{fase === "fim" ? "Repetir tour" : "Continuar tour"}
              </button>
              <a href={voltarConsulta ?? `/imovel/${dados.codigo}`}
                className="rounded-full bg-[#D80B0B] text-white font-semibold px-5 py-2.5 shadow-[0_0_0_5px_rgba(216,11,11,0.22)] hover:brightness-110">
                {dados.consulta ? "Ver a consulta" : "Ver o imóvel"}
              </a>
            </div>
          )}
          {fase === "carregando" && (
            <div className="absolute inset-0 grid place-items-center bg-[#0A2219]/80">
              <div className="text-center text-white space-y-3">
                <div className="mx-auto h-9 w-9 rounded-full border-2 border-white/25 border-t-ouro-claro animate-spin" />
                <p className="text-sm">{etapa}</p>
              </div>
            </div>
          )}
          {fase === "tocando" && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
              <button onClick={() => pausar.current()}
                className="rounded-full border-[1.5px] border-[#F2F2EC]/80 bg-[#0A2219]/85 px-4 py-1.5 text-xs font-semibold text-[#F2F2EC] hover:bg-[#F2F2EC] hover:text-[#124431]">
                Pausar
              </button>
              <p className="text-[#F2F2EC] text-xs bg-[#0A2219]/85 rounded-full px-4 py-1.5">
                {esperandoTiles ? "Aguardando as imagens do mapa…" : "Toque no mapa para explorar livremente"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
