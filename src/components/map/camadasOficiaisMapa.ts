"use client";

import type { Map as MLMap, GeoJSONSource, PointLike } from "maplibre-gl";
import { CAMADAS_OFICIAIS, camadaOficialPorId, type CamadaOficialId } from "@/lib/map/camadasOficiais";

/**
 * Camadas oficiais no mapa (SIGEF, embargos, ANM, FUNAI, UCs, quilombolas,
 * PRODES, focos de queimada) — o lado do navegador.
 *
 * Fluidez: cada camada pede só a janela da tela, só a partir do seu zoom
 * mínimo, 400 ms depois que o mapa PARA (arrastar não dispara pedido), e o
 * pedido anterior da mesma camada é cancelado quando a tela muda de novo. O
 * servidor responde do cache por célula; o órgão só é consultado quando a
 * célula ainda não foi vista ou venceu.
 */
export type EstadoCamada = { carregando: boolean; aviso: string; total: number };
export type FeicaoNoPonto = { camada: CamadaOficialId; props: Record<string, unknown> };

const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const fonte = (id: string) => `of-${id}`;
const camadasDe = (id: string) => [`of-${id}-fill`, `of-${id}-linha`, `of-${id}-ponto`];

export class GerenciadorCamadasOficiais {
  private ativas = new Set<CamadaOficialId>();
  private pedidos = new Map<CamadaOficialId, AbortController>();
  private estado: Partial<Record<CamadaOficialId, EstadoCamada>> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private aoMover = () => this.agendar();

  constructor(private map: MLMap, private aoMudar: (e: Partial<Record<CamadaOficialId, EstadoCamada>>) => void) {
    map.on("moveend", this.aoMover);
  }

  destruir() {
    this.map.off("moveend", this.aoMover);
    if (this.timer) clearTimeout(this.timer);
    this.pedidos.forEach((p) => p.abort());
  }

  estaAtiva = (id: CamadaOficialId) => this.ativas.has(id);

  alternar(id: CamadaOficialId, ligar = !this.ativas.has(id)) {
    if (ligar) {
      this.ativas.add(id);
      this.criar(id);
      this.visivel(id, true);
      void this.atualizar(id);
    } else {
      this.ativas.delete(id);
      this.pedidos.get(id)?.abort();
      this.visivel(id, false);
      delete this.estado[id];
      this.aoMudar({ ...this.estado });
    }
  }

  /** Tudo o que as camadas ligadas têm no ponto clicado (para o cartão do clique). */
  noPonto(ponto: PointLike): FeicaoNoPonto[] {
    const layers = [...this.ativas].flatMap(camadasDe).filter((l) => this.map.getLayer(l) && !l.endsWith("-linha"));
    if (!layers.length) return [];
    const vistas = new Set<string>();
    const pad = 4; // focos são pontos pequenos: tolera o dedo/mouse
    const p = ponto as [number, number] | { x: number; y: number };
    const [x, y] = Array.isArray(p) ? p : [p.x, p.y];
    return this.map.queryRenderedFeatures([[x - pad, y - pad], [x + pad, y + pad]], { layers }).flatMap((f) => {
      const camada = f.source.replace(/^of-/, "") as CamadaOficialId;
      const chave = `${camada}:${f.properties?.id ?? JSON.stringify(f.properties)}`;
      if (vistas.has(chave)) return [];
      vistas.add(chave);
      return [{ camada, props: f.properties ?? {} }];
    });
  }

  private agendar() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ativas.forEach((id) => void this.atualizar(id)), 400);
  }

  private criar(id: CamadaOficialId) {
    const def = camadaOficialPorId(id)!;
    if (this.map.getSource(fonte(id))) return;
    this.map.addSource(fonte(id), { type: "geojson", data: VAZIO, promoteId: "id" });
    // por baixo dos anúncios: quem está à venda continua clicável por cima
    const antes = ["imoveis-fill", "imoveis-ponto", "imoveis-marcador"].find((l) => this.map.getLayer(l));
    if (def.ponto) {
      this.map.addLayer({
        id: `of-${id}-ponto`, type: "circle", source: fonte(id),
        paint: {
          "circle-color": def.cor,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 14, 5] as never,
          "circle-stroke-color": "#1A0A00", "circle-stroke-width": 1, "circle-opacity": 0.9,
        },
      }, antes);
      return;
    }
    // cor por bioma (ou por outro valor de `nome`): expressão match do MapLibre
    const corFill = def.cores
      ? (["match", ["get", "nome"], ...Object.entries(def.cores).flat(), def.cor] as never)
      : def.cor;
    this.map.addLayer({
      id: `of-${id}-fill`, type: "fill", source: fonte(id),
      // sem antisserrilhado na camada recortada em células: senão a emenda entre células vira um fio
      paint: { "fill-color": corFill, "fill-opacity": def.semContorno ? 0.24 : 0.16, ...(def.semContorno ? { "fill-antialias": false } : {}) },
    }, antes);
    if (def.semContorno) return;
    this.map.addLayer({
      id: `of-${id}-linha`, type: "line", source: fonte(id),
      paint: {
        "line-color": def.cor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 14, 2.2] as never,
        ...(id === "sigef" ? { "line-dasharray": [3, 1.5] as never } : {}),
      },
    }, antes);
  }

  private visivel(id: CamadaOficialId, sim: boolean) {
    for (const l of camadasDe(id)) if (this.map.getLayer(l)) this.map.setLayoutProperty(l, "visibility", sim ? "visible" : "none");
  }

  private definir(id: CamadaOficialId, e: Partial<EstadoCamada>) {
    this.estado[id] = { carregando: false, aviso: "", total: 0, ...this.estado[id], ...e };
    this.aoMudar({ ...this.estado });
  }

  private async atualizar(id: CamadaOficialId) {
    if (!this.ativas.has(id)) return;
    const def = camadaOficialPorId(id)!;
    const fonteAtual = () => this.map.getSource(fonte(id)) as GeoJSONSource | undefined;
    if (this.map.getZoom() < def.zoomMin) {
      this.pedidos.get(id)?.abort();
      fonteAtual()?.setData(VAZIO);
      this.definir(id, { carregando: false, total: 0, aviso: "Aproxime o mapa para ver esta camada." });
      return;
    }
    this.pedidos.get(id)?.abort();
    const ctrl = new AbortController();
    this.pedidos.set(id, ctrl);
    this.definir(id, { carregando: true, aviso: "" });
    const b = this.map.getBounds();
    try {
      const r = await fetch(`/api/camadas/${id}?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(4)).join(",")}`,
        { signal: ctrl.signal });
      const j = await r.json().catch(() => null) as (GeoJSON.FeatureCollection & { falhas?: number; error?: string }) | null;
      if (ctrl.signal.aborted) return;
      if (!r.ok || !j?.features) {
        this.definir(id, { carregando: false, aviso: j?.error ?? "O órgão não respondeu agora." });
        return;
      }
      fonteAtual()?.setData(j);
      this.definir(id, {
        carregando: false, total: j.features.length,
        aviso: j.falhas ? "Parte da área não carregou: o órgão não respondeu. Tente de novo em instantes." : "",
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") this.definir(id, { carregando: false, aviso: "Falha de conexão ao carregar a camada." });
    }
  }
}

export { CAMADAS_OFICIAIS };
