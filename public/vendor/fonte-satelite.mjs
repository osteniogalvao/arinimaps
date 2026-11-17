// Usado tanto pelo carregamento antecipado quanto pelo mapa.
const meioMundo = 20037508.342789244;
const mosaicoSentinel = "https://titiler.terrascope.be/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=esa-worldcover-s2rgbnir-10m-2021-v2_tcc&STYLES=&TIME=2021-01-01&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&BBOX={bbox-epsg-3857}";

/** @param {number} z @param {number} x @param {number} y */
export function urlMosaico(z, x, y) {
  // O WMS de 10 m demora para montar uma área continental. A NASA já serve
  // o panorama global em tiles prontos nessa escala.
  if (z <= 6) return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;
  const passo = 2 * meioMundo / (2 ** z);
  const oeste = x * passo - meioMundo;
  const norte = meioMundo - y * passo;
  return mosaicoSentinel.replace("{bbox-epsg-3857}", [oeste, norte - passo, oeste + passo, norte].join(","));
}

/**
 * Até este zoom o mapa usa o panorama da NASA (tiles prontos, CDN). Acima dele,
 * a fotografia de detalhe da Esri (Wayback fixo), também em CDN.
 *
 * 17/11/2026 ("precisamos de um mapa mais nítido e que carregue mais rápido"):
 * antes, do z7 ao z13 o mapa pedia o mosaico Sentinel-2 ao WMS da Terrascope,
 * que monta cada tile na hora. Medido daqui: 1,4 s a 6,8 s por tile, alguns
 * 502 e pedidos parados por mais de 2 minutos; o Wayback respondeu em 0,3 s a
 * 0,7 s. Como o mapa abre no z9, era justamente a primeira tela que demorava.
 * No z13 o Wayback também é bem mais nítido (submétrico contra 10 m). O
 * Sentinel-2 continua no botão do mosaico anual e como reserva se a Esri falhar.
 */
export const ZOOM_PANORAMA_MAX = 6;

/** @param {number} z @param {number} x @param {number} y @param {string} detalhe */
export function urlDoTile(z, x, y, detalhe) {
  if (z <= ZOOM_PANORAMA_MAX) return urlMosaico(z, x, y);
  return detalhe.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}
