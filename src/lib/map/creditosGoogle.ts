"use client";

import type { IControl, Map as MLMap } from "maplibre-gl";

/**
 * Logo do Google + crédito das imagens da área da tela, exigidos pelos termos
 * do Google Maps Platform quando o satélite vem da Map Tiles API num mapa que
 * não é o do Google (Tile API policies: "Google Maps logo" e "Data
 * attribution"). Aparece só enquanto a fonte "satelite" (Google) está visível
 * e é atualizado a cada movimento do mapa. Não pode ser coberto por outro logo.
 */
const LOGO = "https://maps.gstatic.com/mapfiles/api-3/images/google_white5_hdpi.png";

function sateliteVisivel(map: MLMap) {
  const camadas = map.getStyle()?.layers ?? [];
  return camadas.some((l) => "source" in l && l.source === "satelite" && l.layout?.visibility !== "none");
}

class CreditosGoogle implements IControl {
  private caixa = document.createElement("div");
  private texto = document.createElement("span");
  private map: MLMap | null = null;
  private espera: ReturnType<typeof setTimeout> | undefined;
  private pedido: AbortController | null = null;
  private ultimo = "";

  onAdd(map: MLMap) {
    this.map = map;
    this.caixa.className = "maplibregl-ctrl";
    this.caixa.style.cssText = "display:none;align-items:center;gap:6px;margin:0 0 4px 6px;pointer-events:none;" +
      "font:11px/1.2 Roboto,Arial,sans-serif;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000";
    const logo = document.createElement("img");
    logo.src = LOGO;
    logo.alt = "Google";
    logo.width = 59;
    logo.height = 18;
    this.caixa.append(logo, this.texto);
    map.on("moveend", this.atualizar);
    map.on("styledata", this.atualizar);
    this.atualizar();
    return this.caixa;
  }

  onRemove() {
    this.map?.off("moveend", this.atualizar);
    this.map?.off("styledata", this.atualizar);
    this.pedido?.abort();
    clearTimeout(this.espera);
    this.caixa.remove();
    this.map = null;
  }

  private atualizar = () => {
    clearTimeout(this.espera);
    this.espera = setTimeout(() => void this.buscar(), 250);
  };

  private async buscar() {
    const map = this.map;
    if (!map) return;
    const visivel = sateliteVisivel(map);
    this.caixa.style.display = visivel ? "flex" : "none";
    if (!visivel) return;
    const b = map.getBounds();
    const q = new URLSearchParams({
      z: String(Math.max(0, Math.min(22, Math.round(map.getZoom() + 1)))),
      n: b.getNorth().toFixed(4), s: b.getSouth().toFixed(4),
      e: b.getEast().toFixed(4), w: b.getWest().toFixed(4),
    }).toString();
    if (q === this.ultimo) return;
    this.pedido?.abort();
    this.pedido = new AbortController();
    try {
      const r = await fetch(`/api/satelite/google/creditos?${q}`, { signal: this.pedido.signal });
      if (!r.ok) return;
      const { copyright } = (await r.json()) as { copyright?: string };
      this.texto.textContent = copyright || "Imagens © Google";
      this.ultimo = q;
    } catch { /* mantém o último crédito */ }
  }
}

/** Liga o controle de créditos do Google num mapa (uma vez por mapa). */
export function ligarCreditosGoogle(map: MLMap) {
  map.addControl(new CreditosGoogle(), "bottom-left");
}
