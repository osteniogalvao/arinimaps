// Usado tanto pelo carregamento antecipado quanto pelo mapa. Um endereço por tile.
const meioMundo = 20037508.342789244;
const mosaico = "https://titiler.terrascope.be/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=esa-worldcover-s2rgbnir-10m-2021-v2_tcc&STYLES=&TIME=2021-01-01&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg";

/** @param {number} z @param {number} x @param {number} y @param {string} detalhe */
export function urlDoTile(z, x, y, detalhe) {
  // A câmera de 512 px usa tiles raster de 256 px, um nível acima no mapa regional.
  if (z >= 7 && z <= 13) {
    const passo = 2 * meioMundo / (2 ** z);
    const oeste = x * passo - meioMundo;
    const norte = meioMundo - y * passo;
    return mosaico + "&BBOX=" + [oeste, norte - passo, oeste + passo, norte].join(",");
  }
  return detalhe.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}
