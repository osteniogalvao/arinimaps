"use client";

/**
 * Mapa-vitrine da página inicial: um MapLibre SEM interação que passeia em
 * loop por três cenas do Pontal — a malha rural do CAR, os lotes urbanos de
 * Iturama e os municípios da região — sobre o satélite.
 *
 * Custo: 2D (sem terreno), sem controles, vetoriais do CAR e dos lotes vindos
 * dos tiles já existentes em /api/tiles. O passeio é uma cadeia de `easeTo`
 * encadeada por `moveend` (nada de requestAnimationFrame próprio), pausa
 * quando a seção sai da tela e vira uma vista parada quando o visitante pede
 * menos movimento (prefers-reduced-motion).
 */

import { CORES_RURAIS } from "@/lib/map/camadasOficiais";
import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { SATELITE } from "@/lib/map/config";
import { RADAR_ANEL, STATUS_MAPA } from "./statusMapa";
import { CENAS } from "./cenasVitrine";

type Props = {
  /** Chamado quando a câmera chega numa cena (índice em CENAS). */
  onCena?: (indice: number) => void;
  /** Chamado quando o satélite da primeira cena está desenhado. */
  onPronto?: () => void;
  /**
   * Cena fixa (índice em CENAS), controlada por fora — usado no carrossel do
   * topo da home. Com ela, o mapa NÃO troca de cena sozinho: desliza devagar
   * pela cena e volta, em vaivém; trocar o valor voa até a nova cena.
   * Sem ela, o passeio em loop pelas cenas continua como antes.
   */
  cena?: number;
  /** false pausa a câmera (ex.: o slide atual do carrossel não é o mapa). */
  ativo?: boolean;
};

const COR_CAR = CORES_RURAIS.car;
const COR_LOTE = "#FFE299";
const COR_MUNICIPIO = "#6FB08F";

/** Deriva lenta dentro da cena. */
const DURACAO_PASSEIO = 8000;
/** Transição entre uma cena e a seguinte. */
const DURACAO_TROCA = 3500;

const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Cor do imóvel pelo status (a `cor` já vem calculada do banco; `status` é o reserva). */
const CORES_STATUS = [
  "match", ["coalesce", ["get", "cor"], ["get", "status"]],
  ...Object.entries(STATUS_MAPA).flat(),
  STATUS_MAPA.publicado,
];

const linear = (t: number) => t;
const suave = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Espera o mapa terminar de baixar e desenhar o que está na tela, com teto. */
function esperarMapa(map: MLMap, tetoMs: number) {
  return new Promise<void>((ok) => {
    if (map.loaded() && map.areTilesLoaded()) { ok(); return; }
    const fim = () => { clearTimeout(timer); map.off("idle", fim); ok(); };
    const timer = setTimeout(fim, tetoMs);
    map.on("idle", fim);
  });
}

/** Um ponto no centro da caixa de cada imóvel: de longe, o polígono vira marcador. */
function centrosDe(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const f of fc.features ?? []) {
    const pontos: number[][] = [];
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") pontos.push(c as number[]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    walk((f.geometry as { coordinates?: unknown } | null)?.coordinates);
    if (!pontos.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pontos) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [(minX + maxX) / 2, (minY + maxY) / 2] },
      properties: f.properties ?? {},
    });
  }
  return { type: "FeatureCollection", features };
}

async function pegarGeoJSON(url: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const dados = (await r.json()) as GeoJSON.FeatureCollection;
    return dados?.type === "FeatureCollection" ? dados : null;
  } catch {
    return null;
  }
}

type Controle = { definirCena: (indice: number) => void; definirAtivo: (ativo: boolean) => void };

