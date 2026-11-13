import type { StyleSpecification, RasterSourceSpecification } from "maplibre-gl";

/**
 * Cores por status no mapa (legenda fixa), na paleta do Manual v1.0: Verde
 * Mapa (publicado), Amarelo Claro (em negociação), Dourado (leilão, cor
 * própria no mapa, na legenda e no filtro) e cinza-verde neutro (vendido).
 */
export const STATUS_CORES: Record<string, string> = {
  publicado: "#6FB08F",
  em_negociacao: "#FFE299",
  vendido: "#7E9187",
  leilao: "#D9BD6F",
};

export const CENTRO_REGIAO: [number, number] = [-50.196, -19.728]; // Iturama

/**
 * Fonte de satélite, em ordem de preferência:
 *
 * 1. Esri World Imagery com a chave da conta (env NEXT_PUBLIC_ARCGIS_KEY,
 *    ArcGIS Location Platform, decidido em 23/09/2026). A chave vai junto do
 *    release FIXO do Wayback, não do mosaico atual do endpoint licenciado
 *    (ibasemaps-api): o mosaico atual voltou a trazer nuvem sobre Iturama.
 *    Medido em 26/10/2026 numa grade de 25 tiles z14 em volta da cidade:
 *    mosaico atual 5,0% de média, um tile com 44,2% e 4 tiles acima de 10%;
 *    Wayback 20512, com ou sem a chave, 0,0% em todos. O Stenio escolheu o
 *    Wayback com a chave em 26/10/2026; falta confirmar com a Esri se o
 *    Wayback entra na licença comercial e na cota do Location Platform.
 *    Restrinja a chave aos domínios do site no painel da Esri: ela vai no
 *    JavaScript do navegador, como qualquer chave de mapa.
 * 2. MapTiler (env NEXT_PUBLIC_MAPTILER_KEY) — o plano gratuito é só para uso
 *    não comercial; mantido para quem tiver plano pago.
 * 3. Esri World Imagery via **Wayback**, com o release fixado — sem chave, só
 *    para desenvolvimento e demonstração (sem licença comercial).
 *
 * POR QUE UM RELEASE FIXO DO WAYBACK, E NÃO O MOSAICO "ATUAL"
 * -----------------------------------------------------------
 * O World_Imagery padrão (server.arcgisonline.com) serve o mosaico corrente, e
 * o mosaico corrente MUDA sem aviso. Medição de 10/09/2026 no tile do centro de
 * Iturama (z16/23630/36432), contando pixel claro e sem cor:
 *
 *   World Imagery atual   = Wayback 2026-08-05 ... 44,2% de nuvem
 *   Wayback 2026-04-30 .................................. 3,5%
 *   Wayback 2025-10-23 .................................. 2,6%   ← escolhido
 *   Wayback 2023-10-11 .................................. 2,9%
 *
 * Ou seja: a nuvem sobre Iturama ENTROU na atualização de agosto/2026. Trocar
 * para o Clarity (30/08/2026) resolveu porque o Clarity serve outra passagem —
 * mas ele é igualmente um alvo móvel, e no pior tile de Limeira do Oeste ainda
 * media 4,6% de nuvem, enquanto qualquer release do Wayback ali dá 0,0%.
 *
 * O Wayback existe justamente para isso: cada release é uma foto congelada do
 * mosaico, imutável por definição. Fixando o release 20512 (2025-10-23), a
 * imagem não volta a ficar nublada na próxima atualização da Esri. O preço é
 * que a imagem também não rejuvenesce sozinha — para cartografia urbana é troca
 * boa: nuvem sobre o lote atrapalha mais do que imagem de um ano atrás.
 *
 * MAXZOOM 17 NÃO É CHUTE: medido em 26/08, reconfirmado em 30/08 e de novo no
 * release 20512 em 10/09/2026 — há imagem até z17 nos três municípios e z18
 * devolve 404. Declarar 19 fazia o mapa pedir tiles inexistentes e a tela ficava
 * cinza justamente no zoom do lote; com 17, o MapLibre amplia o último tile real
 * (overzoom).
 *
 * Para trocar de release: a lista está em
 * https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json
 * (196 releases). Meça antes de trocar — `scripts/mede-nuvem.mjs`.
 */
const ARCGIS_KEY = process.env.NEXT_PUBLIC_ARCGIS_KEY;
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

export type ProvedorSatelite = "esri" | "maptiler" | "wayback";
export const PROVEDOR_SATELITE: ProvedorSatelite =
  ARCGIS_KEY ? "esri" : MAPTILER_KEY ? "maptiler" : "wayback";

