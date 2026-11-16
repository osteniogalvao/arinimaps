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

/** @param {number} z @param {number} x @param {number} y @param {string} detalhe */
export function urlDoTile(z, x, y, detalhe) {
  if (z <= 13) return urlMosaico(z, x, y);
  return detalhe.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}
