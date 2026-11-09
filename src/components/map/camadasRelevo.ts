"use client";

import type { Map as MLMap, AddProtocolAction } from "maplibre-gl";
import { carregarMaplibre } from "@/lib/map/maplibre";

/**
 * Camadas de relevo e água no mapa principal (segunda etapa, itens 3 e 21):
 * relevo sombreado, altitude, curvas de nível, declividade e hidrografia.
 *
 * Tudo sai de fontes gratuitas que já respondem hoje:
 *  - Terrarium (SRTM ~30 m, AWS Open Data), o mesmo DEM do tour 3D. Sombra e
 *    altitude são camadas nativas do MapLibre (hillshade e color-relief);
 *    curvas e declividade são calculadas no navegador, tile a tile, por dois
 *    protocolos próprios (`arini-curvas://` e `arini-declive://`) cujo código
 *    (src/lib/map/relevoDem.ts) só é baixado quando a camada é ligada;
 *  - hidrografia do OpenStreetMap, que já vem nos tiles vetoriais da base
 *    CARTO do mapa (camada `water`): ligar não baixa nada a mais.
 *
 * Nada aqui roda na abertura do mapa: fonte e camadas nascem no primeiro
 * "ligar", e desligar só esconde.
 */

export type RelevoId = "sombra" | "altitude" | "curvas" | "declividade" | "hidrografia";

export type CamadaRelevo = { id: RelevoId; nome: string; fonte: string; zoomMin?: number; dica: string };

export const CAMADAS_RELEVO: CamadaRelevo[] = [
  { id: "sombra", nome: "Relevo sombreado", fonte: "SRTM · Terrarium", dica: "Luz e sombra do terreno, para ler morros e vales." },
  { id: "altitude", nome: "Altitude", fonte: "SRTM · Terrarium", dica: "Cores por faixa de altitude (hipsometria)." },
  { id: "curvas", nome: "Curvas de nível", fonte: "Calculadas do SRTM", zoomMin: 11, dica: "Cota em metros; a curva mestra é a mais grossa." },
  { id: "declividade", nome: "Declividade", fonte: "Calculada do SRTM · classes Embrapa", zoomMin: 12, dica: "Declive do terreno em %, nas classes da Embrapa." },
  { id: "hidrografia", nome: "Hidrografia", fonte: "OpenStreetMap", dica: "Rios, córregos, represas e lagos." },
];

/** Faixas da altitude: as paradas da rampa de cor e a legenda usam as mesmas. */
export const RAMPA_ALTITUDE: [number, string][] = [
  // mais paradas entre 300 e 900 m, onde fica quase todo o planalto do
  // Triângulo e do Pontal: com a rampa larga a região inteira saía num verde só
  [0, "#2E6B4E"],
  [150, "#4F8C55"],
  [300, "#86AE5E"],
  [400, "#B9C36A"],
  [500, "#DCC271"],
  [650, "#D49A55"],
  [850, "#B5703F"],
  [1200, "#8C5A3A"],
  [1800, "#CFC4B4"],
  [2600, "#F2EFEA"],
];

/** Classes de declive (Embrapa), cores iguais às de relevoDem.ts. */
export const LEGENDA_DECLIVE: { nome: string; cor: string }[] = [
  { nome: "Plano (0–3 %)", cor: "rgb(122,180,120)" },
  { nome: "Suave ondulado (3–8 %)", cor: "rgb(214,222,128)" },
  { nome: "Ondulado (8–20 %)", cor: "rgb(240,190,78)" },
  { nome: "Forte ondulado (20–45 %)", cor: "rgb(228,124,56)" },
  { nome: "Montanhoso (> 45 %)", cor: "rgb(178,52,40)" },
];

export const COR_AGUA = "#4FA8E0";

/** Cor da curva de nível: clara sobre o satélite, terra sobre o mapa. */
const COR_CURVA = { satelite: "#F3E6BF", claro: "#8E6239", escuro: "#C9A97A" } as const;

