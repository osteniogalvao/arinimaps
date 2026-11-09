"use client";

/**
 * Modo "comparar" do mapa (roadmap 3.8): cortina vertical entre o satélite
 * atual (o próprio mapa, à esquerda) e a imagem de um ano (à direita).
 *
 * COMO. Um segundo mapa MapLibre, só com a imagem do ano, fica por cima do
 * principal e é recortado por CSS (`clip-path`) a partir da posição da cortina.
 * Ele não recebe clique nem arrasto (pointer-events: none) e copia a câmera do
 * principal a cada quadro de movimento — quem navega é sempre o mapa de baixo,
 * com todos os controles e camadas de sempre. Dois mapas sincronizados são a
 * forma mais robusta: cada um tem a sua fonte e o seu cache de tiles, sem
 * truques de shader nem dependência nova.
 */

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { carregarMaplibre } from "@/lib/map/maplibre";
import type { ImagemHistorica } from "@/lib/map/historico";
import { ChevronsLeftRight } from "lucide-react";
import { VIDRO, BotaoFechar } from "@/components/map/UiMapa";

export default function ComparaImagens({
  mapa, imagem, onFechar,
}: { mapa: MLMap; imagem: ImagemHistorica; onFechar: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const sobreRef = useRef<MLMap | null>(null);
  const [pos, setPos] = useState(50);

  // o mapa de cima: nasce uma vez por imagem escolhida
  useEffect(() => {
    let cancelado = false;
    let sobre: MLMap | undefined;
    const redimensionar = () => sobre?.resize();
    const copiarCamera = () => {
      sobre?.jumpTo({
        center: mapa.getCenter(), zoom: mapa.getZoom(), bearing: mapa.getBearing(), pitch: mapa.getPitch(),
      });
    };
    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado || !containerRef.current) return;
      sobre = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: { historico: imagem.fonte },
          layers: [
            { id: "fundo", type: "background", paint: { "background-color": "#0A2219" } },
            { id: "historico", type: "raster", source: "historico" },
          ],
        },
        center: mapa.getCenter(), zoom: mapa.getZoom(), bearing: mapa.getBearing(), pitch: mapa.getPitch(),
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
      sobreRef.current = sobre;
      mapa.on("move", copiarCamera);
      mapa.on("resize", redimensionar);
    })();
    return () => {
      cancelado = true;
      mapa.off("move", copiarCamera);
      mapa.off("resize", redimensionar);
      sobre?.remove();
      sobreRef.current = null;
    };
  }, [mapa, imagem]);

  // arrastar a cortina (mouse e toque)
  const arrastar = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const mover = (ev: PointerEvent) => {
      const caixa = caixaRef.current?.getBoundingClientRect();
      if (!caixa) return;
      setPos(Math.min(98, Math.max(2, ((ev.clientX - caixa.left) / caixa.width) * 100)));
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  return (
    // sem z-index de propósito: fica sobre o canvas do mapa, mas abaixo dos
    // controles do MapLibre (z 2) e dos chips/cartões que vêm depois no DOM
    <div ref={caixaRef} className="absolute inset-0 pointer-events-none">
      <div ref={containerRef} style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${pos}%)` }} />

      <div className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.6)]" style={{ left: `${pos}%` }}>
        <div onPointerDown={arrastar} role="slider" aria-label="Posição da cortina de comparação"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPos((p) => Math.max(2, p - 4));
            if (e.key === "ArrowRight") setPos((p) => Math.min(98, p + 4));
          }}
          className="pointer-events-auto absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-10 rounded-full bg-white text-[#124431] shadow-xl ring-4 ring-[#D9BD6F]/50 flex items-center justify-center cursor-ew-resize select-none focus:outline-none focus-visible:ring-verde">
          <ChevronsLeftRight className="size-5" />
        </div>
      </div>

      <span className="absolute bottom-40 lg:bottom-36 rounded-full border border-linha bg-superficie/95 backdrop-blur-md px-3 py-1 text-[11px] font-semibold text-texto shadow-lg"
        style={{ right: `calc(${100 - pos}% + 8px)` }}>
        Atual
      </span>
      <span className="absolute bottom-40 lg:bottom-36 rounded-full border border-linha bg-superficie/95 backdrop-blur-md px-3 py-1 text-[11px] font-semibold text-texto shadow-lg"
        style={{ left: `calc(${pos}% + 8px)` }}>
        {imagem.rotulo}
      </span>

      <div className={`pointer-events-auto absolute top-[var(--abaixo-chips,4rem)] right-14 px-4 py-3 text-xs max-w-64 space-y-1.5 ${VIDRO}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="lp-display text-lg text-verde">Comparando com {imagem.ano}</span>
          <BotaoFechar onClick={onFechar} rotulo="Sair da comparação" />
        </div>
        <p
          className="text-[10px] text-texto-2 leading-snug"
          // atribuição obrigatória da imagem do ano (o mapa de cima não tem controle próprio)
          dangerouslySetInnerHTML={{ __html: imagem.fonte.attribution ?? "" }}
        />
      </div>
    </div>
  );
}
