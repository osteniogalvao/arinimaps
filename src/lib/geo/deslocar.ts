/**
 * Transformação da planta CAD sobre o mapa.
 *
 * A calibração antiga só arrastava (offset leste/norte). Isso resolve o erro de
 * datum — SAD 69 desloca ~66 m no Pontal do Triângulo — mas não resolve planta
 * que fecha no centro e abre nas pontas, que é o que acontece quando o desenho
 * foi amarrado por um único ponto de referência. Aqui a transformação é de
 * similaridade: escala e giro em torno do centro da planta, depois deslocamento.
 *
 * Tudo é calculado em METROS locais em volta do centro da planta, e só então
 * volta para graus — trabalhar direto em graus faria o giro entortar, porque um
 * grau de longitude no Pontal vale ~105 km e um de latitude vale ~110,5 km.
 */

export type Transform = {
  offsetLesteM: number;
  offsetNorteM: number;
  rotacaoGraus: number;
  escala: number;
};

export const TRANSFORM_ZERO: Transform = {
  offsetLesteM: 0, offsetNorteM: 0, rotacaoGraus: 0, escala: 1,
};

/** metros por grau na latitude informada (WGS84, aproximação local). */
export function escalaLocal(lat: number) {
  return {
    porGrauLng: 111_320 * Math.cos((lat * Math.PI) / 180),
    porGrauLat: 110_540,
  };
}

/** metros → graus, para os passos de teclado da calibração. */
export function metrosParaGraus(leste: number, norte: number, lat = -19.5) {
  const k = escalaLocal(lat);
  return { lng: leste / k.porGrauLng, lat: norte / k.porGrauLat };
}

/** Centro (média do bbox) de uma coleção GeoJSON, em graus. */
export function centroDe(fc: GeoJSON.FeatureCollection): [number, number] {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const olhar = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      const [x, y] = c as [number, number];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      return;
    }
    if (Array.isArray(c)) for (const f of c) olhar(f);
  };
  for (const f of fc.features) {
    if (f.geometry && "coordinates" in f.geometry) olhar((f.geometry as { coordinates: unknown }).coordinates);
  }
  if (x0 > x1) return [0, 0];
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** Aplica a transformação a um ponto. Usada no mapa e na tela de calibração. */
export function transformarPonto(
  p: [number, number],
  centro: [number, number],
  t: Transform
): [number, number] {
  const k = escalaLocal(centro[1]);
  const dx = (p[0] - centro[0]) * k.porGrauLng;
  const dy = (p[1] - centro[1]) * k.porGrauLat;
  const rad = (t.rotacaoGraus * Math.PI) / 180;
  const cos = Math.cos(rad), sen = Math.sin(rad);
  const x = t.escala * (dx * cos - dy * sen) + t.offsetLesteM;
  const y = t.escala * (dx * sen + dy * cos) + t.offsetNorteM;
  return [centro[0] + x / k.porGrauLng, centro[1] + y / k.porGrauLat];
}

const ehIdentidade = (t: Transform) =>
  !t.offsetLesteM && !t.offsetNorteM && !t.rotacaoGraus && (t.escala === 1 || !t.escala);

/**
 * Aplica a transformação (e o filtro de layers do CAD) a uma coleção inteira.
 * `layersOcultos` some com vegetação, paisagismo e cotas sem reenviar o arquivo.
 */
