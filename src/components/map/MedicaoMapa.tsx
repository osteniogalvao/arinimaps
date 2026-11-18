"use client";

/**
 * Régua do Tour 3D e do mapa da consulta (vídeo do Carlos, 17/11/2026, 22h00:
 * "precisava que as ferramentas de medição estivessem aqui no 3D; aqui é um
 * morro, eu consigo medir a distância desse morro").
 *
 * Distância e área com a mesma geodésia das ferramentas do mapa principal
 * (distanciaM e areaPoligonoM2). No 3D o clique cai no terreno, então cada
 * vértice também tem altitude: a régua mostra a altitude do primeiro e do
 * último ponto e o desnível entre eles.
 */

import { useEffect, useState } from "react";
import type { Map as MLMap, MapMouseEvent, GeoJSONSource } from "maplibre-gl";
import Link from "next/link";
import { Lock, MoveHorizontal, Triangle, X } from "lucide-react";
import { distanciaM, formatDistancia } from "@/lib/geo/distancia";
import { areaPoligonoM2 } from "@/lib/geo/areaGeodesica";
import { marcarMedicao } from "./InfoNoPonto";

type Modo = null | "distancia" | "area";
const FONTE = "medicao-tour";
const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const COR = "#FFE299";

const fmtArea = (m2: number) => m2 >= 10_000
  ? `${(m2 / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha (${(m2 / 48_400).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} alq.)`
  : `${Math.round(m2).toLocaleString("pt-BR")} m²`;

function geojson(pontos: [number, number][], modo: Modo): GeoJSON.FeatureCollection {
  const feats: GeoJSON.Feature[] = pontos.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} }));
  if (pontos.length >= 2) {
    const linha = modo === "area" && pontos.length >= 3 ? [...pontos, pontos[0]] : pontos;
    feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: linha }, properties: {} });
  }
  if (modo === "area" && pontos.length >= 3) {
    feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...pontos, pontos[0]]] }, properties: {} });
  }
  return { type: "FeatureCollection", features: feats };
}

