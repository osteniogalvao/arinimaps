/**
 * ENCAIXE AUTOMÁTICO DA PLANTA PELAS RUAS (áudio do Carlos, 25/11/2026: "estou
 * demorando tempo demais nas cartografias (...) como a gente faz para
 * automatizar, deixar os extremos mais alinhados?").
 *
 * É a mesma medição de scripts/confere-alinhamento.mjs (docs/ALINHAMENTO-PLANTAS.md),
 * agora resolvendo a correção em vez de só relatar:
 *
 *  - as ruas do OpenStreetMap foram traçadas sobre imagem de satélite; na
 *    planta, a rua é o vão entre as frentes dos lotes de um lado e do outro;
 *  - a cada 15 m de rua do OSM sai uma linha perpendicular de ±25 m, e a
 *    primeira linha da planta de cada lado dá as distâncias a e b. O desvio
 *    naquele ponto é (a − b) / 2, na direção perpendicular à rua;
 *  - com centenas desses desvios, em ruas de várias direções, os mínimos
 *    quadrados dão deslocamento, giro e escala de uma vez — o que fecha o
 *    centro E as pontas ("os extremos") ao mesmo tempo.
 *
 * Duas fases:
 *  1. BUSCA GROSSA só de deslocamento, numa grade de ±80 m: acha o encaixe mesmo
 *     com a planta longe (datum antigo, planta solta) — a linha de ±25 m sozinha
 *     não enxerga além disso.
 *  2. REFINO iterativo (ICP): a cada volta recalcula os desvios com a planta
 *     corrigida e resolve deslocamento + giro + escala, cortando discrepantes.
 *
 * Funciona para a planta inteira e para uma peça (quadra/bairro) separada: aí
 * só as linhas da peça se mexem, e as vizinhas servem de referência do outro
 * lado da rua (um lado só da peça move o meio do vão pela metade).
 *
 * O resultado sai como PARES DE CONTROLE (planta → satélite) para o mesmo
 * caminho dos pontos marcados à mão: a tela aplica com desfazer, mostra o erro
 * e o operador confere antes de salvar.
 *
 * Tudo aqui é cálculo puro (sem mapa, sem rede): testado em scripts/testa-encaixe-ruas.mjs.
 */

export type Ponto = [number, number];
export type Linha = Ponto[];

export type ParEncaixe = { planta: Ponto; satelite: Ponto };

export type ResultadoEncaixe = {
  pares: ParEncaixe[];
  /** amostras de rua usadas no ajuste final */
  amostras: number;
  /** desvio mediano (m) entre o meio do vão da planta e o eixo da rua, antes e depois */
  desvioAntesM: number | null;
  desvioDepoisM: number;
  /** fração das amostras de rua que passam a até 1,5 m do meio do vão, antes e depois */
  acertoAntes: number;
  acertoDepois: number;
  deslocamentoM: number;
  giroGraus: number;
  escala: number;
  /** só deslocou (peça pequena sem ajuste de tamanho) */
  soDeslocamento: boolean;
};

export type FalhaEncaixe = { erro: string; amostras: number; jaEncaixada?: boolean };

export type OpcoesEncaixe = {
  /** alcance da busca grossa de deslocamento, em metros */
  alcanceM?: number;
  /** limita o tempo de processamento das plantas muito grandes */
  maxAmostras?: number;
  /** só para teste: pula a busca grossa de giro */
  semGiroGrosso?: boolean;
  /** giros (graus) experimentados na busca grossa das plantas grandes */
  girosGrossos?: number[];
  /** peça pequena (< 250 m) só desloca, sem ajustar o tamanho */
  semEscalaPequena?: boolean;
};

const PASSO_AMOSTRA_M = 15;
const MARGEM_ESQUINA_M = 8;
const SEGMENTO_MIN_M = 20;
const RAIO_M = 25;
const VAO_MIN_M = 6;
const VAO_MAX_M = 40;
const CELULA_M = 20;

type Seg = { x0: number; y0: number; x1: number; y1: number };
type Amostra = { px: number; py: number; nx: number; ny: number };

/** Projeção local em metros (leste, norte) em volta de um centro. */
function projecao(centro: Ponto) {
  const kx = 111_320 * Math.cos((centro[1] * Math.PI) / 180), ky = 110_540;
  return {
    ida: (p: Ponto): Ponto => [(p[0] - centro[0]) * kx, (p[1] - centro[1]) * ky],
    volta: (p: Ponto): Ponto => [centro[0] + p[0] / kx, centro[1] + p[1] / ky],
  };
}

