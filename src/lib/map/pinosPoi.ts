"use client";

/**
 * Pinos dos pontos de referência do entorno (pedido do Stenio, 17/11/2026:
 * "o que tem em volta do lote — casa, mercado etc. — com ícones bonitos, com
 * vida"). Cada ponto vira um pino HTML: bolinha na cor da categoria com o
 * ícone branco, entrada com quique em sequência, um halo que pulsa devagar e
 * a etiqueta com nome e distância (fixa ou ao passar o mouse/tocar).
 *
 * HTML em vez de camada "symbol" do MapLibre: não depende de sprite nem de
 * fonte remota, e sai igual no vídeo gravado do tour. O estilo está em
 * globals.css (.poi-pino).
 */

import type { Map as MLMap, Marker } from "maplibre-gl";
import { carregarMaplibre } from "./maplibre";
import { svgPoi, visualPoi } from "@/lib/geo/poiVisual";
import { formatDistancia, nomePoi } from "@/lib/geo/distancia";
import { escaparHtml } from "@/lib/seguranca/html";

export type PoiNoMapa = {
  nome: string | null;
  categoria: string;
  lng: number;
  lat: number;
  distancia_m?: number | null;
  destaque?: boolean;
};


/** Abaixo deste zoom os pinos do entorno ficam escondidos (de longe se amontoam). */
export const ZOOM_MIN_PINOS_POI = 12;

/** Elemento do pino. `etiqueta`: "fixa" (sempre à mostra) ou "hover". */
export function elementoPinoPoi(p: PoiNoMapa, { etiqueta = "hover", ordem = 0 }: { etiqueta?: "fixa" | "hover"; ordem?: number } = {}): HTMLElement {
  const v = visualPoi(p.categoria);
  const nome = nomePoi(p.nome) ?? v.rotulo;
  const el = document.createElement("div");
  el.className = "poi-pino" + (etiqueta === "fixa" ? " poi-pino-fixo" : "");
  el.style.setProperty("--poi-cor", v.cor);
  // entrada em sequência (efeito cascata) e halos fora de fase
  el.style.setProperty("--poi-atraso", `${Math.min(ordem, 24) * 70}ms`);
  el.style.setProperty("--poi-fase", `${(ordem * 0.37) % 2.4}s`);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `${nome}${p.distancia_m != null ? `, a ${formatDistancia(p.distancia_m)}` : ""}`);
  el.tabIndex = 0;
  el.innerHTML =
    `<span class="poi-pino-halo"></span>` +
    `<span class="poi-pino-bola">${svgPoi(p.categoria, { tamanho: 15 })}</span>` +
    `<span class="poi-pino-etiqueta"><b>${escaparHtml(nome)}</b>` +
    // com nome, a 2ª linha diz o que é; sem nome, o título já é a categoria
    `<span>${[nomePoi(p.nome) ? escaparHtml(v.rotulo) : "", p.distancia_m != null ? formatDistancia(p.distancia_m) : ""].filter(Boolean).join(" · ")}</span>` +
    `</span>`;
  // toque no celular: abre e fecha a etiqueta
  el.addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("poi-pino-aberto"); });
  return el;
}

/**
 * Põe os pinos no mapa e devolve a função que tira. Os `fixos` primeiros
 * (destaques e mais próximos) ganham a etiqueta sempre à mostra.
 */
export async function adicionarPinosPoi(map: MLMap, pois: PoiNoMapa[], { fixos = 0 }: { fixos?: number } = {}): Promise<() => void> {
  const maplibregl = await carregarMaplibre();
  const ordenados = [...pois]
    .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
    .sort((a, b) => Number(!!b.destaque) - Number(!!a.destaque) || Number(a.distancia_m ?? 0) - Number(b.distancia_m ?? 0));
  // 18/11/2026 (Stenio: "ícones grandes quando afasto o zoom"): o pino vai DENTRO de um
  // invólucro. O MapLibre posiciona o marcador com `transform` e `position: absolute` no
  // próprio elemento; o .poi-pino tinha `position: relative` e a animação de entrada
  // (`transform`, preenchimento "both"), que passavam por cima disso e empilhavam os
  // pinos numa coluna fora do lugar. Agora o invólucro é do MapLibre e o pino só anima.
  const marcadores: Marker[] = ordenados.map((p, i) => {
    const involucro = document.createElement("div");
    involucro.className = "poi-pino-marcador";
    involucro.appendChild(elementoPinoPoi(p, { etiqueta: i < fixos ? "fixa" : "hover", ordem: i }));
    return new maplibregl.Marker({ element: involucro, anchor: "bottom" })
      .setLngLat([p.lng, p.lat])
      .addTo(map);
  });
  // de longe (visão regional) os pinos do entorno saem: viram um borrão sobre o imóvel
  const conferirZoom = () => {
    const longe = map.getZoom() < ZOOM_MIN_PINOS_POI;
    for (const m of marcadores) m.getElement().style.visibility = longe ? "hidden" : "";
  };
  conferirZoom();
  map.on("zoom", conferirZoom);
  return () => {
    map.off("zoom", conferirZoom);
    for (const m of marcadores) m.remove();
  };
}