export default function MedicaoMapa({ mapa, escuro = false, liberado = true }: {
  mapa: MLMap; escuro?: boolean;
  /**
   * Plano sem "Medir área e distância": a régua continua à vista, bloqueada,
   * com o caminho para aumentar o plano (áudio do Carlos, 17/11/2026, 22h14:
   * "deixar todas as funcionalidades visíveis, com bloqueio").
   */
  liberado?: boolean;
}) {
  const [modo, setModo] = useState<Modo>(null);
  const [pontos, setPontos] = useState<[number, number][]>([]);
  const [alturas, setAlturas] = useState<(number | null)[]>([]);

  // camadas da régua
  useEffect(() => {
    const instalar = () => {
      if (mapa.getSource(FONTE)) return;
      mapa.addSource(FONTE, { type: "geojson", data: VAZIO });
      mapa.addLayer({ id: "medicao-area", type: "fill", source: FONTE, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": COR, "fill-opacity": 0.18 } });
      mapa.addLayer({ id: "medicao-linha", type: "line", source: FONTE, filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": COR, "line-width": 3, "line-dasharray": [2, 1] }, layout: { "line-cap": "round" } });
      mapa.addLayer({ id: "medicao-ponto", type: "circle", source: FONTE, filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-color": COR, "circle-radius": 5, "circle-stroke-color": "#0A2219", "circle-stroke-width": 2 } });
    };
    if (mapa.isStyleLoaded()) instalar(); else mapa.once("load", instalar);
    return () => {
      mapa.off("load", instalar);
      marcarMedicao(mapa, false);
      if (!mapa.getStyle()) return;
      for (const id of ["medicao-ponto", "medicao-linha", "medicao-area"]) if (mapa.getLayer(id)) mapa.removeLayer(id);
      if (mapa.getSource(FONTE)) mapa.removeSource(FONTE);
    };
  }, [mapa]);

  useEffect(() => {
    (mapa.getSource(FONTE) as GeoJSONSource | undefined)?.setData(geojson(pontos, modo));
  }, [mapa, pontos, modo]);

  // clique = vértice; enquanto mede, o cartão "Neste ponto" não abre
  useEffect(() => {
    marcarMedicao(mapa, !!modo);
    if (!modo) return;
    const canvas = mapa.getCanvas();
    canvas.style.cursor = "crosshair";
    const zoomDuplo = mapa.doubleClickZoom.isEnabled();
    mapa.doubleClickZoom.disable();
    const clique = (e: MapMouseEvent) => {
      const c: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      setPontos((p) => [...p, c]);
      // no 3D o terreno já está carregado: a altitude vem do próprio mapa
      const h = mapa.getTerrain() ? mapa.queryTerrainElevation(e.lngLat) : null;
      const exagero = mapa.getTerrain()?.exaggeration || 1;
      setAlturas((a) => [...a, h == null ? null : h / exagero]);
    };
    mapa.on("click", clique);
    return () => {
      mapa.off("click", clique);
      canvas.style.cursor = "";
      if (zoomDuplo) mapa.doubleClickZoom.enable();
    };
  }, [mapa, modo]);

  const escolher = (m: Modo) => { setModo((atual) => (atual === m ? null : m)); setPontos([]); setAlturas([]); };
  const limpar = () => { setPontos([]); setAlturas([]); };

  let resultado = "";
  if (modo === "distancia" && pontos.length >= 2) {
    let total = 0;
    for (let i = 1; i < pontos.length; i++) total += distanciaM(pontos[i - 1], pontos[i]);
    resultado = formatDistancia(total);
  } else if (modo === "area" && pontos.length >= 3) {
    let per = 0;
    for (let i = 0; i < pontos.length; i++) per += distanciaM(pontos[i], pontos[(i + 1) % pontos.length]);
    resultado = `${fmtArea(areaPoligonoM2([[...pontos, pontos[0]]]))} · perímetro ${formatDistancia(per)}`;
  }
  const h0 = alturas[0], h1 = alturas[alturas.length - 1];
  const desnivel = modo === "distancia" && pontos.length >= 2 && h0 != null && h1 != null
    ? `Altitude ${Math.round(h0)} m → ${Math.round(h1)} m · desnível ${Math.round(Math.abs(h1 - h0))} m` : "";

  if (!liberado) return (
    <div className="mt-3 space-y-2 text-sm">
      <p className={"text-[10px] font-semibold uppercase tracking-[0.2em] " + (escuro ? "text-[#D3DCD2]" : "text-texto-2")}>Medir no mapa</p>
      <div className="flex flex-wrap items-center gap-2 opacity-80">
        <span className={"inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold " + (escuro ? "border-[#F2F2EC]/30 text-[#F2F2EC]/70" : "border-linha text-texto-2")}><Lock className="size-3.5" /> Distância</span>
        <span className={"inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold " + (escuro ? "border-[#F2F2EC]/30 text-[#F2F2EC]/70" : "border-linha text-texto-2")}><Lock className="size-3.5" /> Área</span>
      </div>
      <p className={"text-xs " + (escuro ? "text-[#B3C3B8]" : "text-texto-2")}>A medição não está no seu plano. <Link href="/planos" className="font-semibold underline">Ver planos</Link></p>
    </div>
  );

  const botao = (ativo: boolean) => "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition " + (ativo
    ? "border-[#D9BD6F] bg-[#D9BD6F] text-[#0A2219]"
    : escuro ? "border-[#F2F2EC]/40 text-[#F2F2EC] hover:border-[#D9BD6F]" : "border-linha text-texto hover:border-verde");
  return (
    <div className="mt-3 space-y-2 text-sm">
      <p className={"text-[10px] font-semibold uppercase tracking-[0.2em] " + (escuro ? "text-[#D3DCD2]" : "text-texto-2")}>Medir no mapa</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={modo === "distancia"} className={botao(modo === "distancia")} onClick={() => escolher("distancia")}>
          <MoveHorizontal className="size-3.5" /> Distância
        </button>
        <button type="button" aria-pressed={modo === "area"} className={botao(modo === "area")} onClick={() => escolher("area")}>
          <Triangle className="size-3.5" /> Área
        </button>
        {modo && <button type="button" className={botao(false)} onClick={() => escolher(null)}><X className="size-3.5" /> Sair</button>}
      </div>
      {modo && (
        <div aria-live="polite" className={"rounded-xl px-3 py-2 text-xs " + (escuro ? "bg-[#123b2a] text-[#F2F2EC]" : "bg-superficie-2 text-texto")}>
          {resultado ? <p className="text-base font-bold">{resultado}</p>
            : <p>{modo === "distancia" ? "Toque em dois ou mais pontos no mapa." : "Toque nos cantos da área (três ou mais)."}</p>}
          {desnivel && <p className="mt-0.5">{desnivel}</p>}
          {pontos.length > 0 && <button type="button" className="mt-1 underline" onClick={limpar}>Recomeçar</button>}
        </div>
      )}
    </div>
  );
}