/** Grade uniforme de segmentos: a linha de ±25 m só testa os segmentos das células por onde passa. */
class Indice {
  segs: Seg[];
  celulas = new Map<number, number[]>();
  constructor(segs: Seg[]) {
    this.segs = segs;
    segs.forEach((s, i) => {
      const cx0 = Math.floor(Math.min(s.x0, s.x1) / CELULA_M), cx1 = Math.floor(Math.max(s.x0, s.x1) / CELULA_M);
      const cy0 = Math.floor(Math.min(s.y0, s.y1) / CELULA_M), cy1 = Math.floor(Math.max(s.y0, s.y1) / CELULA_M);
      // segmento enorme (moldura, linha corrompida) entupiria a grade: fica de fora
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 400) return;
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const k = chave(cx, cy);
        const l = this.celulas.get(k);
        if (l) l.push(i); else this.celulas.set(k, [i]);
      }
    });
  }
  /**
   * Primeira linha de cada lado do ponto, ao longo da normal (até ±RAIO_M).
   * Devolve [a, b] com a = distância do lado +n e b do lado −n (Infinity se não há).
   */
  cortes(px: number, py: number, nx: number, ny: number, marca: Uint32Array, volta: number): [number, number] {
    let a = Infinity, b = Infinity;
    const xa = px - RAIO_M * nx, ya = py - RAIO_M * ny, xb = px + RAIO_M * nx, yb = py + RAIO_M * ny;
    const cx0 = Math.floor(Math.min(xa, xb) / CELULA_M), cx1 = Math.floor(Math.max(xa, xb) / CELULA_M);
    const cy0 = Math.floor(Math.min(ya, yb) / CELULA_M), cy1 = Math.floor(Math.max(ya, yb) / CELULA_M);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const lista = this.celulas.get(chave(cx, cy));
      if (!lista) continue;
      for (const i of lista) {
        if (marca[i] === volta) continue;
        marca[i] = volta;
        const s = this.segs[i];
        // interseção da reta p + t·n com o segmento s0 + u·(s1 − s0)
        const ex = s.x1 - s.x0, ey = s.y1 - s.y0;
        // só vale linha paralela à rua (frente de lote, meio-fio, calçada): a
        // perpendicular é divisa entre lotes, e traço curto é número, árvore, símbolo
        const len = Math.hypot(ex, ey);
        if (len < 2 || Math.abs(ex * nx + ey * ny) > 0.34 * len) continue;
        const den = nx * ey - ny * ex;
        if (Math.abs(den) < 1e-9) continue;
        const qx = s.x0 - px, qy = s.y0 - py;
        const t = (qx * ey - qy * ex) / den;
        const u = (qx * ny - qy * nx) / den;
        if (u < 0 || u > 1) continue;
        if (t > 0.3 && t < a) a = t;
        else if (t < -0.3 && -t < b) b = -t;
      }
    }
    return [a <= RAIO_M ? a : Infinity, b <= RAIO_M ? b : Infinity];
  }
  /**
   * O eixo da rua, no trecho de ±meio metros em volta do ponto, atravessa
   * alguma linha da planta quase perpendicular a ele? Rua de verdade não passa
   * por dentro de quadra: com a planta deslocada meia quadra, a rua cai entre
   * divisas de lote paralelas a ela (que imitam um vão) mas cruza a frente das
   * quadras a cada esquina — é isso que separa o encaixe certo do falso.
   */
  atravessa(px: number, py: number, tx: number, ty: number, meio: number, marca: Uint32Array, volta: number): boolean {
    const xa = px - meio * tx, ya = py - meio * ty, xb = px + meio * tx, yb = py + meio * ty;
    const cx0 = Math.floor(Math.min(xa, xb) / CELULA_M), cx1 = Math.floor(Math.max(xa, xb) / CELULA_M);
    const cy0 = Math.floor(Math.min(ya, yb) / CELULA_M), cy1 = Math.floor(Math.max(ya, yb) / CELULA_M);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const lista = this.celulas.get(chave(cx, cy));
      if (!lista) continue;
      for (const i of lista) {
        if (marca[i] === volta) continue;
        marca[i] = volta;
        const s = this.segs[i];
        const ex = s.x1 - s.x0, ey = s.y1 - s.y0, len = Math.hypot(ex, ey);
        if (len < 2 || Math.abs(ex * tx + ey * ty) > 0.5 * len) continue;
        const den = tx * ey - ty * ex;
        if (Math.abs(den) < 1e-9) continue;
        const qx = s.x0 - px, qy = s.y0 - py;
        const t = (qx * ey - qy * ex) / den, u = (qx * ty - qy * tx) / den;
        if (u >= 0 && u <= 1 && Math.abs(t) <= meio) return true;
      }
    }
    return false;
  }
}
const chave = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