/** Tile do satélite que o mapa está usando AGORA — o medidor de nuvem confere este. */
export const urlTileAtivo = (z: number | string, x: number | string, y: number | string) =>
  PROVEDOR_SATELITE === "esri"
    ? `${urlTileSatelite(z, x, y)}?token=${ARCGIS_KEY}`
    : PROVEDOR_SATELITE === "maptiler"
      ? `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${MAPTILER_KEY}`
      : urlTileSatelite(z, x, y);

/**
 * Release do Wayback em uso. Trocar aqui troca em todo lugar — inclusive no
 * medidor de nuvem do painel (src/lib/map/nuvem.ts), que confere este mesmo
 * release sobre os municípios cadastrados.
 */
export const SATELITE_RELEASE = "20512"; // World Imagery (Wayback 2025-10-23)

export const urlTileSatelite = (
  z: number | string, x: number | string, y: number | string, release = SATELITE_RELEASE
) =>
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/${z}/${y}/${x}`;

export const SATELITE: RasterSourceSpecification = PROVEDOR_SATELITE === "esri"
  ? {
      type: "raster",
      tiles: [urlTileAtivo("{z}", "{x}", "{y}")],
      tileSize: 256,
      // z18 na região devolve 404 no release 20512 (medido em 10/09/2026)
      maxzoom: 17,
      attribution: "Powered by Esri · Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community (World Imagery, 2025-10-23)",
    }
  : PROVEDOR_SATELITE === "maptiler"
  ? {
      type: "raster",
      tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`],
      tileSize: 256,
      maxzoom: 20,
      attribution: "© MapTiler © OpenStreetMap contributors",
    }
  : {
      type: "raster",
      // os {z}/{x}/{y} são substituídos pelo MapLibre na hora de pedir o tile
      tiles: [urlTileSatelite("{z}", "{x}", "{y}")],
      tileSize: 256,
      maxzoom: 17,
      attribution: "Imagery © Esri (World Imagery, 2025-10-23)",
    };

/**
 * SATÉLITE DE PERTO (11/11/2026, áudio do Carlos: "o mapa, quando se aproxima,
 * está com a qualidade muito ruim (...) ver os telhados, as divisões").
 *
 * O release fixo do Wayback para no z17 na região, e daí para perto o MapLibre
 * só amplia o último tile, por isso a imagem borra no zoom do lote. O mosaico
 * ATUAL da Esri, pelo endpoint licenciado com a chave da conta, costuma ter
 * z18–z19 nas cidades. Ele entra como uma segunda camada só a partir do z18,
 * por cima do Wayback. Onde o mosaico atual não tiver o tile, a camada fica
 * transparente e aparece o Wayback ampliado, como antes. A nuvem que levou ao
 * Wayback foi medida no z14–z16; no z18 ainda falta medir (escolha do Stenio
 * em 11/11/2026: testar antes de pagar outra fonte).
 *
 * Só existe com a chave da Esri. Para desligar sem mexer no código:
 * NEXT_PUBLIC_SATELITE_ALTO=0 no ambiente (pede novo build).
 */
export const SATELITE_ALTO: RasterSourceSpecification | null =
  PROVEDOR_SATELITE === "esri" && process.env.NEXT_PUBLIC_SATELITE_ALTO !== "0"
    ? {
        type: "raster",
        tiles: [`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${ARCGIS_KEY}`],
        tileSize: 256,
        minzoom: 18,
        maxzoom: 19,
        attribution: "Powered by Esri · Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      }
    : null;

/** A partir de que zoom a camada de perto aparece (o mesmo minzoom da fonte). */
export const ZOOM_SATELITE_ALTO = 18;

/**
 * Sentinel-2 cloudless (EOX) — imagem de satélite verdadeiramente aberta
 * (CC BY 4.0, uso comercial permitido). Resolução de 10 m: mostra a divisa
 * de uma fazenda, mas não resolve lote urbano. Fica como camada alternativa.
 */
export const SATELITE_ABERTO: RasterSourceSpecification = {
  type: "raster",
  tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
  tileSize: 256,
  maxzoom: 15,
  attribution: 'Sentinel-2 cloudless por <a href="https://s2maps.eu">EOX</a> (CC BY 4.0)',
};

/** Um único style com as duas bases raster; alternamos por visibility. */
export const ESTILO_BASE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    ruas: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
    satelite: SATELITE,
  },
  layers: [
    { id: "base-ruas", type: "raster", source: "ruas", layout: { visibility: "visible" } },
    { id: "base-satelite", type: "raster", source: "satelite", layout: { visibility: "none" } },
  ],
};

export type BaseMapa = "ruas" | "satelite";
