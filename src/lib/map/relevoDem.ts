"use client";

/**
 * Contas de relevo feitas no navegador, tile a tile, a partir do mesmo modelo
 * de elevação do tour 3D e da pré-avaliação (Terrarium, SRTM ~30 m, tiles PNG
 * públicos da AWS — elevation-tiles-prod).
 *
 * Este arquivo só é baixado quando alguém liga "Curvas de nível" ou
 * "Declividade" no painel de camadas (import dinâmico em camadasRelevo.ts):
 * não pesa na abertura do mapa.
 *
 *  - declividade: um PNG por tile, cada pixel pintado na classe de declive da
 *    Embrapa (0–3, 3–8, 8–20, 20–45, >45 %). Média 3 × 3 e diferenças
 *    centrais com base de ~90 m, a mesma ideia de src/lib/avaliacao/terreno.ts
 *    (lá, 2 pixels para cada lado no zoom 13), o que tira o ruído do SRTM;
 *  - curvas de nível: marching squares sobre a grade de 256 × 256 do tile,
 *    devolvidas como tile vetorial (MVT) com a cota em `ele`. O codificador
 *    MVT é mínimo (só linhas) e fica aqui para não trazer pbf/vt-pbf ao
 *    navegador.
 */

export const URL_TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
/** O Terrarium vai até o z15; acima disso o MapLibre amplia o tile do z15. */
export const DEM_ZOOM_MAX = 15;

const LADO = 256;

// ------------------------------------------------------------------ elevação
type Dem = Float32Array;

/** Poucos tiles decodificados em memória: curvas e declividade pedem os mesmos. */
const cacheDem = new Map<string, Promise<Dem | null>>();
const CACHE_MAX = 48;

/** R·256 + G + B/256 − 32768 (formato Terrarium). */
function decodificar(px: Uint8ClampedArray): Dem {
  const h = new Float32Array(LADO * LADO);
  for (let i = 0, p = 0; i < h.length; i++, p += 4) h[i] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
  return h;
}

async function baixarDem(z: number, x: number, y: number, sinal?: AbortSignal): Promise<Dem | null> {
  const url = URL_TERRARIUM.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  const r = await fetch(url, { signal: sinal });
  if (!r.ok) return null;
  // sem conversão de cor nem pré-multiplicação: os bytes SÃO a altitude
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const tela = new OffscreenCanvas(LADO, LADO);
  const ctx = tela.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, LADO, LADO);
  bmp.close();
  return decodificar(ctx.getImageData(0, 0, LADO, LADO).data);
}

export function demDoTile(z: number, x: number, y: number, sinal?: AbortSignal): Promise<Dem | null> {
  const chave = `${z}/${x}/${y}`;
  const guardado = cacheDem.get(chave);
  if (guardado) return guardado;
  const p = baixarDem(z, x, y, sinal).catch(() => null);
  cacheDem.set(chave, p);
  // falha não fica no cache (deixa tentar de novo); o mais antigo sai quando enche
  p.then((d) => { if (!d) cacheDem.delete(chave); });
  if (cacheDem.size > CACHE_MAX) cacheDem.delete(cacheDem.keys().next().value!);
  return p;
}

/** Metros por pixel no centro do tile (Web Mercator). */
function metrosPorPixel(z: number, y: number) {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  const lat = Math.atan(Math.sinh(n));
  return (40075016.686 * Math.cos(lat)) / (LADO * 2 ** z);
}

// ------------------------------------------------------------------ declividade
/** Classes de relevo da Embrapa (Santos et al., SiBCS), em % de declive. */
export const CLASSES_DECLIVE = [
  { ate: 3, nome: "Plano (0–3 %)", cor: [122, 180, 120] },
  { ate: 8, nome: "Suave ondulado (3–8 %)", cor: [214, 222, 128] },
  { ate: 20, nome: "Ondulado (8–20 %)", cor: [240, 190, 78] },
  { ate: 45, nome: "Forte ondulado (20–45 %)", cor: [228, 124, 56] },
  { ate: Infinity, nome: "Montanhoso (> 45 %)", cor: [178, 52, 40] },
] as const;

let pngVazio: Promise<ArrayBuffer> | null = null;
async function tileTransparente(): Promise<ArrayBuffer> {
  pngVazio ??= new OffscreenCanvas(1, 1).convertToBlob({ type: "image/png" }).then((b) => b.arrayBuffer());
  return pngVazio;
}