export function transformarGeoJSON<T extends GeoJSON.FeatureCollection>(
  fc: T,
  centro: [number, number],
  t: Transform,
  layersOcultos: string[] = [],
  ajustes: AjusteLocal[] = []
): T {
  const esconder = new Set(layersOcultos);
  const features = esconder.size
    ? fc.features.filter((f) => !esconder.has(String(f.properties?.layer ?? "")))
    : fc.features;

  // com partes ajustadas, cada linha usa a matriz da sua parte (ou a da planta)
  if (ajustes.length) {
    const g = afim(centro, t);
    const matrizes = ajustes.map((a) => compor(g, afim(centroArea(a.area), a.t)));
    const areas = ajustes.map((a) => a.area);
    return {
      ...fc,
      features: features.map((f) => {
        if (!f.geometry || !("coordinates" in f.geometry)) return f;
        // o DXF chega como UMA MultiLineString por camada do CAD (União: 6
        // objetos, 7,7 mil linhas): a parte é decidida linha a linha
        if (f.geometry.type === "MultiLineString") {
          return {
            ...f,
            geometry: {
              ...f.geometry,
              coordinates: f.geometry.coordinates.map((l) => {
                const i = parteDaLinha(l as [number, number][], areas);
                return aplicarMatriz(l, i < 0 ? g : matrizes[i]) as GeoJSON.Position[];
              }),
            },
          };
        }
        const i = parteDaFeature(f, areas);
        return {
          ...f,
          geometry: { ...f.geometry, coordinates: aplicarMatriz((f.geometry as { coordinates: unknown }).coordinates, i < 0 ? g : matrizes[i]) },
        };
      }),
    } as T;
  }

  if (ehIdentidade(t)) return { ...fc, features } as T;

  const mover = (c: unknown): unknown => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      return transformarPonto(c as [number, number], centro, t);
    }
    return Array.isArray(c) ? c.map(mover) : c;
  };
  return {
    ...fc,
    features: features.map((f) => ({
      ...f,
      geometry: f.geometry && "coordinates" in f.geometry
        ? { ...f.geometry, coordinates: mover((f.geometry as { coordinates: unknown }).coordinates) }
        : f.geometry,
    })),
  } as T;
}

/** Compatibilidade: deslocamento puro em graus (usado onde não há giro). */
export function deslocarGeoJSON<T extends GeoJSON.FeatureCollection>(fc: T, dLng: number, dLat: number): T {
  if (!dLng && !dLat) return fc;
  const mover = (c: unknown): unknown => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      return [(c[0] as number) + dLng, (c[1] as number) + dLat];
    }
    return Array.isArray(c) ? c.map(mover) : c;
  };
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      geometry: f.geometry && "coordinates" in f.geometry
        ? { ...f.geometry, coordinates: mover((f.geometry as { coordinates: unknown }).coordinates) }
        : f.geometry,
    })),
  } as T;
}

export type ParDeControle = { planta: [number, number]; satelite: [number, number] };

/**
 * Ajuste por pontos de controle: o operador marca o mesmo canto de quadra na
 * planta e no satélite, e daí sai a transformação inteira.
 *
 * 1 par  → só desloca (a planta não gira nem muda de tamanho).
 * 2+ pares → similaridade por mínimos quadrados (deslocamento, giro e escala).
 *
 * O `residuoM` é o que dá honestidade ao resultado: com 2 pontos ele fecha
 * exato por construção, com 3 ou mais ele mostra quanto a planta ainda erra —
 * é o número que diz se vale continuar ajustando ou se o desenho é que está
 * torto.
 */