const DEM = "relevo-dem";
const URL_DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const ATRIBUICAO = "Relevo: SRTM via Terrarium (AWS Open Data)";

/** Ordem de empilhamento (de baixo para cima): a altitude é fundo, as curvas ficam por cima. */
const ORDEM: [RelevoId, string][] = [
  ["altitude", "relevo-altitude"],
  ["declividade", "relevo-declive"],
  ["sombra", "relevo-sombra"],
  ["hidrografia", "relevo-agua-fill"],
  ["hidrografia", "relevo-agua-linha"],
  ["hidrografia", "relevo-agua-rotulo"],
  ["curvas", "relevo-curvas"],
  ["curvas", "relevo-curvas-rotulo"],
];
const camadasDe = (id: RelevoId) => ORDEM.filter(([r]) => r === id).map(([, l]) => l);

// ---------------------------------------------------------------- protocolos
/** z/x/y do fim da URL do tile (`arini-curvas://12/1476/2277`). */
function zxy(url: string) {
  const m = url.match(/(\d+)\/(\d+)\/(\d+)\/?$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] as const : null;
}

let protocolos: Promise<void> | null = null;
/** Registra uma vez os dois protocolos; o código pesado chega no primeiro tile pedido. */
function registrarProtocolos(): Promise<void> {
  protocolos ??= carregarMaplibre().then((ml) => {
    const dem = () => import("@/lib/map/relevoDem");
    const curvas: AddProtocolAction = async (p, ctrl) => {
      const t = zxy(p.url);
      if (!t) return { data: new ArrayBuffer(0) };
      return { data: await (await dem()).tileCurvas(t[0], t[1], t[2], ctrl.signal) };
    };
    const declive: AddProtocolAction = async (p, ctrl) => {
      const t = zxy(p.url);
      if (!t) throw new Error("tile de declividade sem z/x/y");
      return { data: await (await dem()).tileDeclividade(t[0], t[1], t[2], ctrl.signal) };
    };
    ml.addProtocol("arini-curvas", curvas);
    ml.addProtocol("arini-declive", declive);
  });
  return protocolos;
}

// ---------------------------------------------------------------- gerenciador
export type EstadoRelevo = Partial<Record<RelevoId, { aviso: string }>>;

export class GerenciadorRelevo {
  private ativas = new Set<RelevoId>();
  private estado: EstadoRelevo = {};
  private base: "satelite" | "ruas" = "satelite";
  private aoZoom = () => this.conferirZoom();
  private aoErro = (e: { sourceId?: string }) => {
    const fonte = e.sourceId ?? "";
    if (!fonte.startsWith("relevo-")) return;
    const id: RelevoId = fonte === "relevo-curvas" ? "curvas" : fonte === "relevo-declive" ? "declividade" : "altitude";
    const afetadas: RelevoId[] = fonte === DEM ? ["sombra", "altitude"] : [id];
    for (const a of afetadas) if (this.ativas.has(a)) this.definir(a, "Parte do relevo não carregou: o servidor de elevação não respondeu.");
  };

  constructor(
    private map: MLMap,
    private aoMudar: (e: EstadoRelevo) => void,
    private tema: "claro" | "escuro",
  ) {
    map.on("zoomend", this.aoZoom);
    map.on("error", this.aoErro as never);
  }

  destruir() {
    this.map.off("zoomend", this.aoZoom);
    this.map.off("error", this.aoErro as never);
  }

  alternar(id: RelevoId, ligar = !this.ativas.has(id)) {
    if (ligar) {
      this.ativas.add(id);
      void this.criar(id).then(() => {
        if (!this.ativas.has(id)) return; // desligada enquanto carregava
        this.visivel(id, true);
        this.conferirZoom();
      });
    } else {
      this.ativas.delete(id);
      this.visivel(id, false);
      delete this.estado[id];
      this.aoMudar({ ...this.estado });
    }
  }