/** PNG 256 × 256 com a classe de declive de cada pixel (transparente se o DEM não veio). */
export async function tileDeclividade(z: number, x: number, y: number, sinal?: AbortSignal): Promise<ArrayBuffer> {
  const bruto = await demDoTile(z, x, y, sinal);
  if (!bruto) return tileTransparente();
  // o SRTM tem ruído de alguns metros: em terreno plano, sem suavizar, a tela
  // vira um salpicado de "plano" e "suave ondulado" pixel a pixel
  const dem = suavizar(bruto, z >= 14 ? 3 : 2);
  const mpp = metrosPorPixel(z, y);
  // base de ~90 m entre as duas leituras (45 m para cada lado), no mínimo 1 pixel
  const k = Math.max(1, Math.round(45 / mpp));
  const dist = 2 * k * mpp;
  const img = new ImageData(LADO, LADO);
  const px = img.data;
  const em = (cx: number, cy: number) => dem[Math.min(LADO - 1, Math.max(0, cy)) * LADO + Math.min(LADO - 1, Math.max(0, cx))];
  for (let j = 0; j < LADO; j++) {
    for (let i = 0; i < LADO; i++) {
      const dx = (em(i + k, j) - em(i - k, j)) / dist;
      const dy = (em(i, j + k) - em(i, j - k)) / dist;
      const pct = Math.hypot(dx, dy) * 100;
      const c = CLASSES_DECLIVE.find((cl) => pct < cl.ate)!.cor;
      const p = (j * LADO + i) * 4;
      px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = 255;
    }
  }
  const tela = new OffscreenCanvas(LADO, LADO);
  tela.getContext("2d")!.putImageData(img, 0, 0);
  return (await tela.convertToBlob({ type: "image/png" })).arrayBuffer();
}

// ------------------------------------------------------------------ curvas de nível
/** Equidistância das curvas pelo zoom do tile; a curva mestra é a cada 5. */
export function equidistancia(z: number) {
  return z <= 11 ? 50 : z === 12 ? 20 : 10;
}

/** Média móvel 3 × 3 aplicada `vezes` vezes: tira o serrilhado do SRTM ampliado. */
function suavizar(h: Dem, vezes: number): Dem {
  let a = h;
  for (let v = 0; v < vezes; v++) {
    const b = new Float32Array(a.length);
    for (let j = 0; j < LADO; j++) {
      for (let i = 0; i < LADO; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= LADO) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= LADO) continue;
            s += a[jj * LADO + ii]; n++;
          }
        }
        b[j * LADO + i] = s / n;
      }
    }
    a = b;
  }
  return a;
}

type Linha = [number, number][];

/**
 * Isolinhas de uma cota pela tabela do marching squares. Cada travessia é
 * identificada pela aresta da grade em que cai (horizontal = par, vertical =
 * ímpar), o que permite emendar os segmentos em linhas contínuas.
 */
function isolinhas(h: Dem, L: number): Linha[] {
  const W = LADO;
  const H = (x: number, y: number) => (y * W + x) * 2; // aresta (x,y)–(x+1,y)
  const V = (x: number, y: number) => (y * W + x) * 2 + 1; // aresta (x,y)–(x,y+1)
  const segs: number[] = [];
  for (let y = 0; y < W - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = h[y * W + x], tr = h[y * W + x + 1], br = h[(y + 1) * W + x + 1], bl = h[(y + 1) * W + x];
      const caso = (tl >= L ? 8 : 0) | (tr >= L ? 4 : 0) | (br >= L ? 2 : 0) | (bl >= L ? 1 : 0);
      if (caso === 0 || caso === 15) continue;
      const topo = H(x, y), dir = V(x + 1, y), base = H(x, y + 1), esq = V(x, y);
      const centroAlto = (tl + tr + br + bl) / 4 >= L;
      switch (caso) {
        case 1: case 14: segs.push(esq, base); break;
        case 2: case 13: segs.push(base, dir); break;
        case 3: case 12: segs.push(esq, dir); break;
        case 4: case 11: segs.push(topo, dir); break;
        case 6: case 9: segs.push(topo, base); break;
        case 7: case 8: segs.push(esq, topo); break;
        case 5:
          if (centroAlto) segs.push(esq, topo, base, dir); else segs.push(topo, dir, esq, base);
          break;
        case 10:
          if (centroAlto) segs.push(topo, dir, esq, base); else segs.push(esq, topo, base, dir);
          break;
      }
    }
  }
  const n = segs.length / 2;
  if (!n) return [];
  // aresta → segmentos que passam por ela (no máximo dois)
  const viz = new Map<number, number[]>();
  for (let s = 0; s < n; s++) {
    for (const k of [segs[2 * s], segs[2 * s + 1]]) {
      const l = viz.get(k);
      if (l) l.push(s); else viz.set(k, [s]);
    }
  }
  const usado = new Uint8Array(n);
  const seguir = (inicio: number): number[] => {
    const out: number[] = [];
    let cur = inicio;
    for (;;) {
      const prox = viz.get(cur)?.find((s) => !usado[s]);
      if (prox === undefined) return out;
      usado[prox] = 1;
      cur = segs[2 * prox] === cur ? segs[2 * prox + 1] : segs[2 * prox];
      out.push(cur);
    }
  };
  // posição da travessia na aresta, em pixels; esticada para 0..255 cobrir o
  // tile inteiro e a curva encostar na do tile vizinho
  const ponto = (k: number): [number, number] => {
    const c = k >> 1, x = c % W, y = (c - x) / W;
    const a = h[y * W + x];
    const b = k & 1 ? h[(y + 1) * W + x] : h[y * W + x + 1];
    const t = b === a ? 0.5 : (L - a) / (b - a);
    return k & 1 ? [x, y + t] : [x + t, y];
  };
  const linhas: Linha[] = [];
  for (let s = 0; s < n; s++) {
    if (usado[s]) continue;
    usado[s] = 1;
    const frente = seguir(segs[2 * s + 1]);
    const tras = seguir(segs[2 * s]);
    const chaves = [...tras.reverse(), segs[2 * s], segs[2 * s + 1], ...frente];
    if (chaves.length >= 3) linhas.push(chaves.map(ponto));
  }
  return linhas;
}