export default function MapaVitrine({ onCena, onPronto, cena, ativo = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  // callbacks em ref: o efeito do mapa roda uma vez só e sempre chama a versão atual
  const onCenaRef = useRef(onCena);
  const onProntoRef = useRef(onPronto);
  const cenaRef = useRef(cena);
  const ativoRef = useRef(ativo);
  const controleRef = useRef<Controle | null>(null);
  useEffect(() => {
    onCenaRef.current = onCena;
    onProntoRef.current = onPronto;
  }, [onCena, onPronto]);

  // modo controlado: a cena e a pausa vêm de fora
  useEffect(() => {
    cenaRef.current = cena;
    if (cena !== undefined) controleRef.current?.definirCena(cena);
  }, [cena]);
  useEffect(() => {
    ativoRef.current = ativo;
    controleRef.current?.definirAtivo(ativo);
  }, [ativo]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    let cancelado = false;
    let mapa: MLMap | undefined;
    let observador: IntersectionObserver | undefined;
    const controlado = cenaRef.current !== undefined;
    const inicial = Math.min(Math.max(cenaRef.current ?? 0, 0), CENAS.length - 1);

    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado) return;

      const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const origem = window.location.origin;

      const estilo: StyleSpecification = {
        version: 8,
        sources: {
          satelite: SATELITE,
          car: { type: "vector", tiles: [`${origem}/api/tiles/car/{z}/{x}/{y}.pbf`], minzoom: 7, maxzoom: 13 },
          lotes: { type: "vector", tiles: [`${origem}/api/tiles/lotes/{z}/{x}/{y}.pbf`], minzoom: 15, maxzoom: 17 },
          municipios: { type: "geojson", data: VAZIO },
          imoveis: { type: "geojson", data: VAZIO },
          "imoveis-centros": { type: "geojson", data: VAZIO },
        },
        layers: [
          { id: "satelite", type: "raster", source: "satelite" },
          // malha do CAR: some na cena urbana (acima do z15 só atrapalharia os lotes)
          {
            id: "car-fill", type: "fill", source: "car", "source-layer": "car", maxzoom: 15,
            paint: { "fill-color": COR_CAR, "fill-opacity": 0.04 },
          },
          {
            id: "car-linha", type: "line", source: "car", "source-layer": "car", maxzoom: 15,
            paint: { "line-color": COR_CAR, "line-width": 0.8, "line-opacity": 0.8 },
          },
          {
            id: "lotes-linha", type: "line", source: "lotes", "source-layer": "lotes", minzoom: 15,
            paint: {
              "line-color": COR_LOTE,
              "line-width": 1,
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.45, 16, 0.9] as never,
            },
          },
          {
            id: "municipios-linha", type: "line", source: "municipios",
            paint: {
              "line-color": COR_MUNICIPIO,
              "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.6, 13, 1] as never,
              "line-opacity": 0.75,
              "line-dasharray": [3, 2],
            },
          },
          {
            id: "imoveis-fill", type: "fill", source: "imoveis",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "fill-color": CORES_STATUS as never, "fill-opacity": 0.32 },
          },
          {
            id: "imoveis-linha", type: "line", source: "imoveis",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "line-color": CORES_STATUS as never, "line-width": 3 },
          },
          {
            id: "imoveis-ponto", type: "circle", source: "imoveis",
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-color": CORES_STATUS as never, "circle-radius": 4.5,
              "circle-stroke-width": 1.5, "circle-stroke-color": RADAR_ANEL,
            },
          },
          // de longe o polígono some; cada imóvel vira um marcador na cor do status
          // radar do manual: anel Oliva em volta do ponto (sem tarjas em tamanho pequeno)
          {
            id: "imoveis-marcador-anel", type: "circle", source: "imoveis-centros", maxzoom: 12.5,
            paint: {
              "circle-color": "rgba(0,0,0,0)",
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 12, 10] as never,
              "circle-stroke-width": 1.5, "circle-stroke-color": RADAR_ANEL,
            },
          },
          {
            id: "imoveis-marcador", type: "circle", source: "imoveis-centros", maxzoom: 12.5,
            paint: {
              "circle-color": CORES_STATUS as never,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 12, 5] as never,
              "circle-stroke-width": 1.5, "circle-stroke-color": "#F2F2EC",
            },
          },
        ],
      };

      const map = new maplibregl.Map({
        container: el,
        style: estilo,
        center: CENAS[inicial].centro,
        zoom: CENAS[inicial].zoom,
        interactive: false,
        attributionControl: { compact: true },
        canvasContextAttributes: { preserveDrawingBuffer: false },
        fadeDuration: 400,
      });
      mapa = map;
      mapRef.current = map;
      // tile fora do ar ou fonte lenta não pode derrubar a vitrine: fica no silêncio
      map.on("error", () => {});

      // ---------- passeio ----------
      let atual = inicial;
      let visivel = true;
      let pronto = false;
      let ligado = ativoRef.current;
      // "volta" = no modo controlado, o retorno lento ao centro da cena (vaivém)
      let fase: "parado" | "passeio" | "troca" | "volta" = "parado";
      // `easeTo` chama `stop()` por dentro e isso dispara `moveend` de forma
      // síncrona; sem esta trava a cadeia se chamaria de novo antes de a
      // animação nova começar
      let ocupado = false;

      const mover = (proxima: typeof fase, opcoes: Parameters<MLMap["easeTo"]>[0]) => {
        fase = proxima;
        ocupado = true;
        map.easeTo(opcoes);
        ocupado = false;
      };

      /** Deriva lenta e linear pela cena atual (o "Ken Burns" do mapa). */
      const passear = () => {
        const cena = CENAS[atual];
        mover("passeio", {
          center: [cena.centro[0] + cena.deriva[0], cena.centro[1] + cena.deriva[1]],
          zoom: cena.zoom + 0.12,
          duration: DURACAO_PASSEIO,
          easing: linear,
        });
      };

      /** Vai para a cena `indice` com transição suave; ao chegar, avisa e passeia. */
      const irPara = (indice: number) => {
        atual = indice;
        const cena = CENAS[atual];
        mover("troca", { center: cena.centro, zoom: cena.zoom, duration: DURACAO_TROCA, easing: suave });
      };

      const aoTerminarMovimento = () => {
        // `resize` também dispara moveend no meio da animação: ignora enquanto a câmera anda
        if (ocupado || cancelado || !visivel || !ligado || !pronto || map.isMoving()) return;
        if (fase === "passeio") {
          if (controlado) {
            const c = CENAS[atual];
            mover("volta", { center: c.centro, zoom: c.zoom, duration: DURACAO_PASSEIO, easing: linear });
          } else irPara((atual + 1) % CENAS.length);
        }
        else if (fase === "troca") { onCenaRef.current?.(atual); passear(); }
        else if (fase === "volta") passear();
      };
      map.on("moveend", aoTerminarMovimento);

      // pausa fora da tela, retoma quando volta
      if ("IntersectionObserver" in window && !reduzido) {
        observador = new IntersectionObserver((entradas) => {
          const agora = entradas.some((e) => e.isIntersecting);
          if (agora === visivel) return;
          visivel = agora;
          if (!visivel) { map.stop(); fase = "parado"; return; }
          if (pronto && ligado && !map.isMoving()) irPara(atual);
        }, { threshold: 0.05 });
        observador.observe(el);
      }

      controleRef.current = {
        definirCena(indice) {
          const i = Math.min(Math.max(indice, 0), CENAS.length - 1);
          if (i === atual && fase !== "parado") return;
          atual = i;
          if (!pronto) { map.jumpTo({ center: CENAS[i].centro, zoom: CENAS[i].zoom }); return; }
          if (reduzido) { map.jumpTo({ center: CENAS[i].centro, zoom: CENAS[i].zoom }); onCenaRef.current?.(i); return; }
          if (visivel && ligado) irPara(i);
          else { fase = "parado"; map.jumpTo({ center: CENAS[i].centro, zoom: CENAS[i].zoom }); }
        },
        definirAtivo(v) {
          if (v === ligado) return;
          ligado = v;
          if (!v) { map.stop(); fase = "parado"; return; }
          if (pronto && visivel && !reduzido && !map.isMoving()) irPara(atual);
        },
      };

      map.on("load", async () => {
        const [municipios, imoveis] = await Promise.all([
          pegarGeoJSON("/api/geo/municipios"),
          pegarGeoJSON("/api/geo/imoveis"),
        ]);
        if (cancelado) return;
        if (municipios) (map.getSource("municipios") as GeoJSONSource | undefined)?.setData(municipios);
        if (imoveis) {
          (map.getSource("imoveis") as GeoJSONSource | undefined)?.setData(imoveis);
          (map.getSource("imoveis-centros") as GeoJSONSource | undefined)?.setData(centrosDe(imoveis));
        }

        // só mostra (e só começa a andar) com o satélite da primeira cena desenhado.
        // O teto de 5 s não basta para mostrar: numa conexão lenta ele vencia com
        // os ladrilhos ainda chegando e o mapa preto cobria a foto do slide (visto
        // na revisão de 08/10). Passado o teto, continua esperando o "idle" — se o
        // satélite nunca chegar, a foto simplesmente fica.
        await esperarMapa(map, 5000);
        while (!cancelado && !map.areTilesLoaded()) {
          await new Promise<void>((ok) => map.once("idle", () => ok()));
        }
        if (cancelado) return;
        pronto = true;
        onProntoRef.current?.();
        onCenaRef.current?.(atual);
        if (reduzido) return; // vista parada da cena inicial
        if (visivel && ligado) passear();
      });
    })();

    return () => {
      cancelado = true;
      controleRef.current = null;
      observador?.disconnect();
      mapa?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