function segmentosDe(linhas: Linha[], conv: (p: Ponto) => Ponto): Seg[] {
  const out: Seg[] = [];
  for (const l of linhas) {
    let ant: Ponto | null = null;
    for (const p of l) {
      const q = conv(p);
      if (ant && (ant[0] !== q[0] || ant[1] !== q[1])) out.push({ x0: ant[0], y0: ant[1], x1: q[0], y1: q[1] });
      ant = q;
    }
  }
  return out;
}

/** Pontos a cada 15 m nos trechos retos de rua, longe das esquinas, com a normal do trecho. */
function amostrasDasRuas(ruas: Linha[], conv: (p: Ponto) => Ponto): Amostra[] {
  const out: Amostra[] = [];
  for (const r of ruas) for (let i = 1; i < r.length; i++) {
    const [x0, y0] = conv(r[i - 1]), [x1, y1] = conv(r[i]);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < SEGMENTO_MIN_M) continue;
    const tx = (x1 - x0) / len, ty = (y1 - y0) / len;
    for (let d = MARGEM_ESQUINA_M; d <= len - MARGEM_ESQUINA_M; d += PASSO_AMOSTRA_M) {
      out.push({ px: x0 + tx * d, py: y0 + ty * d, nx: -ty, ny: tx });
    }
  }
  return out;
}

type Medida = { mx: number; my: number; nx: number; ny: number; o: number; f: number };

/**
 * Desvio em cada amostra. `fixo` são as linhas que não se mexem (vizinhas da
 * peça); `movel` as que se mexem, deslocadas por (dx, dy) sem refazer o índice.
 * f = quanto o meio do vão anda quando a parte móvel anda 1 m (1 = os dois
 * lados móveis, 0,5 = um lado só). Amostra sem nenhum lado móvel não serve.
 */
function medir(amostras: Amostra[], movel: Indice, fixo: Indice | null, dx: number, dy: number,
  marcas: { m: Uint32Array; f: Uint32Array; volta: number }): Medida[] & { cruzam: number } {
  const out = [] as unknown as Medida[] & { cruzam: number };
  out.cruzam = 0;
  for (const s of amostras) {
    marcas.volta++;
    // trecho do eixo entre esta amostra e a próxima (passo de 15 m)
    if (movel.atravessa(s.px - dx, s.py - dy, s.ny, -s.nx, PASSO_AMOSTRA_M / 2, marcas.m, marcas.volta) ||
      (fixo && fixo.atravessa(s.px, s.py, s.ny, -s.nx, PASSO_AMOSTRA_M / 2, marcas.f, marcas.volta))) {
      out.cruzam++;
      continue;
    }
    marcas.volta++;
    const [am, bm] = movel.cortes(s.px - dx, s.py - dy, s.nx, s.ny, marcas.m, marcas.volta);
    let a = am, b = bm, ma = am < Infinity, mb = bm < Infinity;
    if (fixo) {
      const [af, bf] = fixo.cortes(s.px, s.py, s.nx, s.ny, marcas.f, marcas.volta);
      if (af < a) { a = af; ma = false; }
      if (bf < b) { b = bf; mb = false; }
    }
    if (a === Infinity || b === Infinity || (!ma && !mb)) continue;
    const vao = a + b;
    if (vao < VAO_MIN_M || vao > VAO_MAX_M) continue;
    const o = (a - b) / 2;
    out.push({ mx: s.px + o * s.nx, my: s.py + o * s.ny, nx: s.nx, ny: s.ny, o, f: ma && mb ? 1 : 0.5 });
  }
  return out;
}

