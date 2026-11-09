"use client";

import { useEffect } from "react";
import type { Map as MLMap } from "maplibre-gl";
import EnviarWhatsApp from "@/components/compartilhar/EnviarWhatsApp";
import { carregarMaplibre } from "@/lib/map/maplibre";

/**
 * Compartilhar um ponto do mapa (segunda etapa, item 6).
 *
 * O link é /mapa#pos=zoom/lat/lng&marcador=lat,lng: o `pos` é o hash que o
 * MapLibre já lê e escreve (MapaRegional, `hash: "pos"`), e o `marcador` fica
 * ao lado dele no mesmo hash — o MapLibre preserva as outras partes ao
 * atualizar a posição. O <MarcadorDaUrl> desenha o pino de quem recebe.
 *
 * Plugar no MapaRegional.tsx (não editado aqui, outro agente está nele):
 *   1. no cartão "Neste ponto" do clique no mapa:
 *        <BotaoCompartilharPonto lng={…} lat={…} zoom={map.getZoom()} />
 *   2. uma vez, depois que o mapa existir:
 *        <MarcadorDaUrl map={mapRef.current} />
 */

const casas = (n: number, d: number) => Number(n.toFixed(d));

export function linkDoPonto(lng: number, lat: number, zoom: number) {
  const z = casas(Math.max(3, Math.min(20, zoom)), 2);
  const la = casas(lat, 6);
  const lo = casas(lng, 6);
  return `/mapa#pos=${z}/${la}/${lo}&marcador=${la},${lo}`;
}

export default function BotaoCompartilharPonto({ lng, lat, zoom = 16, className, rotulo = "Enviar pelo WhatsApp" }: {
  lng: number; lat: number; zoom?: number; className?: string; rotulo?: string;
}) {
  const coordenadas = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return (
    <EnviarWhatsApp
      caminho={linkDoPonto(lng, lat, zoom)}
      titulo="Ponto no mapa da Arini"
      texto={`Ponto no mapa da Arini (${coordenadas}):`}
      rotulo={rotulo}
      paraCima
      className={className ?? "flex w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-verde py-2.5 text-sm font-bold text-verde transition hover:bg-verde hover:text-fundo"}
    />
  );
}

/** Lê `marcador=lat,lng` do hash da URL. */
function marcadorDoHash(): [number, number] | null {
  const parte = window.location.hash.replace(/^#/, "").split("&").find((p) => p.startsWith("marcador="));
  const [lat, lng] = (parte?.slice("marcador=".length) ?? "").split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

/** Pino do ponto compartilhado (link com &marcador=), no Verde Arini. Não renderiza nada no DOM do React. */
export function MarcadorDaUrl({ map }: { map: MLMap | null | undefined }) {
  useEffect(() => {
    if (!map) return;
    let vivo = true;
    let marcador: { remove(): void } | null = null;
    const desenhar = async () => {
      const ponto = marcadorDoHash();
      marcador?.remove(); marcador = null;
      if (!ponto) return;
      const maplibregl = await carregarMaplibre();
      if (!vivo) return;
      marcador = new maplibregl.Marker({ color: "#124431" }).setLngLat(ponto).addTo(map);
    };
    void desenhar();
    window.addEventListener("hashchange", desenhar);
    return () => { vivo = false; window.removeEventListener("hashchange", desenhar); marcador?.remove(); };
  }, [map]);
  return null;
}