export function ajustarPorPontos(
  pares: ParDeControle[],
  centro: [number, number],
  base: Transform = TRANSFORM_ZERO
): (Transform & { residuoM: number }) | null {
  if (!pares.length) return null;
  const k = escalaLocal(centro[1]);
  const local = (p: [number, number]): [number, number] => [
    (p[0] - centro[0]) * k.porGrauLng,
    (p[1] - centro[1]) * k.porGrauLat,
  ];

  // a planta que o operador vê já está transformada; voltamos ao desenho cru
  const inversa = (p: [number, number]): [number, number] => {
    const [x, y] = local(p);
    const rad = (base.rotacaoGraus * Math.PI) / 180;
    const cos = Math.cos(rad), sen = Math.sin(rad);
    const s = base.escala || 1;
    const dx = (x - base.offsetLesteM) / s;
    const dy = (y - base.offsetNorteM) / s;
    return [dx * cos + dy * sen, -dx * sen + dy * cos];
  };

  const P = pares.map((p) => inversa(p.planta));
  const Q = pares.map((p) => local(p.satelite));

  if (pares.length === 1) {
    return {
      escala: 1, rotacaoGraus: 0,
      offsetLesteM: Q[0][0] - P[0][0],
      offsetNorteM: Q[0][1] - P[0][1],
      residuoM: 0,
    };
  }

  const media = (v: [number, number][]): [number, number] => [
    v.reduce((s, p) => s + p[0], 0) / v.length,
    v.reduce((s, p) => s + p[1], 0) / v.length,
  ];
  const pc = media(P), qc = media(Q);

  // similaridade 2D em forma complexa: a = Σ conj(P̂)·Q̂ / Σ |P̂|²
  let re = 0, im = 0, den = 0;
  for (let i = 0; i < P.length; i++) {
    const px = P[i][0] - pc[0], py = P[i][1] - pc[1];
    const qx = Q[i][0] - qc[0], qy = Q[i][1] - qc[1];
    re += px * qx + py * qy;
    im += px * qy - py * qx;
    den += px * px + py * py;
  }
  if (den < 1e-9) return null;
  const ax = re / den, ay = im / den;
  const escala = Math.hypot(ax, ay);
  const rad = Math.atan2(ay, ax);
  const cos = Math.cos(rad), sen = Math.sin(rad);
  const t: Transform = {
    escala,
    rotacaoGraus: (rad * 180) / Math.PI,
    offsetLesteM: qc[0] - escala * (pc[0] * cos - pc[1] * sen),
    offsetNorteM: qc[1] - escala * (pc[0] * sen + pc[1] * cos),
  };

  let soma = 0;
  for (let i = 0; i < P.length; i++) {
    const x = escala * (P[i][0] * cos - P[i][1] * sen) + t.offsetLesteM;
    const y = escala * (P[i][0] * sen + P[i][1] * cos) + t.offsetNorteM;
    soma += (x - Q[i][0]) ** 2 + (y - Q[i][1]) ** 2;
  }
  return { ...t, residuoM: Math.sqrt(soma / P.length) };
}

/**
 * Deslocamento típico entre datums antigos e SIRGAS 2000 no Pontal do
 * Triângulo — medido no DXF de Limeira do Oeste em 26/08/2026. Serve de ponto
 * de partida da calibração: aplica e o operador só faz o ajuste fino.
 */
export const DESLOCAMENTO_DATUM: Record<string, { leste: number; norte: number; rotulo: string }> = {
  sad69: { leste: -59.5, norte: 28.0, rotulo: "SAD 69 → SIRGAS 2000 (~66 m)" },
  corrego: { leste: -47.6, norte: 22.5, rotulo: "Córrego Alegre → SIRGAS 2000 (~53 m)" },
};

/* ------------------------------------------------------------------ partes
 *
 * AJUSTE POR PARTE. A calibração acima move a planta inteira. Quando só um
 * bairro ou uma quadra está fora (o norte de Iturama erra 5–11 m e o resto da
 * cidade bate), mover tudo desalinha o que já estava certo. Uma parte é uma
 * área desenhada sobre a planta com o seu próprio deslocamento e giro.
 *
 * - A área fica em coordenadas do DESENHO CRU (antes de qualquer calibração):
 *   recalibrar a planta inteira depois não tira a parte do lugar.
 * - Uma linha pertence à parte quando o centro dela cai dentro da área; a
 *   primeira parte que a contém vence (a API recusa áreas sobrepostas).
 * - Posição final = calibração da planta ∘ ajuste da parte (o ajuste da parte
 *   é em metros, em torno do centro da área, antes do giro da planta).
 * - Parte é rígida: desloca e gira, não muda de tamanho — o lote continua com
 *   a área medida.
 *
 * As mesmas contas existem em JS no worker (worker/jobs/ajustes.mjs) para gerar
 * os lotes e no banco (fn_ajustar_lotes_parte) para mover os lotes no lugar.
 */

export type AjusteLocal = {
  id: string;
  nome: string;
  /** anel da área, em graus, no desenho cru */
  area: [number, number][];
  t: Transform;
};