  /** A cor das curvas acompanha o fundo (satélite x mapa) e o tema. */
  mudarBase(base: "satelite" | "ruas") {
    this.base = base;
    this.pintarCurvas();
  }

  mudarTema(tema: "claro" | "escuro") {
    this.tema = tema;
    this.pintarCurvas();
  }

  private pintarCurvas() {
    if (this.map.getLayer("relevo-curvas")) {
      const cor = this.corCurva();
      this.map.setPaintProperty("relevo-curvas", "line-color", cor);
      this.map.setPaintProperty("relevo-curvas-rotulo", "text-color", cor);
    }
  }

  private corCurva() {
    return this.base === "satelite" ? COR_CURVA.satelite : COR_CURVA[this.tema];
  }

  private definir(id: RelevoId, aviso: string) {
    if (this.estado[id]?.aviso === aviso) return;
    this.estado[id] = { aviso };
    this.aoMudar({ ...this.estado });
  }

  private conferirZoom() {
    const z = this.map.getZoom();
    for (const c of CAMADAS_RELEVO) {
      if (!this.ativas.has(c.id)) continue;
      if (c.id === "hidrografia" && !this.fonteAgua()) { this.definir(c.id, "A hidrografia não está disponível neste fundo de mapa."); continue; }
      const atual = this.estado[c.id]?.aviso ?? "";
      if (c.zoomMin && z < c.zoomMin) this.definir(c.id, `Aproxime o mapa (zoom ${c.zoomMin} ou mais) para ver esta camada.`);
      else if (atual.startsWith("Aproxime")) this.definir(c.id, "");
      else if (!this.estado[c.id]) this.definir(c.id, "");
    }
  }

  /** Abaixo das divisas de município, do CAR, das camadas oficiais e dos anúncios. */
  private antesDe(camada: string) {
    const i = ORDEM.findIndex(([, l]) => l === camada);
    const acima = ORDEM.slice(i + 1).map(([, l]) => l).find((l) => this.map.getLayer(l));
    return acima ?? (this.map.getLayer("municipios-linha") ? "municipios-linha" : undefined);
  }

  /** Fonte vetorial da base CARTO que traz a água do OSM (`protomaps` hoje). */
  private fonteAgua() {
    const l = this.map.getStyle().layers.find((c) => "source-layer" in c && c["source-layer"] === "water") as { source?: string } | undefined;
    return l?.source;
  }

  private garantirDem() {
    if (this.map.getSource(DEM)) return;
    this.map.addSource(DEM, { type: "raster-dem", tiles: [URL_DEM], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: ATRIBUICAO });
  }