function mediana(v: number[]) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Sistema normal 4×4 (ou 2×2) resolvido por eliminação de Gauss com pivô. */
function resolver(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((l, i) => [...l, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((l, i) => l[n] / l[i]);
}

/**
 * Correção pequena δ(x) = t + θ·⊥(x − c) + σ·(x − c), resolvida por mínimos
 * quadrados de f·n·δ(m) = −o, com uma rodada de corte de discrepantes.
 */
type ModoAjuste = "desloca" | "escala" | "completo";
function ajustarPasso(ms: Medida[], c: Ponto, modo: ModoAjuste) {
  const linha = (m: Medida) => {
    const rx = m.mx - c[0], ry = m.my - c[1];
    // n·⊥(r) com ⊥(r) = (−ry, rx), normalizado por 100 m para o sistema ficar bem condicionado
    const base = [m.f * m.nx, m.f * m.ny];
    const esc = (m.f * (m.nx * rx + m.ny * ry)) / 100;
    if (modo === "escala") return [...base, esc];
    return modo === "completo" ? [...base, (m.f * (-m.nx * ry + m.ny * rx)) / 100, esc] : base;
  };
  const resolve = (lista: Medida[]) => {
    const k = modo === "completo" ? 4 : modo === "escala" ? 3 : 2;
    const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
    for (const m of lista) {
      const l = linha(m);
      // peso robusto: amostra longe do meio do vão (árvore, rua mal traçada no
      // OSM, loteamento não executado) pesa pouco — é a mesma régua da nota
      const w = Math.exp(-((m.o / 3) ** 2));
      for (let i = 0; i < k; i++) { b[i] += -w * m.o * l[i]; for (let j = 0; j < k; j++) A[i][j] += w * l[i] * l[j]; }
    }
    // amortecimento leve: rua numa direção só não pode virar deslocamento infinito ao longo dela
    for (let i = 0; i < k; i++) A[i][i] += 1e-4 * lista.length;
    return resolver(A, b);
  };
  let x = resolve(ms);
  if (!x) return null;
  const res = (m: Medida, x: number[]) => m.o + linha(m).reduce((s, v, i) => s + v * x[i], 0);
  const sigma = Math.sqrt(ms.reduce((s, m) => s + res(m, x!) ** 2, 0) / ms.length);
  const boas = ms.filter((m) => Math.abs(res(m, x!)) <= Math.max(1.5, 2.5 * sigma));
  if (boas.length >= 6) x = resolve(boas) ?? x;
  return {
    tx: x[0], ty: x[1], th: modo === "completo" ? x[2] / 100 : 0,
    sg: modo === "completo" ? x[3] / 100 : modo === "escala" ? x[2] / 100 : 0,
    boas: boas.length,
  };
}

/** Similaridade acumulada em metros: p' = c + (1+σ)·R(θ)·(p − c) + t, guardada como matriz. */
type Sim = { a: number; b: number; tx: number; ty: number };
const aplicar = (s: Sim, c: Ponto, p: Ponto): Ponto => {
  const rx = p[0] - c[0], ry = p[1] - c[1];
  return [c[0] + s.a * rx - s.b * ry + s.tx, c[1] + s.b * rx + s.a * ry + s.ty];
};
/** δ ∘ s, com δ linearizada = (1+σ, θ) e deslocamento (tx, ty). */
function compor(s: Sim, d: { tx: number; ty: number; th: number; sg: number }): Sim {
  const a = 1 + d.sg, b = d.th;
  return { a: a * s.a - b * s.b, b: b * s.a + a * s.b, tx: a * s.tx - b * s.ty + d.tx, ty: b * s.tx + a * s.ty + d.ty };
}

/**
 * Calcula o encaixe. `movel` = linhas que vão se mexer (como estão na tela, em
 * graus), `fixo` = linhas que ficam (vizinhas, quando o ajuste é de uma peça),
 * `ruas` = eixos das ruas do OSM em graus.
 */
export function encaixarPelasRuas(movel: Linha[], fixo: Linha[], ruas: Linha[], opcoes: OpcoesEncaixe = {}): ResultadoEncaixe | FalhaEncaixe {
  const alcance = opcoes.alcanceM ?? 80, maxAmostras = opcoes.maxAmostras ?? 4000;
  // centro e extensão da parte que se mexe
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of movel) for (const p of l) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  if (!Number.isFinite(x0)) return { erro: "Não há linhas da planta para encaixar nesta vista.", amostras: 0 };
  const geo = projecao([(x0 + x1) / 2, (y0 + y1) / 2]);
  const [ex0, ey0] = geo.ida([x0, y0]), [ex1, ey1] = geo.ida([x1, y1]);
  const extensao = Math.hypot(ex1 - ex0, ey1 - ey0);

  const segsMovel = segmentosDe(movel, geo.ida);
  const segsFixo = fixo.length ? segmentosDe(fixo, geo.ida) : [];
  // só interessa rua perto da parte que se mexe (com folga para a busca grossa)
  const folga = alcance + RAIO_M;
  let amostras = amostrasDasRuas(ruas, geo.ida).filter((s) =>
    s.px > ex0 - folga && s.px < ex1 + folga && s.py > ey0 - folga && s.py < ey1 + folga);
  if (amostras.length > maxAmostras) {
    const passo = amostras.length / maxAmostras;
    amostras = Array.from({ length: maxAmostras }, (_, i) => amostras[Math.floor(i * passo)]);
  }
  if (amostras.length < 8) {
    return { erro: "O OpenStreetMap não tem ruas suficientes neste trecho para medir o encaixe.", amostras: amostras.length };
  }

  // ponto de giro: o meio das ruas medidas (a moldura e as linhas soltas longe da cidade não puxam o giro)
  // (na peça pequena o giro é o próprio centro dela: a escala cresce por igual para os quatro lados)
  const c: Ponto = extensao < 250 ? [(ex0 + ex1) / 2, (ey0 + ey1) / 2]
    : [amostras.reduce((s, a) => s + a.px, 0) / amostras.length, amostras.reduce((s, a) => s + a.py, 0) / amostras.length];
  const fixoIdx = segsFixo.length ? new Indice(segsFixo) : null;
  const marcas = { m: new Uint32Array(segsMovel.length), f: new Uint32Array(segsFixo.length), volta: 0 };
  let movelIdx = new Indice(segsMovel);

  const antes = medir(amostras, movelIdx, fixoIdx, 0, 0, marcas);
  const desvioAntesM = antes.length ? mediana(antes.map((m) => Math.abs(m.o))) : null;

  // ---- 1. busca grossa: deslocamento, depois giro ----
  // nota de um encaixe: quantas ruas passam no meio do vão (sino de ~4 m).
  // Medido em Iturama (26/11/2026): com 250 amostras o pico verdadeiro se
  // perdia no ruído; com ~1.000 ele aparece claro.
  const passoG = Math.max(1, Math.ceil(amostras.length / 1000));
  const grossas = amostras.filter((_, i) => i % passoG === 0);
  const nota = (dx: number, dy: number, largura = 4) => {
    let s = 0;
    const ms = medir(grossas, movelIdx, fixoIdx, dx, dy, marcas);
    for (const m of ms) s += Math.exp(-((m.o / largura) ** 2)) * m.f;
    s -= ms.cruzam;
    // preferência leve pelo deslocamento menor: em grade de quadras regular, um quarteirão inteiro também "encaixa"
    return s * (1 - 0.03 * Math.hypot(dx, dy) / alcance);
  };
  const girar = (giro: number) => {
    const r = (giro * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
    movelIdx = new Indice(giro === 0 ? segsMovel : segsMovel.map((s) => ({
      x0: c[0] + co * (s.x0 - c[0]) - si * (s.y0 - c[1]), y0: c[1] + si * (s.x0 - c[0]) + co * (s.y0 - c[1]),
      x1: c[0] + co * (s.x1 - c[0]) - si * (s.y1 - c[1]), y1: c[1] + si * (s.x1 - c[0]) + co * (s.y1 - c[1]),
    })));
    marcas.m = new Uint32Array(segsMovel.length);
  };
  const varrer = (giro: number, cx: number, cy: number, raio: number, passo: number, atual: { dx: number; dy: number; giro: number; nota: number }) => {
    let m = atual;
    for (let dx = cx - raio; dx <= cx + raio; dx += passo) for (let dy = cy - raio; dy <= cy + raio; dy += passo) {
      if (Math.hypot(dx, dy) > alcance + 1) continue;
      const n = nota(dx, dy);
      if (n > m.nota) m = { dx, dy, giro, nota: n };
    }
    return m;
  };
  // 1a. grade larga (10 m, sino de 10 m, ~400 amostras) para cada giro
  // candidato — planta grande girada 1–2° abre dezenas de metros nas pontas e o
  // deslocamento sozinho não acha o encaixe; 1b. os quatro melhores são
  // refinados de 2 em 2 m com o sino normal e ~1.000 amostras
  const leves = grossas.filter((_, i) => i % Math.max(1, Math.ceil(grossas.length / 400)) === 0);
  const notaLeve = (dx: number, dy: number) => {
    const ms = medir(leves, movelIdx, fixoIdx, dx, dy, marcas);
    let s = -ms.cruzam;
    for (const m of ms) s += Math.exp(-((m.o / 10) ** 2)) * m.f;
    return s * (1 - 0.03 * Math.hypot(dx, dy) / alcance);
  };
  const giros = extensao >= 600 && !opcoes.semGiroGrosso ? opcoes.girosGrossos ?? [0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2, -3, 3] : [0];
  const topo: { dx: number; dy: number; giro: number; nota: number }[] = [];
  for (const giro of giros) {
    girar(giro);
    for (let dx = -alcance; dx <= alcance; dx += 10) for (let dy = -alcance; dy <= alcance; dy += 10) {
      if (Math.hypot(dx, dy) > alcance + 5) continue;
      topo.push({ dx, dy, giro, nota: notaLeve(dx, dy) });
    }
  }
  topo.sort((p, q) => q.nota - p.nota);
  girar(0);
  let melhor = { dx: 0, dy: 0, giro: 0, nota: nota(0, 0) };
  // quatro picos distintos (vizinhos do mesmo pico não contam duas vezes)
  const escolhidos: typeof topo = [];
  for (const t of topo) {
    if (escolhidos.some((e) => e.giro === t.giro && Math.hypot(e.dx - t.dx, e.dy - t.dy) < 25)) continue;
    escolhidos.push(t);
    if (escolhidos.length === 4) break;
  }
  escolhidos.sort((p, q) => p.giro - q.giro);
  let giroAtual = 0;
  for (const t of escolhidos) {
    if (t.giro !== giroAtual) { girar(t.giro); giroAtual = t.giro; }
    melhor = varrer(t.giro, t.dx, t.dy, 8, 2, melhor);
  }
  if (melhor.giro !== giroAtual) girar(melhor.giro);
  // ---- 2. refino: deslocamento + giro + escala ----
  // peça pequena (uma quadra) não mede giro com confiança, mas mede o tamanho:
  // áudio do Carlos (26/11/2026) — "tem umas que o desenho está certo, só que o
  // tamanho não se enquadra"; a quadra cresce ou encolhe por igual, sem girar,
  // até as frentes caírem no meio das ruas dos quatro lados
  const completo = extensao >= 250;
  const modoPeca: ModoAjuste = completo ? "completo" : opcoes.semEscalaPequena ? "desloca" : "escala";
  const r0 = (melhor.giro * Math.PI) / 180;
  let sim: Sim = { a: Math.cos(r0), b: Math.sin(r0), tx: melhor.dx, ty: melhor.dy };
  // nota fina de um encaixe: ruas que passam a até ~2 m do meio do vão
  const notaFina = (ms: Medida[] & { cruzam: number }) => ms.reduce((t, m) => t + m.f * Math.exp(-((m.o / 2) ** 2)), 0) - ms.cruzam;
  // base: as amostras que caem entre quadras (antes ou depois) — rua do OSM fora
  // da planta ou sem lote dos dois lados não entra na porcentagem
  let base = Math.max(1, antes.length);
  const acerto = (ms: Medida[]) => ms.filter((m) => Math.abs(m.o) <= 1.5).length / Math.max(base, ms.length);
  const medirCom = (s: Sim) => {
    const idx = new Indice(segsMovel.map((g) => {
      const [ax, ay] = aplicar(s, c, [g.x0, g.y0]), [bx, by] = aplicar(s, c, [g.x1, g.y1]);
      return { x0: ax, y0: ay, x1: bx, y1: by };
    }));
    return medir(amostras, idx, fixoIdx, 0, 0, { m: new Uint32Array(segsMovel.length), f: marcas.f, volta: ++marcas.volta });
  };
  let melhorSim = sim, melhorMs = [] as unknown as Medida[] & { cruzam: number }, melhorNota = -Infinity;
  for (let volta = 0; volta < 15; volta++) {
    const ms = medirCom(sim);
    const n = notaFina(ms);
    if (n > melhorNota) { melhorNota = n; melhorSim = sim; melhorMs = ms; }
    if (ms.length < 8) break;
    const d = ajustarPasso(ms, c, modoPeca === "completo" ? (ms.length >= 30 ? "completo" : "desloca") : modoPeca === "escala" && ms.length >= 12 ? "escala" : "desloca");
    if (!d) break;
    sim = compor(sim, d);
    if (Math.hypot(d.tx, d.ty) < 0.03 && Math.abs(d.th) < 1e-5 && Math.abs(d.sg) < 1e-5) {
      const ms2 = medirCom(sim), n2 = notaFina(ms2);
      if (n2 > melhorNota) { melhorNota = n2; melhorSim = sim; melhorMs = ms2; }
      break;
    }
  }
  sim = melhorSim;
  const depois = melhorMs;
  base = Math.max(base, depois.length);
  if (depois.length < 8) {
    return { erro: "Poucas ruas do OpenStreetMap passam entre as quadras da planta neste trecho. Aproxime outra região ou marque os pontos à mão.", amostras: depois.length };
  }
  // não piora o que já estava bom: se o encaixe não ganha das ruas, avisa e não mexe
  const notaAntes = notaFina(antes);
  if (melhorNota <= notaAntes * 1.03) {
    return { erro: `Esta ${fixo.length ? "peça" : "planta"} já está no melhor encaixe que as ruas do OpenStreetMap conseguem medir aqui (${Math.round(acerto(antes) * 100)}% das ruas no meio do vão). Se ainda parecer torta, ajuste à mão ou separe a quadra.`, amostras: antes.length, jaEncaixada: true };
  }
  const escala = Math.hypot(sim.a, sim.b);
  const giroGraus = (Math.atan2(sim.b, sim.a) * 180) / Math.PI;
  if (escala < 0.9 || escala > 1.1 || Math.abs(giroGraus) > 10) {
    return { erro: "O encaixe pelas ruas deu um giro ou escala fora do razoável. Aproxime o mapa num trecho com mais ruas.", amostras: depois.length };
  }

  // pares de controle nos cantos da parte móvel: o caminho dos pontos marcados à mão refaz a mesma similaridade
  const cantos: Ponto[] = [[ex0, ey0], [ex1, ey0], [ex1, ey1], [ex0, ey1]];
  const pares = cantos.map((p) => ({ planta: geo.volta(p), satelite: geo.volta(aplicar(sim, c, p)) }));
  return {
    pares,
    amostras: depois.length,
    desvioAntesM,
    desvioDepoisM: mediana(depois.map((m) => Math.abs(m.o))),
    acertoAntes: acerto(antes),
    acertoDepois: acerto(depois),
    deslocamentoM: Math.hypot(sim.tx, sim.ty),
    giroGraus,
    escala,
    soDeslocamento: !completo && Math.abs(escala - 1) < 1e-4,
  };
}

/**
 * Camadas do CAD que atrapalham a medição: árvore, canteiro e texto ficam na
 * calçada e seriam a "primeira linha" antes da frente do lote. Eixo de rua
 * cai no meio do vão e quebraria a conta dos dois lados.
 */
const CAMADA_RUIDO = /paisag|veget|jardin|arvor|árvor|forra|tronco|legend|texto|cota|dim\b|dim[-_ ]|eixo|hach|quaresm|acerola|amora|pau.?brasil|ip[eê]\b|palmeir|grama|piso|tátil|tatil|simbol|símbol|carimbo/i;

/**
 * Linhas da planta que servem para o encaixe, em graus. Fica de fora o que é
 * pequeno demais para ser frente de lote (símbolo, copa de árvore: < 4 m) e as
 * camadas de ruído acima.
 */
export function linhasParaEncaixe(fc: GeoJSON.FeatureCollection): Linha[] {
  const out: Linha[] = [];
  const kx = 111_320 * 0.94, ky = 110_540; // só para medir tamanho: o cosseno de ~20° basta
  const serve = (l: GeoJSON.Position[]) => {
    if (l.length < 2) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of l) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    if (Math.hypot((x1 - x0) * kx, (y1 - y0) * ky) < 4) return;
    out.push(l as Linha);
  };
  for (const f of fc.features) {
    if (CAMADA_RUIDO.test(String(f.properties?.layer ?? ""))) continue;
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") serve(g.coordinates);
    else if (g.type === "MultiLineString" || g.type === "Polygon") g.coordinates.forEach(serve);
    else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach(serve));
  }
  return out;
}

