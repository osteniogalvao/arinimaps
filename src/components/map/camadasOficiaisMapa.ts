"use client";

import type { Map as MLMap, GeoJSONSource, PointLike } from "maplibre-gl";
import { CAMADAS_OFICIAIS, camadaOficialPorId, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import type { RelevoId } from "./camadasRelevo";

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
export type AreaCamadas = {
  id: string; nome: string; geometria: GeoJSON.Polygon; camadas: ReadonlySet<CamadaOficialId>; car: boolean; relevo: Set<RelevoId>;
};

const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const fonte = (id: string) => `of-${id}`;
const camadasDe = (id: string) => [`of-${id}-fill`, `of-${id}-linha`, `of-${id}-ponto`, `of-${id}-traco`];

export function recortarEmWorker(dados: GeoJSON.FeatureCollection, areas: GeoJSON.Polygon[], signal: AbortSignal, contorno: boolean, car = false) {
  return new Promise<GeoJSON.FeatureCollection>((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./recorteCamadas.worker.ts", import.meta.url));
    const abortar = () => { worker.terminate(); reject(signal.reason); };
    signal.addEventListener("abort", abortar, { once: true });
    const encerrar = () => { worker.terminate(); signal.removeEventListener("abort", abortar); };
    worker.onmessage = ({ data }) => {
      encerrar();
      if (data.erro) reject(new Error(data.erro));
      else resolve(data.dados);
    };
    worker.onerror = () => { encerrar(); reject(new Error("Não foi possível recortar a geometria desta camada.")); };
    worker.postMessage({ dados, areas, contorno, car });
  });
}

export class GerenciadorCamadasOficiais {
  // null desenha no mapa inteiro; uma lista desenha só nos polígonos indicados.
  private ativas = new Map<CamadaOficialId, GeoJSON.Polygon[] | null>();
  private pedidos = new Map<CamadaOficialId, AbortController>();
  private estado: Partial<Record<CamadaOficialId, EstadoCamada>> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private aoMover = () => this.agendar();

  constructor(private map: MLMap, private aoMudar: (e: Partial<Record<CamadaOficialId, EstadoCamada>>) => void, private areaFixa = false) {
    if (!areaFixa) map.on("moveend", this.aoMover);
  }

  destruir() {
    this.map.off("moveend", this.aoMover);
    if (this.timer) clearTimeout(this.timer);
    this.pedidos.forEach((p) => p.abort());
  }

  atualizarSelecao(globais: ReadonlySet<CamadaOficialId>, areas: AreaCamadas[]) {
    for (const { id } of CAMADAS_OFICIAIS) {
      const antes = this.ativas.get(id);
      const recortes = globais.has(id) ? null : areas.filter(a => a.camadas.has(id)).map(a => a.geometria);
      if (recortes?.length === 0) {
        if (antes === undefined) continue;
        this.ativas.delete(id);
        this.pedidos.get(id)?.abort();
        this.visivel(id, false);
        delete this.estado[id];
        this.aoMudar({ ...this.estado });
        continue;
      }
      if (antes === recortes || (antes && recortes && antes.length === recortes.length && antes.every((a, i) => a === recortes[i]))) continue;
      this.ativas.set(id, recortes);
      this.criar(id);
      const linha = `of-${id}-linha`;
      if (this.map.getLayer(linha)) this.map.setFilter(linha, recortes ? ["==", ["geometry-type"], "LineString"] : null);
      // Um pedido em voo pode ter a cobertura anterior, inclusive a cidade inteira.
      (this.map.getSource(fonte(id)) as GeoJSONSource).setData(VAZIO);
      this.visivel(id, true);
      void this.atualizar(id);
    }
  }

  /** Tudo o que as camadas ligadas têm no ponto clicado (para o cartão do clique). */
  noPonto(ponto: PointLike): FeicaoNoPonto[] {
    const layers = [...this.ativas.keys()].flatMap(camadasDe).filter((l) => this.map.getLayer(l) && !l.endsWith("-linha"));
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
    this.timer = setTimeout(() => this.ativas.forEach((_, id) => void this.atualizar(id)), 400);
  }

  private criar(id: CamadaOficialId) {
    const def = camadaOficialPorId(id)!;
    if (this.map.getSource(fonte(id))) return;
    this.map.addSource(fonte(id), { type: "geojson", data: VAZIO, promoteId: "id" });
    // por baixo dos anúncios: quem está à venda continua clicável por cima
    const antes = ["imoveis-fill", "imoveis-ponto", "imoveis-marcador"].find((l) => this.map.getLayer(l));
    if (def.linha) {
      // rede de linhas: o traço é a própria feição (clicável); subestação ou ponto da mesma fonte vira círculo
      this.map.addLayer({
        id: `of-${id}-traco`, type: "line", source: fonte(id),
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]] as never,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": def.cor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 13, 2.6, 16, 3.6] as never,
          "line-opacity": 0.95,
        },
      }, antes);
      this.map.addLayer({
        id: `of-${id}-ponto`, type: "circle", source: fonte(id),
        filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]] as never,
        paint: { "circle-color": def.cor, "circle-radius": 5, "circle-stroke-color": "#111111", "circle-stroke-width": 1.5 },
      }, antes);
      return;
    }
    if (def.ponto) {
      this.map.addLayer({
        id: `of-${id}-ponto`, type: "circle", source: fonte(id),
        paint: {
          "circle-color": def.cor,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 14, 6.5] as never,
          "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 1.5, "circle-opacity": 1,
        },
      }, antes);
      return;
    }
    if (def.misto) {
      // fonte achada pelo nome: pode vir ponto (aeródromo, auto de infração) junto com polígono
      this.map.addLayer({
        id: `of-${id}-ponto`, type: "circle", source: fonte(id),
        filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]] as never,
        paint: { "circle-color": def.cor, "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 6.5] as never,
          "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 1.5 },
      }, antes);
    }
    // cor por bioma (ou por outro valor de `nome`): expressão match do MapLibre
    const corFill = def.cores
      ? (["match", ["get", "nome"], ...Object.entries(def.cores).flat(), def.cor] as never)
      : def.cor;
    // Nas malhas de parcelas a divisa identifica o cadastro. A imagem continua
    // legível mesmo com SIGEF, SNCI e crédito rural ligados ao mesmo tempo.
    const malha = id === "sigef" || id === "snci" || id === "credito_rural";
    // 17/11: contorno forte e um véu leve da mesma cor, para a malha "acender" sobre o satélite.
    const opacidade = malha ? 0.1 : def.semContorno ? 0.28 : 0.22;
    this.map.addLayer({
      id: `of-${id}-fill`, type: "fill", source: fonte(id),
      // sem antisserrilhado na camada recortada em células: senão a emenda entre células vira um fio
      paint: { "fill-color": corFill, "fill-opacity": opacidade, ...(def.semContorno ? { "fill-antialias": false } : {}) },
    }, antes);
    if (def.semContorno) return;
    this.map.addLayer({
      id: `of-${id}-linha`, type: "line", source: fonte(id),
      paint: {
        "line-color": def.cor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, malha ? 1.1 : 1.6, 12, malha ? 1.8 : 2.4, 15, malha ? 2.6 : 3.2] as never,
        "line-opacity": 1,
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
    if (!this.areaFixa && this.map.getZoom() < def.zoomMin) {
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
    const recortes = this.ativas.get(id);
    let janela = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    if (recortes) {
      // Só pede ao órgão a parte visível da extensão selecionada.
      const limites = [Infinity, Infinity, -Infinity, -Infinity];
      for (const area of recortes) for (const [x, y] of area.coordinates[0]) {
        limites[0] = Math.min(limites[0], x); limites[1] = Math.min(limites[1], y);
        limites[2] = Math.max(limites[2], x); limites[3] = Math.max(limites[3], y);
      }
      janela = this.areaFixa ? limites : [Math.max(janela[0], limites[0]), Math.max(janela[1], limites[1]), Math.min(janela[2], limites[2]), Math.min(janela[3], limites[3])];
      if (janela[0] >= janela[2] || janela[1] >= janela[3]) {
        fonteAtual()?.setData(VAZIO);
        this.definir(id, { carregando: false, aviso: "", total: 0 });
        return;
      }
    }
    try {
      const r = await fetch(`/api/camadas/${id}?bbox=${janela.map(v => v.toFixed(7)).join(",")}`,
        { signal: ctrl.signal });
      const j = await r.json().catch(() => null) as (GeoJSON.FeatureCollection & { falhas?: number; error?: string }) | null;
      if (ctrl.signal.aborted) return;
      if (!r.ok || !j?.features) {
        this.definir(id, { carregando: false, aviso: j?.error ?? "O órgão não respondeu agora." });
        return;
      }
      const exibidas = recortes ? await recortarEmWorker(j, recortes, ctrl.signal, !def.semContorno && !def.ponto && !def.linha) : j;
      if (ctrl.signal.aborted) return;
      fonteAtual()?.setData(exibidas);
      this.definir(id, {
        // no recorte, a divisa da área volta como MultiLineString e não conta; numa rede de linhas, tudo conta
        carregando: false, total: def.linha ? exibidas.features.length : exibidas.features.filter(f => f.geometry?.type !== "MultiLineString").length,
        aviso: j.falhas ? "Parte da área não carregou: o órgão não respondeu. Tente de novo em instantes." : "",
      });
    } catch (e) {
      if (!ctrl.signal.aborted) this.definir(id, { carregando: false, aviso: e instanceof Error && e.message.includes("recortar") ? e.message : "Falha de conexão ao carregar a camada." });
    }
  }
}

export { CAMADAS_OFICIAIS };