/** Matriz 2D no formato do ST_Affine: x' = a·x + b·y + xoff ; y' = d·x + e·y + yoff. */
export type Matriz = { a: number; b: number; d: number; e: number; xoff: number; yoff: number };

/** A transformação de similaridade em graus — a mesma conta de transformarPonto(). */
export function afim(centro: [number, number], t: Transform): Matriz {
  const [cx, cy] = centro;
  const k = escalaLocal(cy);
  const rad = (t.rotacaoGraus * Math.PI) / 180, cos = Math.cos(rad), sen = Math.sin(rad), s = t.escala || 1;
  const a = s * cos, b = (-s * sen * k.porGrauLat) / k.porGrauLng;
  const d = (s * sen * k.porGrauLng) / k.porGrauLat, e = s * cos;
  return {
    a, b, d, e,
    xoff: cx - a * cx - b * cy + t.offsetLesteM / k.porGrauLng,
    yoff: cy - d * cx - e * cy + t.offsetNorteM / k.porGrauLat,
  };
}

/** m2 ∘ m1: aplica m1 e depois m2. */
export function compor(m2: Matriz, m1: Matriz): Matriz {
  return {
    a: m2.a * m1.a + m2.b * m1.d,
    b: m2.a * m1.b + m2.b * m1.e,
    d: m2.d * m1.a + m2.e * m1.d,
    e: m2.d * m1.b + m2.e * m1.e,
    xoff: m2.a * m1.xoff + m2.b * m1.yoff + m2.xoff,
    yoff: m2.d * m1.xoff + m2.e * m1.yoff + m2.yoff,
  };
}

export function inverter(m: Matriz): Matriz {
  const det = m.a * m.e - m.b * m.d;
  const a = m.e / det, b = -m.b / det, d = -m.d / det, e = m.a / det;
  return { a, b, d, e, xoff: -(a * m.xoff + b * m.yoff), yoff: -(d * m.xoff + e * m.yoff) };
}

export const aplicarMatrizPonto = (m: Matriz, p: [number, number]): [number, number] =>
  [m.a * p[0] + m.b * p[1] + m.xoff, m.d * p[0] + m.e * p[1] + m.yoff];

export function aplicarMatriz(c: unknown, m: Matriz): unknown {
  if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
    return aplicarMatrizPonto(m, c as [number, number]);
  }
  return Array.isArray(c) ? c.map((x) => aplicarMatriz(x, m)) : c;
}