// ---- codificador MVT mínimo (só LineString), especificação 2.1
class Bytes {
  b: number[] = [];
  varint(v: number) {
    while (v > 127) { this.b.push((v % 128) | 128); v = Math.floor(v / 128); }
    this.b.push(v);
  }
  chave(campo: number, tipo: number) { this.varint(campo * 8 + tipo); }
  bloco(campo: number, conteudo: number[]) { this.chave(campo, 2); this.varint(conteudo.length); for (const x of conteudo) this.b.push(x); }
  texto(campo: number, s: string) { this.bloco(campo, [...new TextEncoder().encode(s)]); }
}
const zz = (n: number) => (n << 1) ^ (n >> 31);
const EXTENT = 4096;

function codificarMvt(feicoes: { linha: Linha; ele: number; mestra: boolean }[]): ArrayBuffer {
  const valores: number[] = []; // cotas distintas; índice no vetor `values` do MVT
  const idxValor = new Map<number, number>();
  const camada = new Bytes();
  camada.chave(15, 0); camada.varint(2);
  camada.texto(1, "curvas");
  const escala = EXTENT / (LADO - 1);
  for (const f of feicoes) {
    const pts: [number, number][] = [];
    for (const [x, y] of f.linha) {
      const p: [number, number] = [Math.round(x * escala), Math.round(y * escala)];
      const u = pts[pts.length - 1];
      if (!u || u[0] !== p[0] || u[1] !== p[1]) pts.push(p);
    }
    if (pts.length < 2) continue;
    let vi = idxValor.get(f.ele);
    if (vi === undefined) { vi = valores.length + 2; idxValor.set(f.ele, vi); valores.push(f.ele); }
    const geo = new Bytes();
    geo.varint(9); // MoveTo, 1 ponto
    geo.varint(zz(pts[0][0])); geo.varint(zz(pts[0][1]));
    geo.varint(2 | ((pts.length - 1) << 3)); // LineTo, n−1 pontos
    for (let i = 1; i < pts.length; i++) {
      geo.varint(zz(pts[i][0] - pts[i - 1][0])); geo.varint(zz(pts[i][1] - pts[i - 1][1]));
    }
    const tags = new Bytes();
    tags.varint(0); tags.varint(vi); // ele
    tags.varint(1); tags.varint(f.mestra ? 1 : 0); // mestra (valores 0 = falso, 1 = verdadeiro)
    const feat = new Bytes();
    feat.bloco(2, tags.b);
    feat.chave(3, 0); feat.varint(2); // LINESTRING
    feat.bloco(4, geo.b);
    camada.bloco(2, feat.b);
  }
  camada.texto(3, "ele");
  camada.texto(3, "mestra");
  // valores: [0] = false, [1] = true, depois as cotas (sint)
  for (const bool of [0, 1]) { const v = new Bytes(); v.chave(7, 0); v.varint(bool); camada.bloco(4, v.b); }
  for (const ele of valores) { const v = new Bytes(); v.chave(6, 0); v.varint(zz(ele)); camada.bloco(4, v.b); }
  camada.chave(5, 0); camada.varint(EXTENT);
  const tile = new Bytes();
  tile.bloco(3, camada.b);
  return new Uint8Array(tile.b).buffer;
}

/** Tile vetorial (camada `curvas`, atributos `ele` e `mestra`); vazio se o DEM não veio. */
export async function tileCurvas(z: number, x: number, y: number, sinal?: AbortSignal): Promise<ArrayBuffer> {
  const dem = await demDoTile(Math.min(z, DEM_ZOOM_MAX), x, y, sinal);
  if (!dem) return new ArrayBuffer(0);
  const h = suavizar(dem, z >= 14 ? 2 : 1);
  let min = Infinity, max = -Infinity;
  for (const v of h) { if (v < min) min = v; if (v > max) max = v; }
  const eq = equidistancia(z);
  const feicoes: { linha: Linha; ele: number; mestra: boolean }[] = [];
  for (let L = Math.ceil(min / eq) * eq; L <= max; L += eq) {
    const mestra = L % (eq * 5) === 0;
    for (const linha of isolinhas(h, L)) feicoes.push({ linha, ele: L, mestra });
  }
  return codificarMvt(feicoes);
}
