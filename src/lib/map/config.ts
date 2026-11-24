import type { StyleSpecification, RasterSourceSpecification } from "maplibre-gl";
import { urlDoTile } from "../../../public/vendor/fonte-satelite.mjs";
import { version as versaoMapLibre } from "maplibre-gl/package.json";

export const URL_MAPLIBRE = `/vendor/maplibre-gl.mjs?v=${versaoMapLibre}`;

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
export const ZOOM_INICIAL_REGIONAL = 9;
export const LIMITES_MAPA_REGIONAL: [[number, number], [number, number]] = [[-80, -38], [-28, 9]];

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
 *   Wayback 2025-10-23 .................................. 2,6%   (usado até 23/11/2026)
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
 * TROCA PARA O RELEASE 49059 (2026-04-30), em 23/11/2026. Pedido do Stenio
 * ("visualizar cidades e áreas rurais está muito ultrapassado e de péssima
 * qualidade, principalmente urbano"). O 20512 mostrava fotos de ago/2023 em
 * Iturama e Limeira e de ago/2020 em União de Minas. Data da foto (metadado da
 * Esri) e nuvem medidas em 23/11/2026, grade 5×5 z15 em cada cidade e grade
 * de 81 tiles z12 + 121 tiles z14 sobre a região:
 *
 *   release    Iturama    Limeira    União      nuvem na região
 *   20512      ago/2023   ago/2023   ago/2020   0,0% (z14)
 *   49059      mar/2025   ago/2023   set/2024   0,0% (z14)   ← escolhido
 *   3692 (nov/2026, mais novo)  nov/2025 com nuvem em Iturama (53% num tile,
 *   5 tiles z14 acima de 5%): de mai/2026 em diante todos trazem essa cena.
 *
 * Continua sem z18 na região: chegar mais perto que o z17 exige fonte paga.
 * Se um tile do release em uso vier com nuvem, tileSatelite.ts tenta o 20512.
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

/**
 * Release do Wayback em uso. Trocar aqui troca em todo lugar — inclusive no
 * medidor de nuvem do painel (src/lib/map/nuvem.ts), que confere este mesmo
 * release sobre os municípios cadastrados.
 */
export const SATELITE_RELEASE = "49059"; // World Imagery (Wayback 2026-04-30)

export const urlTileSatelite = (
  z: number | string, x: number | string, y: number | string, release = SATELITE_RELEASE
) =>
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/${z}/${y}/${x}`;

export const urlTileHistorico = (z: number, x: number, y: number, release: string) =>
  urlTileSatelite(z, x, y, release) + (ARCGIS_KEY ? "?token=" + ARCGIS_KEY : "");

/**
 * "MOSAICO COM MENOS NUVENS" (botão do mapa). 17/11/2026, Stenio: "quando
 * seleciono 'mosaico com menos nuvens' fica tudo feio". Antes era o Sentinel-2
 * de 2021 montado na hora pelo WMS da Terrascope: granulado, avermelhado,
 * 1,5 s ou mais por tile, e ampliado até o z14+ (10 m esticados viram borrão).
 *
 * Agora: Sentinel-2 cloudless da EOX, edição 2016, em tiles prontos de CDN
 * (~0,5–1 s). É a ÚNICA edição da EOX com licença CC BY 4.0 (uso comercial);
 * as de 2018 em diante são CC BY-NC-SA e exigem licença paga da EOX.
 * A camada vai só até o z13 (ZOOM_MOSAICO_ATE); dali para perto aparece a
 * fotografia de detalhe normal, que já troca tile com nuvem por outro release.
 */
export const ZOOM_MOSAICO_ATE = 14;
export const MOSAICO_MENOS_NUVENS: RasterSourceSpecification = {
  type: "raster", tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
  tileSize: 256, maxzoom: 13,
  attribution: 'Sentinel-2 cloudless 2016 por <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contém dados modificados do Copernicus Sentinel 2016) · CC BY 4.0',
};

export const TILE_DETALHE = PROVEDOR_SATELITE === "maptiler"
  ? `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`
  : urlTileSatelite("{z}", "{x}", "{y}") + (ARCGIS_KEY ? "?token=" + ARCGIS_KEY : "");

export const urlTileAtivo = (z: number, x: number, y: number) => urlDoTile(z, x, y, TILE_DETALHE);

/**
 * NITIDEZ EM TELA RETINA (17/11/2026; limiar 1,5 → 2 na mesma noite, porque
 * em notebook com escala 150% o ganho era pequeno e o custo, 4× mais tiles). Um tile raster de 256 px ocupa 256 px
 * de CSS; numa tela com densidade 2 (celular, Mac, notebook com escala 150%+)
 * cada pixel da foto vira 2×2 pixels da tela e a imagem fica "lavada". Com
 * tileSize 128 o MapLibre pede o tile um zoom acima para o mesmo pedaço da
 * tela, e cada pixel da foto cai num pixel da tela. Custa até 4× mais tiles,
 * aceitável porque o Wayback vem de CDN (0,3–0,7 s por tile). O teto continua
 * no maxzoom da fonte: perto do lote o ganho só vem de uma fonte com z18+.
 * O mesmo cálculo está em public/precarregar-satelite.js.
 */
export const TILE_SATELITE_PX =
  typeof window !== "undefined" && window.devicePixelRatio >= 2 ? 128 : 256;

export const SATELITE: RasterSourceSpecification = {
  type: "raster",
  tiles: ["arini-satelite://tile/{z}/{x}/{y}"],
  tileSize: TILE_SATELITE_PX,
  maxzoom: PROVEDOR_SATELITE === "maptiler" ? 20 : 17,
  attribution: 'Panorama NASA Blue Marble · Sentinel-2 © ESA WorldCover / Copernicus (2021), CC BY 4.0 · ' +
    (PROVEDOR_SATELITE === "maptiler" ? "© MapTiler © OpenStreetMap contributors · Imagem alternativa © Esri e colaboradores" :
      "Powered by Esri · Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community (World Imagery Wayback, edições 2024 e 2025)"),
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
 * O mosaico recente é opcional. Ative somente depois de conferir as imagens de perto.
 */
export const urlTileAlto = (z: number, x: number, y: number) =>
  `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${ARCGIS_KEY}`;

export const SATELITE_ALTO: RasterSourceSpecification | null =
  PROVEDOR_SATELITE === "esri" && process.env.NEXT_PUBLIC_SATELITE_ALTO === "1"
    ? {
        type: "raster",
        tiles: ["arini-satelite://alto/{z}/{x}/{y}"],
        tileSize: TILE_SATELITE_PX,
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
