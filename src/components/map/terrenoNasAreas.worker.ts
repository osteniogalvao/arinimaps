import {
  demDoTile,
  metrosPorPixel,
  tileCurvas,
  tileDeclividade,
  tileTransparente,
} from "@/lib/map/relevoDem";

type Pedido = { id: number; tipo: string; z: number; x: number; y: number };
type Configuracao = { areas: GeoJSON.Polygon[]; rampa: [number, string][] };
const LADO = 256;
const pedidos = new Map<number, AbortController>();
let areasProjetadas: { aneis: number[][][]; limites: number[] }[] = [];
let rampa: { h: number; rgb: number[] }[] = [];

function configurar(c: Configuracao) {
  rampa = c.rampa.map(([h, cor]) => ({ h, rgb: [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16)) }));
  areasProjetadas = c.areas.map((a) => {
    const limites = [Infinity, Infinity, -Infinity, -Infinity];
    const aneis = a.coordinates.map((anel) =>
      anel.map(([lng, lat]) => {
        const rad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
        const x = (lng + 180) / 360,
          y = (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2;
        limites[0] = Math.min(limites[0], x);
        limites[1] = Math.min(limites[1], y);
        limites[2] = Math.max(limites[2], x);
        limites[3] = Math.max(limites[3], y);
        return [x, y];
      }),
    );
    return { aneis, limites };
  });
}

function mascarasDoTile({ z, x, y }: Pedido) {
  const n = 2 ** z;
  return areasProjetadas
    .filter(
      ({ limites: [x0, y0, x1, y1] }) => x0 * n <= x + 1 && x1 * n >= x && y0 * n <= y + 1 && y1 * n >= y,
    )
    .map(({ aneis }) =>
      aneis.map((anel) => anel.map(([px, py]) => [(px * n - x) * LADO, (py * n - y) * LADO])),
    );
}

async function terreno(p: Pedido, signal: AbortSignal) {
  const mascaras = mascarasDoTile(p);
  if (!mascaras.length) return p.tipo === "curvas" ? new ArrayBuffer(0) : (await tileTransparente()).slice(0);
  // Pedidos do mesmo tile compartilham a leitura do DEM, inclusive durante a movimentação.
  const dem = await demDoTile(p.z, p.x, p.y);
  signal.throwIfAborted();
  if (!dem) throw new Error("O modelo de elevação não respondeu.");
  if (p.tipo === "curvas") return tileCurvas(p.z, p.x, p.y, signal, mascaras);
  const tela = new OffscreenCanvas(LADO, LADO),
    ctx = tela.getContext("2d")!;
  if (p.tipo === "declividade") {
    const tile = await tileDeclividade(p.z, p.x, p.y, signal);
    const bmp = await createImageBitmap(new Blob([tile], { type: "image/png" }));
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  } else {
    const imagem = ctx.createImageData(LADO, LADO),
      px = imagem.data;
    const metros = metrosPorPixel(p.z, p.y);
    for (let i = 0; i < dem.length; i++) {
      const off = i * 4;
      if (p.tipo === "altitude") {
        const h = dem[i];
        let k = 1;
        while (k < rampa.length - 1 && h > rampa[k].h) k++;
        const baixo = rampa[k - 1],
          alto = rampa[k];
        const t = Math.max(0, Math.min(1, (h - baixo.h) / (alto.h - baixo.h)));
        for (let c = 0; c < 3; c++) px[off + c] = baixo.rgb[c] + t * (alto.rgb[c] - baixo.rgb[c]);
        px[off + 3] = 255;
      } else {
        // Luz de noroeste. Terreno plano fica transparente, como o hillshade sobre o satélite.
        const ix = i % LADO,
          iy = Math.floor(i / LADO);
        const dx = (dem[i + (ix < LADO - 1 ? 1 : 0)] - dem[i - (ix > 0 ? 1 : 0)]) / (2 * metros);
        const dy = (dem[i + (iy < LADO - 1 ? LADO : 0)] - dem[i - (iy > 0 ? LADO : 0)]) / (2 * metros);
        const luz = ((dx + dy) * 0.85) / Math.sqrt(2 + 2 * (dx * dx + dy * dy));
        px[off] = luz >= 0 ? 255 : 19;
        px[off + 1] = luz >= 0 ? 255 : 32;
        px[off + 2] = luz >= 0 ? 255 : 26;
        px[off + 3] = Math.min(255, 255 * Math.abs(luz));
      }
    }
    ctx.putImageData(imagem, 0, 0);
  }
  // Une as máscaras antes de recortar a imagem, inclusive quando se sobrepõem.
  const mascara = new OffscreenCanvas(LADO, LADO),
    m = mascara.getContext("2d")!;
  for (const aneis of mascaras) {
    m.beginPath();
    for (const anel of aneis) {
      m.moveTo(anel[0][0], anel[0][1]);
      for (const [x, y] of anel.slice(1)) m.lineTo(x, y);
      m.closePath();
    }
    m.fill("evenodd");
  }
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mascara, 0, 0);
  return (await tela.convertToBlob({ type: "image/png" })).arrayBuffer();
}

self.onmessage = async ({ data }: MessageEvent<Pedido | Configuracao | { id: number; cancelar: true }>) => {
  if ("areas" in data) {
    configurar(data);
    return;
  }
  if ("cancelar" in data) {
    pedidos.get(data.id)?.abort();
    return;
  }
  const ctrl = new AbortController();
  pedidos.set(data.id, ctrl);
  try {
    const bytes = await terreno(data, ctrl.signal);
    if (!ctrl.signal.aborted) self.postMessage({ id: data.id, bytes }, { transfer: [bytes] });
  } catch {
    if (!ctrl.signal.aborted) self.postMessage({ id: data.id, erro: true });
  } finally {
    pedidos.delete(data.id);
  }
};
