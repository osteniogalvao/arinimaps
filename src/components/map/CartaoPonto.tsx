"use client";

/**
 * Cartão mínimo "Neste ponto" para qualquer lugar do mapa (QA 09/11).
 *
 * O cartão do clique só abria quando havia camada oficial ligada com algo no
 * ponto; quem queria mandar um lugar qualquer não tinha como. Agora:
 *  · celular: tocar e segurar ~500 ms;
 *  · computador: clique com o botão direito.
 * O cartão traz as coordenadas (graus e UTM, com botão de copiar), o
 * compartilhamento do ponto e o "Não encontrei meu imóvel aqui".
 *
 * A pressão longa não pega no desenho, na medição nem no modo loteamento
 * (o MapaRegional passa `ativo`), e o clique normal segue igual: ele só fecha
 * este cartão.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Map as MLMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { Check, Copy, Flag } from "lucide-react";
import BotaoCompartilharPonto from "@/components/map/CompartilharPonto";
import { VIDRO, BotaoFechar } from "@/components/map/UiMapa";

export type PontoLivre = { lng: number; lat: number; zoom: number };

const PRESSAO_MS = 500;
/** dedo que anda mais que isto é arrasto, não pressão longa */
const TOLERANCIA_PX = 10;

// ---------------------------------------------------------------- UTM
/** [lat, lng] → UTM no WGS 84 (série de Snyder; o inverso de utmParaGeo em lib/map/buscaRural). */
export function geoParaUtm(lat: number, lng: number) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const zona = Math.min(60, Math.floor((lng + 180) / 6) + 1);
  const lng0 = ((zona - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const phi = lat * (Math.PI / 180);
  const s = Math.sin(phi), c = Math.cos(phi), tg = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * s * s);
  const T = tg * tg, C = ep2 * c * c;
  const A = c * (lng * (Math.PI / 180) - lng0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const este = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let norte = k0 * (M + N * tg * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) norte += 10000000;
  // banda de latitude (C–X, sem I e O), 8° cada a partir de 80° S
  const bandas = "CDEFGHJKLMNPQRSTUVWX";
  const banda = bandas[Math.max(0, Math.min(bandas.length - 1, Math.floor((lat + 80) / 8)))];
  return { zona, banda, este, norte };
}

function textoUtm(lat: number, lng: number) {
  const u = geoParaUtm(lat, lng);
  return `${u.zona}${u.banda} ${Math.round(u.este)} ${Math.round(u.norte)}`;
}

// ---------------------------------------------------------------- pressão longa
/**
 * Liga a pressão longa (toque) e o botão direito (mouse) no mapa.
 * `ativo()` diz se pode abrir agora (fora do desenho/medição/loteamento).
 * `aoClicar` é chamado no clique normal, para fechar o cartão.
 */
export function usePressaoLonga(map: MLMap | null, opcoes: {
  ativo: () => boolean;
  aoPressionar: (p: PontoLivre) => void;
  aoClicar: () => void;
}) {
  const ref = useRef(opcoes);
  useEffect(() => { ref.current = opcoes; });

  useEffect(() => {
    if (!map) return;
    let timer = 0;
    let inicio: { x: number; y: number } | null = null;
    let direito: { x: number; y: number } | null = null;
    let abertoEm = 0;

    const abrir = (lng: number, lat: number) => {
      if (!ref.current.ativo()) return;
      abertoEm = Date.now();
      ref.current.aoPressionar({ lng, lat, zoom: map.getZoom() });
    };
    const cancelar = () => { window.clearTimeout(timer); timer = 0; inicio = null; };

    const toqueInicio = (e: MapTouchEvent) => {
      cancelar();
      if (e.points.length !== 1) return; // pinça: zoom, não pressão
      inicio = { x: e.point.x, y: e.point.y };
      const { lng, lat } = e.lngLat;
      timer = window.setTimeout(() => { timer = 0; inicio = null; abrir(lng, lat); }, PRESSAO_MS);
    };
    const toqueMove = (e: MapTouchEvent) => {
      if (!inicio) return;
      if (e.points.length !== 1 || Math.hypot(e.point.x - inicio.x, e.point.y - inicio.y) > TOLERANCIA_PX) cancelar();
    };
    const mouseDesce = (e: MapMouseEvent) => {
      direito = e.originalEvent.button === 2 ? { x: e.point.x, y: e.point.y } : null;
    };
    // botão direito: no Android a pressão longa também gera contextmenu (mesmo ponto, sem efeito duplo)
    const menu = (e: MapMouseEvent) => {
      e.preventDefault();
      e.originalEvent.preventDefault();
      // botão direito arrastado gira o mapa: aí não é pedido de cartão
      if (direito && Math.hypot(e.point.x - direito.x, e.point.y - direito.y) > TOLERANCIA_PX) { direito = null; return; }
      direito = null;
      if (Date.now() - abertoEm < 800) return;
      cancelar();
      abrir(e.lngLat.lng, e.lngLat.lat);
    };
    // clique normal fecha o cartão; o clique que o navegador solta logo após a pressão longa, não
    const clique = () => { if (Date.now() - abertoEm > 700) ref.current.aoClicar(); };

    map.on("touchstart", toqueInicio);
    map.on("touchmove", toqueMove);
    map.on("touchend", cancelar);
    map.on("touchcancel", cancelar);
    map.on("movestart", cancelar);
    map.on("mousedown", mouseDesce);
    map.on("contextmenu", menu);
    map.on("click", clique);
    return () => {
      cancelar();
      map.off("touchstart", toqueInicio);
      map.off("touchmove", toqueMove);
      map.off("touchend", cancelar);
      map.off("touchcancel", cancelar);
      map.off("movestart", cancelar);
      map.off("mousedown", mouseDesce);
      map.off("contextmenu", menu);
      map.off("click", clique);
    };
  }, [map]);
}

// ---------------------------------------------------------------- cartão
function LinhaCopiar({ rotulo, valor }: { rotulo: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch { /* sem permissão de área de transferência: o texto fica selecionável */ }
  };
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <dt className="text-[11px] font-bold uppercase tracking-wide text-texto-2">{rotulo}</dt>
        <dd className="select-all font-mono text-xs tabular-nums text-texto">{valor}</dd>
      </div>
      <button type="button" onClick={copiar} aria-label={`Copiar ${rotulo.toLowerCase()}`} title="Copiar"
        className="grid size-8 shrink-0 place-items-center rounded-[10px] text-texto-2 transition hover:bg-superficie-2 hover:text-verde">
        {copiado ? <Check className="size-4 text-verde" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

export default function CartaoPonto({ ponto, onFechar }: { ponto: PontoLivre; onFechar: () => void }) {
  const graus = `${ponto.lat.toFixed(6)}, ${ponto.lng.toFixed(6)}`;
  const zoom = Math.max(ponto.zoom, 15);
  const solicitar = `/cartografia/solicitar?lng=${ponto.lng.toFixed(6)}&lat=${ponto.lat.toFixed(6)}&zoom=${zoom.toFixed(1)}`;
  return (
    <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-10 w-80 max-w-[calc(100%-1.5rem)] max-h-[70%] overflow-y-auto p-5 space-y-3 ${VIDRO}`}
      role="dialog" aria-label="Neste ponto">
      <div className="flex items-start justify-between gap-3">
        <p className="lp-display text-2xl text-verde">Neste ponto</p>
        <BotaoFechar onClick={onFechar} />
      </div>
      <dl className="divide-y divide-linha rounded-xl border border-linha bg-superficie-2/60 px-3.5">
        <LinhaCopiar rotulo="Graus (lat, long)" valor={graus} />
        <LinhaCopiar rotulo="UTM (WGS 84)" valor={textoUtm(ponto.lat, ponto.lng)} />
      </dl>
      <BotaoCompartilharPonto lng={ponto.lng} lat={ponto.lat} zoom={zoom} rotulo="Compartilhar este ponto" />
      <Link href={solicitar}
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[#D9BD6F] py-2.5 text-sm font-bold text-[#124431] ring-1 ring-[#124431]/20 transition hover:brightness-105">
        <Flag className="size-3.5" /> Não encontrei meu imóvel aqui
      </Link>
    </div>
  );
}
