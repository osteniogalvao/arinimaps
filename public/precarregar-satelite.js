// O fragmento #pos só chega ao navegador. Antecipe o mesmo bloco central que o
// MapLibre pediria, em paralelo ao download do motor, inclusive ao abrir um link.
(async () => {
  const dados = document.currentScript.dataset;
  try {
    const preferencias = JSON.parse(localStorage.getItem(dados.preferencias) || "{}");
    if (preferencias?.mapa_base === "mapa") return;
  } catch { /* Sem preferências locais, o mapa abre em satélite. */ }

  let [lng, lat, zoom] = JSON.parse(dados.camera);
  const pos = new URLSearchParams(location.hash.slice(1)).get("pos");
  if (pos !== null) {
    const valores = pos.split("/").map(Number);
    if (valores.length < 3 || valores.length > 5 || !valores.every(Number.isFinite)) return;
    const [z, y, x, bearing = 0, pitch = 0] = valores;
    const [[oeste, sul], [leste, norte]] = JSON.parse(dados.limites);
    if (x < oeste || x > leste || y < sul || y > norte || z < 4 || z > 22 ||
        Math.abs(bearing) > 180 || pitch !== 0) return;
    lng = x;
    lat = y;
    zoom = z;
  }

  // A câmera usa 512 px por bloco; a fonte raster pode usar outra resolução.
  const z = Math.min(Number(dados.maxzoom), Math.round(zoom + Math.log2(512 / Number(dados.tileSize))));
  const n = 2 ** z;
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) * n / 2);
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "fetch";
  link.crossOrigin = "anonymous";
  const { urlDoTile } = await import("/vendor/fonte-satelite.mjs");
  link.href = urlDoTile(z, x, y, dados.fonte);
  document.head.appendChild(link);
})().catch(() => { /* A antecipação é opcional. */ });