  private async criar(id: RelevoId) {
    const m = this.map;
    if (camadasDe(id).every((l) => m.getLayer(l))) return;
    const oculto = { visibility: "none" as const };
    if (id === "sombra") {
      this.garantirDem();
      m.addLayer({
        id: "relevo-sombra", type: "hillshade", source: DEM, layout: oculto,
        paint: { "hillshade-exaggeration": 0.85, "hillshade-shadow-color": "#13201A", "hillshade-highlight-color": "#FFFFFF", "hillshade-accent-color": "#13201A" },
      }, this.antesDe("relevo-sombra"));
    } else if (id === "altitude") {
      this.garantirDem();
      m.addLayer({
        id: "relevo-altitude", type: "color-relief", source: DEM, layout: oculto,
        paint: {
          "color-relief-color": ["interpolate", ["linear"], ["elevation"], ...RAMPA_ALTITUDE.flat()] as never,
          "color-relief-opacity": 0.62,
        },
      }, this.antesDe("relevo-altitude"));
    } else if (id === "declividade") {
      await registrarProtocolos();
      if (!m.getSource("relevo-declive")) {
        m.addSource("relevo-declive", {
          type: "raster", tiles: ["arini-declive://{z}/{x}/{y}"], tileSize: 256, minzoom: 12, maxzoom: 15, attribution: ATRIBUICAO,
        });
      }
      m.addLayer({
        id: "relevo-declive", type: "raster", source: "relevo-declive", minzoom: 12, layout: oculto,
        paint: { "raster-opacity": 0.58, "raster-resampling": "nearest" },
      }, this.antesDe("relevo-declive"));
    } else if (id === "curvas") {
      await registrarProtocolos();
      if (!m.getSource("relevo-curvas")) {
        m.addSource("relevo-curvas", { type: "vector", tiles: ["arini-curvas://{z}/{x}/{y}"], minzoom: 11, maxzoom: 15, attribution: ATRIBUICAO });
      }
      const cor = this.corCurva();
      m.addLayer({
        id: "relevo-curvas", type: "line", source: "relevo-curvas", "source-layer": "curvas", minzoom: 11, layout: { ...oculto, "line-join": "round" },
        paint: {
          "line-color": cor,
          "line-width": ["case", ["get", "mestra"], 1.4, 0.6] as never,
          "line-opacity": ["case", ["get", "mestra"], 0.95, 0.7] as never,
        },
      }, this.antesDe("relevo-curvas"));
      m.addLayer({
        id: "relevo-curvas-rotulo", type: "symbol", source: "relevo-curvas", "source-layer": "curvas", minzoom: 12,
        filter: ["get", "mestra"],
        layout: {
          ...oculto,
          "symbol-placement": "line", "symbol-spacing": 320,
          "text-field": ["concat", ["to-string", ["get", "ele"]], " m"] as never,
          "text-font": ["Open Sans Regular"], "text-size": 10.5, "text-padding": 4,
        },
        paint: { "text-color": cor, "text-halo-color": "rgba(10,19,16,0.85)", "text-halo-width": 1.3 },
      }, this.antesDe("relevo-curvas-rotulo"));
    } else if (id === "hidrografia") {
      const fonte = this.fonteAgua();
      if (!fonte) return;
      m.addLayer({
        id: "relevo-agua-fill", type: "fill", source: fonte, "source-layer": "water", layout: oculto,
        filter: ["all", ["==", ["geometry-type"], "Polygon"], ["!", ["in", ["get", "kind"], ["literal", ["ocean", "sea", "fountain"]]]]] as never,
        paint: { "fill-color": COR_AGUA, "fill-opacity": 0.5 },
      }, this.antesDe("relevo-agua-fill"));
      m.addLayer({
        id: "relevo-agua-linha", type: "line", source: fonte, "source-layer": "water", layout: { ...oculto, "line-cap": "round", "line-join": "round" },
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["in", ["get", "kind"], ["literal", ["river", "stream", "canal", "drain", "ditch"]]]] as never,
        paint: {
          "line-color": COR_AGUA,
          "line-width": ["interpolate", ["linear"], ["zoom"],
            8, ["match", ["get", "kind"], "river", 1.2, 0.4],
            13, ["match", ["get", "kind"], "river", 2.6, 1.1],
            16, ["match", ["get", "kind"], "river", 4, 1.8]] as never,
          "line-opacity": 0.95,
        },
      }, this.antesDe("relevo-agua-linha"));
      m.addLayer({
        id: "relevo-agua-rotulo", type: "symbol", source: fonte, "source-layer": "water", minzoom: 11,
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["has", "name"], ["in", ["get", "kind"], ["literal", ["river", "stream"]]]] as never,
        layout: {
          ...oculto,
          "symbol-placement": "line", "symbol-spacing": 400,
          "text-field": ["get", "name"], "text-font": ["Open Sans Regular"], "text-size": 11,
        },
        paint: { "text-color": "#CFEAFB", "text-halo-color": "rgba(6,28,44,0.9)", "text-halo-width": 1.3 },
      }, this.antesDe("relevo-agua-rotulo"));
    }
  }

  private visivel(id: RelevoId, sim: boolean) {
    for (const l of camadasDe(id)) if (this.map.getLayer(l)) this.map.setLayoutProperty(l, "visibility", sim ? "visible" : "none");
  }
}
