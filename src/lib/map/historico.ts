import type { RasterSourceSpecification } from "maplibre-gl";

/**
 * Imagens históricas de satélite para o seletor "Imagem do ano" e o modo
 * "comparar" do mapa (roadmap 3.8). Duas famílias, ambas sem chave:
 *
 * 1. Esri World Imagery **Wayback** — o mosaico da Esri congelado em cada
 *    release (o mesmo serviço que o satélite padrão usa em desenvolvimento,
 *    ver config.ts). Alta resolução (~0,5 m: dá para ver casa e lote). Um
 *    release por ano, o último de cada ano, tirado de
 *    https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json
 *    (197 releases em 07/10/2026). ATENÇÃO à leitura: "Wayback dez/2019" é o
 *    mosaico como estava publicado naquela data; a foto daquele ponto pode ser
 *    mais antiga. Releases vizinhos podem repetir a mesma imagem quando a Esri
 *    não trocou a cena do lugar — em Iturama (tile z16 do centro), 2014=2015,
 *    2016=2017 e 2021=2022 vieram idênticos; os demais anos diferem.
 *    O servidor redireciona (301) para o release que de fato tem o tile; o
 *    redirecionamento traz CORS aberto e o MapLibre segue normalmente.
 *    LICENÇA: uso sob os termos da Esri; para uso comercial em produção, o
 *    caminho é a conta ArcGIS Location Platform (mesma decisão de 23/09).
 *
 * 2. **Sentinel-2 cloudless** da EOX — mosaico anual sem nuvens, 10 m de
 *    resolução (mostra divisa de fazenda, mancha urbana, desmatamento; não
 *    resolve lote). Anos disponíveis medidos em 07/10/2026 sobre Iturama:
 *    2016 (camada `s2cloudless_3857`) e 2018 a 2025 (`s2cloudless-AAAA_3857`).
 *    2017 responde, mas com tile vazio (668 bytes) — fica de fora.
 *    LICENÇA: 2016 é CC BY 4.0; de 2018 em diante a EOX publica como
 *    CC BY-NC-SA 4.0 (uso comercial exige licença da EOX). A atribuição
 *    aparece no canto do mapa.
 */
export type ImagemHistorica = {
  id: string;
  rotulo: string;
  ano: number;
  familia: "wayback" | "sentinel" | "copernicus";
  fonte: RasterSourceSpecification;
};

const WAYBACK: [number, string, string][] = [
  // [ano, release, data do release]
  [2014, "5844", "2014-12-30"],
  [2015, "28163", "2015-12-16"],
  [2016, "18966", "2016-12-20"],
  [2017, "25521", "2017-11-16"],
  [2018, "23448", "2018-12-14"],
  [2019, "4756", "2019-12-12"],
  [2020, "29260", "2020-12-16"],
  [2021, "26120", "2021-12-21"],
  [2022, "45134", "2022-12-14"],
  [2023, "56102", "2023-12-07"],
  [2024, "16453", "2024-12-12"],
  [2025, "13192", "2025-12-18"],
  // 2026: o último release (18/11) traz a foto de nov/2025, com nuvem sobre Iturama.
  [2026, "3692", "2026-11-18"],
];

const SENTINEL_ANOS = [2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export const IMAGENS_HISTORICAS: ImagemHistorica[] = [
  ...WAYBACK.slice().reverse().map(([ano, release, data]): ImagemHistorica => ({
    id: `wayback-${ano}`,
    rotulo: `${ano} · alta resolução`,
    ano,
    familia: "wayback",
    fonte: {
      type: "raster",
      tiles: [`https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 17,
      attribution: `Imagery © Esri (World Imagery Wayback, ${dataBr(data)})`,
    },
  })),
  ...SENTINEL_ANOS.slice().reverse().map((ano): ImagemHistorica => ({
    id: `sentinel-${ano}`,
    rotulo: `${ano} · Sentinel-2 (10 m)`,
    ano,
    familia: "sentinel",
    fonte: {
      type: "raster",
      tiles: [`https://tiles.maps.eox.at/wmts/1.0.0/${ano === 2016 ? "s2cloudless_3857" : `s2cloudless-${ano}_3857`}/default/g/{z}/{y}/{x}.jpg`],
      tileSize: 256,
      // 10 m por pixel: além do z15 é só ampliação
      maxzoom: 15,
      attribution: `Sentinel-2 cloudless ${ano} por <a href="https://s2maps.eu" target="_blank" rel="noreferrer">EOX IT Services GmbH</a> (dados Copernicus Sentinel ${ano}; ${ano === 2016 ? "CC BY 4.0" : "CC BY-NC-SA 4.0"})`,
    },
  })),
];

/**
 * 3. **Cena do dia pelo Copernicus Data Space** (22/10/2026): a pessoa escolhe a
 * passagem do Sentinel-2 pela data e pela nuvem (CenasCopernicus.tsx) e vê em
 * cor real ou NDVI. Os tiles vêm de /api/sentinel/tile (conta da Arini no
 * Sentinel Hub). Id: `cdse:AAAA-MM-DD:cor|ndvi`. LICENÇA: dados Copernicus
 * Sentinel, livres inclusive para uso comercial, com atribuição.
 */
export function imagemCdse(data: string, tipo: "cor" | "ndvi"): ImagemHistorica {
  const origem = typeof window === "undefined" ? "" : window.location.origin;
  return {
    id: `cdse:${data}:${tipo}`,
    rotulo: `${dataBr(data)} · Sentinel-2 ${tipo === "ndvi" ? "NDVI" : "cor real"}`,
    ano: Number(data.slice(0, 4)),
    familia: "copernicus",
    fonte: {
      type: "raster",
      tiles: [`${origem}/api/sentinel/tile/${data}/${tipo}/{z}/{x}/{y}.png`],
      tileSize: 256,
      // o servidor só gera do zoom 10 ao 16 (10 m por pixel)
      minzoom: 10,
      maxzoom: 16,
      attribution: `Contém dados Copernicus Sentinel ${data.slice(0, 4)} modificados (Copernicus Data Space Ecosystem)`,
    },
  };
}

export const imagemHistoricaPorId = (id: string | null | undefined) => {
  const m = id?.match(/^cdse:(\d{4}-\d{2}-\d{2}):(cor|ndvi)$/);
  if (m) return imagemCdse(m[1], m[2] as "cor" | "ndvi");
  return IMAGENS_HISTORICAS.find((i) => i.id === id) ?? null;
};