export const ehFalhaEncaixe =(r: ResultadoEncaixe | FalhaEncaixe): r is FalhaEncaixe => "erro" in r;

/** Só para diagnóstico em scripts: nota de cada deslocamento (dx, dy) em metros, sem giro. */
export function _mapaDeNotas(movel: Linha[], ruas: Linha[], deslocamentos: Ponto[], sigma = 3) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of movel) for (const p of l) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const geo = projecao([(x0 + x1) / 2, (y0 + y1) / 2]);
  const idx = new Indice(segmentosDe(movel, geo.ida));
  const am = amostrasDasRuas(ruas, geo.ida);
  const marcas = { m: new Uint32Array(idx.segs.length), f: new Uint32Array(0), volta: 0 };
  return deslocamentos.map(([dx, dy]) => {
    const ms = medir(am, idx, null, dx, dy, marcas);
    return { dx, dy, validas: ms.length, nota: ms.reduce((s, m) => s + Math.exp(-((m.o / sigma) ** 2)), 0) };
  });
}

/**
 * Retângulo das linhas pelos percentis dos vértices (0,01 e 0,99 = ignora o
 * 1% mais distante de cada lado): moldura, carimbo e linha corrompida longe da
 * cidade não alargam a busca de ruas.
 */
export function caixaRobusta(linhas: Linha[], pIni: number, pFim: number): [number, number, number, number] {
  const xs: number[] = [], ys: number[] = [];
  let k = 0;
  const total = linhas.reduce((s, l) => s + l.length, 0), passo = Math.max(1, Math.floor(total / 50_000));
  for (const l of linhas) for (const p of l) if (k++ % passo === 0) { xs.push(p[0]); ys.push(p[1]); }
  if (!xs.length) return [0, 0, 0, 0];
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (v: number[], f: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
  return [q(xs, pIni), q(ys, pIni), q(xs, pFim), q(ys, pFim)];
}

/**
 * A similaridade que os pares descrevem (são exatos: saem de uma), aplicável a
 * qualquer ponto em graus. Serve para encadear passadas do encaixe.
 */
export function similaridadeDosPares(pares: ParEncaixe[]): (p: Ponto) => Ponto {
  const geo = projecao(pares[0].planta);
  const a = geo.ida(pares[0].planta), b = geo.ida(pares[2].planta);
  const A = geo.ida(pares[0].satelite), B = geo.ida(pares[2].satelite);
  const dz = [b[0] - a[0], b[1] - a[1]], dZ = [B[0] - A[0], B[1] - A[1]], den = dz[0] ** 2 + dz[1] ** 2 || 1;
  const k = [(dZ[0] * dz[0] + dZ[1] * dz[1]) / den, (dZ[1] * dz[0] - dZ[0] * dz[1]) / den];
  return (p) => {
    const [x, y] = geo.ida(p), rx = x - a[0], ry = y - a[1];
    return geo.volta([A[0] + k[0] * rx - k[1] * ry, A[1] + k[1] * rx + k[0] * ry]);
  };
}

/**
 * Até três passadas: a primeira acha o encaixe grosso (o giro de uma planta
 * grande sai aproximado), as seguintes partem dali e fecham o resto. Medido em
 * Iturama girada 0,8° e esticada 0,8%: 1 passada recupera metade, 3 fecham.
 */
export function encaixarEmPassadas(movel: Linha[], fixo: Linha[], ruas: Linha[],
  aoPassar?: (passada: number) => void, passadas = 3): ResultadoEncaixe | FalhaEncaixe {
  let atual = movel, primeiro: ResultadoEncaixe | null = null, ultimo: ResultadoEncaixe | null = null;
  let soma: ((p: Ponto) => Ponto) | null = null;
  for (let i = 0; i < passadas; i++) {
    aoPassar?.(i + 1);
    // da segunda passada em diante a planta já está perto: busca curta e giro fino
    const r = encaixarPelasRuas(atual, fixo, ruas, i ? { alcanceM: 30, girosGrossos: [0, -0.25, 0.25, -0.5, 0.5] } : {});
    if (ehFalhaEncaixe(r)) {
      if (!ultimo) return r;
      break;
    }
    primeiro ??= r;
    ultimo = r;
    const s = similaridadeDosPares(r.pares);
    const antes: (p: Ponto) => Ponto = soma ?? ((p) => p);
    soma = (p) => s(antes(p));
    atual = atual.map((l) => l.map(s));
    // passou a mexer pouco: não vale outra passada
    if (r.deslocamentoM < 0.5 && Math.abs(r.giroGraus) < 0.01 && Math.abs(r.escala - 1) < 1e-4) break;
  }
  const total = soma as ((p: Ponto) => Ponto) | null;
  if (!primeiro || !ultimo || !total) return { erro: "O encaixe não conseguiu medir esta planta.", amostras: 0 };
  // pares finais: cantos da planta como estava → onde a soma das passadas os levou
  const pares = primeiro.pares.map((p) => ({ planta: p.planta, satelite: total(p.planta) }));
  const geo = projecao(pares[0].planta);
  const [a, b] = [geo.ida(pares[0].planta), geo.ida(pares[2].planta)], [A, B] = [geo.ida(pares[0].satelite), geo.ida(pares[2].satelite)];
  const escala = Math.hypot(B[0] - A[0], B[1] - A[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  const giro = (Math.atan2(B[1] - A[1], B[0] - A[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180 / Math.PI;
  const centro = (q: Ponto[]) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
  const [cx, cy] = centro(pares.map((p) => geo.ida(p.planta))), [cX, cY] = centro(pares.map((p) => geo.ida(p.satelite)));
  return {
    ...ultimo,
    pares,
    desvioAntesM: primeiro.desvioAntesM,
    acertoAntes: primeiro.acertoAntes,
    deslocamentoM: Math.hypot(cX - cx, cY - cy),
    giroGraus: ((giro + 540) % 360) - 180,
    escala,
  };
}