/** Centro do retângulo da área (é em torno dele que a parte gira). */
export function centroArea(area: [number, number][]): [number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of area) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** Ponto dentro do anel (raio horizontal, par/ímpar). */
export function pontoNaArea(p: [number, number], area: [number, number][]): boolean {
  let dentro = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const [xi, yi] = area[i], [xj, yj] = area[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Centro do retângulo da geometria crua da linha. */
export function centroFeature(f: GeoJSON.Feature): [number, number] | null {
  if (!f.geometry || !("coordinates" in f.geometry)) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const olhar = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number, y = c[1] as number;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      return;
    }
    if (Array.isArray(c)) for (const v of c) olhar(v);
  };
  olhar((f.geometry as { coordinates: unknown }).coordinates);
  return x0 > x1 ? null : [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** Índice da primeira parte que contém o centro desta linha (coordenadas de uma LineString), ou -1. */
export function parteDaLinha(linha: [number, number][], areas: [number, number][][]): number {
  if (!areas.length || !linha.length) return -1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of linha) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const c: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  for (let i = 0; i < areas.length; i++) if (pontoNaArea(c, areas[i])) return i;
  return -1;
}

/**
 * Parte de cada linha do objeto: uma entrada por linha numa MultiLineString
 * (o formato do DXF convertido), uma só para os demais tipos.
 */
export function partesDasLinhas(f: GeoJSON.Feature, areas: [number, number][][]): Int32Array {
  if (f.geometry?.type === "MultiLineString") {
    const ls = f.geometry.coordinates as [number, number][][];
    const m = new Int32Array(ls.length);
    ls.forEach((l, i) => { m[i] = parteDaLinha(l, areas); });
    return m;
  }
  return Int32Array.of(parteDaFeature(f, areas));
}

/** Índice da primeira parte que contém o objeto inteiro (pelo centro), ou -1 (fica só com a calibração da planta). */
export function parteDaFeature(f: GeoJSON.Feature, areas: [number, number][][]): number {
  if (!areas.length) return -1;
  const c = centroFeature(f);
  if (!c) return -1;
  for (let i = 0; i < areas.length; i++) if (pontoNaArea(c, areas[i])) return i;
  return -1;
}

/** Duas áreas se sobrepõem? (algum vértice dentro da outra ou lados que se cruzam) */
export function areasSeSobrepoem(a: [number, number][], b: [number, number][]): boolean {
  if (a.some((p) => pontoNaArea(p, b)) || b.some((p) => pontoNaArea(p, a))) return true;
  const cruza = (p1: number[], p2: number[], p3: number[], p4: number[]) => {
    const o = (p: number[], q: number[], r: number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(p1, p2, p3) !== o(p1, p2, p4) && o(p3, p4, p1) !== o(p3, p4, p2);
  };
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (cruza(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/**
 * Parte da assinatura dos lotes (lotes_assinatura): muda quando o ajuste de
 * alguma parte muda. Vazia sem partes, para as assinaturas antigas continuarem
 * valendo. A mesma conta está em worker/jobs/ajustes.mjs.
 */
export function assinaturaAjustes(ajustes: AjusteLocal[]): string {
  if (!ajustes.length) return "";
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return ";aj:" + ajustes.map((a) => `${a.id}=${r(a.t.offsetLesteM)},${r(a.t.offsetNorteM)},${r(a.t.rotacaoGraus)}`).join("|");
}

/* ---------------------------------------------------------------------------
 * LINHAS APAGADAS (áudio do Carlos, 05/11/2026: "onde eu posso excluir alguma
 * coisa"). O operador apaga linhas soltas da planta na calibração, sem reenviar
 * o DXF. O arquivo original fica intacto; a lista de apagadas é guardada à parte
 * (cartography_layers.linhas_excluidas) e aplicada no arquivo público, nos lotes
 * clicáveis e na tela de calibração.
 *
 * Chave de cada linha, sempre pela posição no ARQUIVO ORIGINAL:
 *   "i:j" → a j-ésima linha da MultiLineString de índice i (o DXF chega como
 *           uma MultiLineString por camada do CAD);
 *   "i"   → o objeto i inteiro (LineString, polígono, ponto).
 * ------------------------------------------------------------------------- */

export const CHAVE_LINHA = /^\d{1,7}(:\d{1,7})?$/;

/** Tira da planta as linhas apagadas. Mantém o número de objetos (objeto sem linha vira vazio e some). */
export function removerLinhasExcluidas<T extends GeoJSON.FeatureCollection>(fc: T, excluidas: Iterable<string>): T {
  const set = excluidas instanceof Set ? (excluidas as Set<string>) : new Set(excluidas);
  if (!set.size) return fc;
  const features: GeoJSON.Feature[] = [];
  fc.features.forEach((f, i) => {
    if (set.has(String(i))) return;
    if (f.geometry?.type === "MultiLineString") {
      const linhas = f.geometry.coordinates.filter((_, j) => !set.has(`${i}:${j}`));
      if (!linhas.length) return;
      if (linhas.length !== f.geometry.coordinates.length) {
        features.push({ ...f, geometry: { ...f.geometry, coordinates: linhas } });
        return;
      }
    }
    features.push(f);
  });
  return { ...fc, features };
}

/** Pedaço da assinatura dos lotes: muda quando a lista de apagadas muda ("" sem nenhuma). */
export function assinaturaExclusoes(excluidas: string[] | null | undefined): string {
  if (!excluidas?.length) return "";
  const s = [...excluidas].sort().join(",");
  let h = 5381;
  for (let k = 0; k < s.length; k++) h = ((h * 33) ^ s.charCodeAt(k)) >>> 0;
  return `;ex:${excluidas.length}-${h.toString(36)}`;
}
