import "server-only";
import proj4 from "proj4";

/**
 * Leitor de planta CAD (DXF) → GeoJSON WGS84.
 *
 * POR QUE NÃO USA MAIS A BIBLIOTECA dxf-parser
 * -------------------------------------------
 * O DXF de Iturama tem 103 MB e 13,5 milhões de linhas. O caminho antigo era
 * `arquivo.text()` (103 MB viram ~206 MB de string UTF-16) e depois
 * `parseSync`, que monta a árvore inteira do arquivo em memória. No servidor
 * isso estoura a RAM do contêiner: o processo morre, o browser recebe resposta
 * sem corpo e a tela mostrava "Falha no envio." sem nenhum motivo.
 *
 * Medido nesse arquivo em 10/09/2026: das 107 mil entidades, 55.489 são MTEXT,
 * 10.278 TEXT e 7.665 DIMENSION — a maior parte do peso é anotação que não vai
 * para o mapa. A geometria útil são ~28 mil LINE/LWPOLYLINE mais arcos e
 * círculos.
 *
 * Este leitor consome o arquivo em fluxo, par de códigos por par de códigos, e
 * só retém coordenada. O texto passa e é descartado sem nunca virar objeto.
 *
 * DETECÇÃO DO SISTEMA DE COORDENADAS POR MEDIANA
 * ----------------------------------------------
 * O mesmo arquivo tem entidades com coordenada corrompida (X indo de
 * -7.242.087 a 8.289.478 — 15 milhões de metros de extensão, impossível numa
 * planta urbana). A média das primeiras 500 coordenadas, que era o critério
 * antigo, é arrastada por esses pontos e faz o arquivo inteiro ser recusado
 * como "não georreferenciado". A mediana ignora o extremo por construção.
 */

const ZONAS: Record<number, string> = {
  21: "+proj=utm +zone=21 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  22: "+proj=utm +zone=22 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  23: "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  24: "+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
};

/**
 * Texto curto da planta que identifica lote ou quadra, ou traz a área escrita.
 * `k`: "q" = "QUADRA 12" explícito, "n" = número ("07", "12A"), "l" = letra ou
 * código ("A", "F-1"), "a" = área escrita ("240,00 m²", valor em `v`).
 * `c` está em WGS84 do desenho ORIGINAL (antes da calibração), como as linhas.
 */
export type TextoPlanta = { t: string; k: "q" | "n" | "l" | "a"; h: number; c: [number, number]; v?: number };

export type ResultadoDxf = {
  geojson: GeoJSON.FeatureCollection;
  /** números de quadra/lote e áreas escritas no desenho (áudio do Carlos, 28/11/2026) */
  textos: TextoPlanta[];
  linhas: number;
  layersCad: number;
  bbox: [number, number, number, number];
  centro: [number, number];
  zona: number | "graus";
  diagnostico: {
    entidadesLidas: number;
    porTipo: Record<string, number>;
    geometriasPorTipo: Record<string, number>;
    ignoradasSemGeometria: number;
    blocosExpandidos: number;
    blocosNaoResolvidos: number;
    entidadesDaFolha: number;
    unidade: string;
    parcelaTerreno: number;
    pontosDescartados: number;
    layers: { nome: string; linhas: number }[];
    segundos: number;
  };
};

/** Erro de leitura já no formato que a tela mostra (mensagem + motivo + saída). */
export class ErroDxf extends Error {
  motivo: string;
  solucao: string;
  detalhes: Record<string, unknown>;
  constructor(mensagem: string, motivo: string, solucao: string, detalhes: Record<string, unknown> = {}) {
    super(mensagem);
    this.name = "ErroDxf";
    this.motivo = motivo;
    this.solucao = solucao;
    this.detalhes = detalhes;
  }
}

type Poli = { layer: string; pts: [number, number][] };
type TextoBruto = { s: string; x: number; y: number; h: number };

/** Textos que podem ser número/quadra/área: TEXT, MTEXT e o valor de atributo de bloco. */
const TIPOS_TEXTO = new Set(["TEXT", "MTEXT", "ATTRIB"]);

/** Tira a formatação do MTEXT: {\fArial|b1;07} → "07", \P → espaço, \U+00B2 → ². */
export const limparTextoCad = (s: string) =>
  String(s ?? "")
    .replace(/\\U\+00B2/gi, "²").replace(/%%178/g, "²")
    .replace(/\\[A-Za-z][^;\\{}]*;/g, "").replace(/\\P/g, " ").replace(/[{}]/g, "")
    .replace(/\s+/g, " ").trim();

// mesma classificação de scripts/numera-lotes.mjs (medida na planta de Iturama em 07/10/2026)
const RX_QUADRA = /^(?:QUADRA|QUAD\.?|QD\.?|Q\.?)\s*[-:]?\s*(?:N[º°O.]?\s*)?([0-9]{1,3}[A-Z]?|[A-Z]{1,2}(?:-?[0-9]{1,2})?)$/i;
const RX_NUM = /^[0-9]{1,4}[A-Z]?$/;
const RX_CURTO = /^(?:[0-9]{1,4}[A-Z]?|[A-Z]{1,2}(?:-?[0-9]{1,2})?|[0-9]{1,3}-[A-Z0-9]{1,2})$/;
// "240,00 m²", "240.00m2", "ÁREA = 1.240,50 M²", "A=240,00m²"
const RX_AREA = /^(?:[ÁA](?:REA)?\.?\s*[:=]?\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:[.,]\d{1,3})?)\s*M\s*(?:²|2)$/i;

function valorArea(bruto: string): number | null {
  let v = bruto;
  if (/\.\d{3}(?:,|$)/.test(v) || v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) && n >= 20 && n <= 50_000 ? n : null;
}

/**
 * Classifica os textos do desenho (em metros, sistema do CAD) e descarta o
 * resto: cota, nome de rua, legenda. Letra solta com outra letra igual ao lado
 * é palavra escrita letra a letra (rua na vertical) e também sai.
 */
function classificarTextos(brutos: TextoBruto[]): (Omit<TextoPlanta, "c"> & { x: number; y: number })[] {
  const out: (Omit<TextoPlanta, "c"> & { x: number; y: number })[] = [];
  for (const b of brutos) {
    if (!(b.h > 0) || !b.s) continue;
    const s = b.s.toUpperCase();
    const area = s.match(RX_AREA);
    if (area) {
      const v = valorArea(area[1]);
      if (v != null) out.push({ t: s, k: "a", v, h: b.h, x: b.x, y: b.y });
      continue;
    }
    const q = s.match(RX_QUADRA);
    if (q && (/^(QUADRA|QUAD|QD)/.test(s) || /^Q[-. ]\s*[0-9]/.test(s))) out.push({ t: q[1], k: "q", h: b.h, x: b.x, y: b.y });
    else if (RX_NUM.test(s)) out.push({ t: s, k: "n", h: b.h, x: b.x, y: b.y });
    else if (RX_CURTO.test(s)) out.push({ t: s, k: "l", h: b.h, x: b.x, y: b.y });
  }
  const letras = out.filter((t) => t.k === "l" && /^[A-Z]$/.test(t.t));
  const grade = new Map<string, typeof letras>();
  for (const t of letras) {
    const k = `${Math.floor(t.x / 10)}:${Math.floor(t.y / 10)}`;
    if (!grade.has(k)) grade.set(k, []);
    grade.get(k)!.push(t);
  }
  const soletradas = new Set<object>();
  for (const t of letras) {
    const cx = Math.floor(t.x / 10), cy = Math.floor(t.y / 10);
    fora: for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const o of grade.get(`${cx + i}:${cy + j}`) ?? []) {
        if (o === t || Math.abs(o.h - t.h) > 0.05 * t.h) continue;
        if (Math.hypot(o.x - t.x, o.y - t.y) < 1.6 * t.h) { soletradas.add(t); break fora; }
      }
    }
  }
  return out.filter((t) => !soletradas.has(t));
}

const arred = (n: number) => Math.round(n * 1e6) / 1e6;
const ehUtmPlausivel = (x: number, y: number) =>
  x > 100_000 && x < 900_000 && y > 6_000_000 && y < 10_000_000;
const ehGrausBrasil = (x: number, y: number) => x > -75 && x < -33 && y > -34 && y < 6;

/** Tipos que carregam geometria de linha. O resto é anotação e não vai ao mapa. */
const TIPOS_GEOMETRICOS = new Set([
  "LINE", "LWPOLYLINE", "POLYLINE", "VERTEX", "SEQEND", "ARC", "CIRCLE", "SPLINE", "SOLID", "INSERT",
]);

function mediana(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Lê o fluxo e devolve linha a linha, sem carregar o arquivo inteiro. */
async function* linhasDo(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder("utf-8", { fatal: false });
  const leitor = stream.getReader();
  let resto = "";
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    const texto = resto + dec.decode(value, { stream: true });
    const partes = texto.split("\n");
    resto = partes.pop() ?? "";
    for (const p of partes) yield p;
  }
  if (resto) yield resto;
}

type Entidade = {
  tipo: string;
  layer: string;
  xs: number[];
  ys: number[];
  x2: number | null;
  y2: number | null;
  raio: number;
  ang0: number;
  ang1: number;
  flags: number;
  escalaX: number;
  escalaY: number;
  rotacao: number;
  nomeBloco: string | null;
  /** código 67 = 1: desenhada na folha de impressão (carimbo, moldura), não no terreno */
  folha: boolean;
  /** código 230 < 0: sistema de coordenadas do objeto espelhado (X invertido) */
  espelhada: boolean;
  /** TEXT/MTEXT/ATTRIB: código 1 (final) e 3 (pedaços anteriores do MTEXT) */
  texto: string;
  texto3: string;
  /** TEXT/ATTRIB com justificação (72/73/74 ≠ 0): o ponto certo é o 11/21 */
  alinhado: boolean;
};

const novaEntidade = (tipo: string): Entidade => ({
  tipo, layer: "0", xs: [], ys: [], x2: null, y2: null,
  raio: 0, ang0: 0, ang1: 360, flags: 0, escalaX: 1, escalaY: 1, rotacao: 0, nomeBloco: null,
  folha: false, espelhada: false, texto: "", texto3: "", alinhado: false,
});

/** Tipos cujas coordenadas ficam no sistema do objeto (OCS) e espelham com extrusão Z negativa. */
const TIPOS_OCS = new Set(["LWPOLYLINE", "CIRCLE", "ARC", "INSERT", "SOLID"]);

/** Fatores de unidade a tentar quando a mediana não cai em UTM (desenho em mm, cm ou km). */
const UNIDADES: { fator: number; nome: string }[] = [
  { fator: 0.001, nome: "milímetros" },
  { fator: 0.01, nome: "centímetros" },
  { fator: 1000, nome: "quilômetros" },
];

type Bloco = { base: [number, number]; polis: Poli[]; insercoes: Entidade[]; textos: TextoBruto[] };
type Transf = (p: [number, number]) => [number, number];

/** Teto de pontos gerados pela expansão de blocos, para um bloco aninhado não estourar a memória. */
const TETO_PONTOS_BLOCOS = 4_000_000;
const PROFUNDIDADE_BLOCOS = 8;

function tesselarArco(cx: number, cy: number, r: number, a0: number, a1: number): [number, number][] {
  const varre = ((a1 - a0 + 360) % 360) || 360;
  const passo = Math.max(6, Math.min(72, Math.ceil(varre / 6)));
  const pts: [number, number][] = [];
  for (let i = 0; i <= passo; i++) {
    const a = ((a0 + (varre * i) / passo) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export async function converterDxf(
  stream: ReadableStream<Uint8Array>,
  zonaForcada?: number
): Promise<ResultadoDxf> {
  const inicio = Date.now();

  const saida: Poli[] = [];
  const blocos = new Map<string, Bloco>();
  const insercoes: Entidade[] = [];
  const textosBrutos: TextoBruto[] = [];
  let entidadesDaFolha = 0;

  const porTipo: Record<string, number> = {};
  const geometriasPorTipo: Record<string, number> = {};
  let entidadesLidas = 0, ignoradasSemGeometria = 0, blocosNaoResolvidos = 0;

  let secao: string | null = null;
  let esperandoNomeSecao = false;
  let blocoAtual: { nome: string; base: [number, number]; polis: Poli[]; insercoes: Entidade[]; textos: TextoBruto[] } | null = null;
  let esperandoNomeBloco = false;
  let ent: Entidade | null = null;
  let polylineAberta: Poli | null = null;
  let polylineFechada = false;
  let codigo: string | null = null;

  const destino = () => (blocoAtual ? blocoAtual.polis : saida);
  const empurrar = (layer: string, pts: [number, number][], tipo: string) => {
    if (pts.length < 2) return;
    destino().push({ layer, pts });
    geometriasPorTipo[tipo] = (geometriasPorTipo[tipo] ?? 0) + 1;
  };

  const fecharEntidade = () => {
    if (!ent) return;
    const e = ent;
    ent = null;
    if (TIPOS_TEXTO.has(e.tipo)) {
      if (e.folha && !blocoAtual) return;
      const s = limparTextoCad(e.texto3 + e.texto);
      const usaAlinhamento = e.tipo !== "MTEXT" && e.alinhado && e.x2 !== null && e.y2 !== null;
      const x = usaAlinhamento ? e.x2! : e.xs[0], y = usaAlinhamento ? e.y2! : e.ys[0];
      if (s && s.length <= 40 && Number.isFinite(x) && Number.isFinite(y)) {
        (blocoAtual ? blocoAtual.textos : textosBrutos).push({ s, x, y, h: e.raio });
      }
      return;
    }
    if (!TIPOS_GEOMETRICOS.has(e.tipo)) { ignoradasSemGeometria++; return; }
    // Carimbo, moldura e legenda desenhados na folha (paper space) têm
    // coordenada em milímetros da prancha: misturados ao terreno, puxam a
    // mediana para longe da UTM e o arquivo inteiro era recusado.
    if (e.folha && !blocoAtual) { entidadesDaFolha++; return; }
    if (e.espelhada && TIPOS_OCS.has(e.tipo)) {
      // OCS com Z para baixo: o X do objeto é o X do desenho com sinal trocado.
      e.xs = e.xs.map((x) => -x);
      if (e.tipo === "ARC") { const a0 = e.ang0; e.ang0 = 180 - e.ang1; e.ang1 = 180 - a0; }
      if (e.tipo === "INSERT") { e.rotacao = -e.rotacao; e.escalaX = -e.escalaX; }
    }

    const pares = (): [number, number][] => {
      const n = Math.min(e.xs.length, e.ys.length);
      const p: [number, number][] = [];
      for (let i = 0; i < n; i++) p.push([e.xs[i], e.ys[i]]);
      return p;
    };

    switch (e.tipo) {
      case "LINE": {
        if (e.xs.length && e.ys.length && e.x2 !== null && e.y2 !== null) {
          empurrar(e.layer, [[e.xs[0], e.ys[0]], [e.x2, e.y2]], "LINE");
        }
        break;
      }
      case "LWPOLYLINE": {
        const p = pares();
        if (e.flags & 1 && p.length > 2) p.push(p[0]);
        empurrar(e.layer, p, "LWPOLYLINE");
        break;
      }
      case "SPLINE": {
        // aproximação pelos pontos de controle: melhor que descartar a feição
        empurrar(e.layer, pares(), "SPLINE");
        break;
      }
      case "SOLID": {
        const p = pares();
        if (p.length >= 3) { p.push(p[0]); empurrar(e.layer, p, "SOLID"); }
        break;
      }
      case "CIRCLE": {
        if (e.raio > 0 && e.xs.length && e.ys.length) {
          empurrar(e.layer, tesselarArco(e.xs[0], e.ys[0], e.raio, 0, 360), "CIRCLE");
        }
        break;
      }
      case "ARC": {
        if (e.raio > 0 && e.xs.length && e.ys.length) {
          empurrar(e.layer, tesselarArco(e.xs[0], e.ys[0], e.raio, e.ang0, e.ang1), "ARC");
        }
        break;
      }
      case "POLYLINE": {
        polylineAberta = { layer: e.layer, pts: [] };
        polylineFechada = Boolean(e.flags & 1);
        break;
      }
      case "VERTEX": {
        if (polylineAberta && e.xs.length && e.ys.length) polylineAberta.pts.push([e.xs[0], e.ys[0]]);
        break;
      }
      case "SEQEND": {
        if (polylineAberta) {
          const p = polylineAberta.pts;
          if (polylineFechada && p.length > 2) p.push(p[0]);
          empurrar(polylineAberta.layer, p, "POLYLINE");
          polylineAberta = null;
        }
        break;
      }
      case "INSERT": {
        // INSERT dentro de um bloco é parte do bloco (coordenada local dele),
        // não do terreno: só é posicionado quando o bloco pai for inserido.
        if (e.nomeBloco && e.xs.length && e.ys.length) (blocoAtual ? blocoAtual.insercoes : insercoes).push(e);
        break;
      }
    }
  };

  for await (const bruta of linhasDo(stream)) {
    const l = bruta.trim();
    if (codigo === null) { codigo = l; continue; }
    const cod = codigo; const val = l; codigo = null;

    if (cod === "0") {
      fecharEntidade();
      if (val === "SECTION") { esperandoNomeSecao = true; continue; }
      if (val === "ENDSEC") { secao = null; blocoAtual = null; continue; }
      if (secao === "BLOCKS") {
        if (val === "BLOCK") { esperandoNomeBloco = true; blocoAtual = { nome: "", base: [0, 0], polis: [], insercoes: [], textos: [] }; continue; }
        if (val === "ENDBLK") {
          if (blocoAtual?.nome) blocos.set(blocoAtual.nome, { base: blocoAtual.base, polis: blocoAtual.polis, insercoes: blocoAtual.insercoes, textos: blocoAtual.textos });
          blocoAtual = null;
          continue;
        }
      }
      if (secao === "ENTITIES" || (secao === "BLOCKS" && blocoAtual)) {
        entidadesLidas++;
        porTipo[val] = (porTipo[val] ?? 0) + 1;
        ent = novaEntidade(val);
      }
      continue;
    }

    if (esperandoNomeSecao && cod === "2") { secao = val; esperandoNomeSecao = false; continue; }
    if (esperandoNomeBloco && cod === "2" && blocoAtual) { blocoAtual.nome = val; esperandoNomeBloco = false; continue; }
    if (!ent) {
      // ponto-base do BLOCK vem antes da primeira entidade dele
      if (blocoAtual && cod === "10") blocoAtual.base[0] = Number(val) || 0;
      if (blocoAtual && cod === "20") blocoAtual.base[1] = Number(val) || 0;
      continue;
    }

    switch (cod) {
      case "8": ent.layer = val || "0"; break;
      case "1": if (TIPOS_TEXTO.has(ent.tipo)) ent.texto = val; break;
      case "3": if (ent.tipo === "MTEXT") ent.texto3 += val; break;
      case "72": case "73": case "74": if (TIPOS_TEXTO.has(ent.tipo) && Number(val)) ent.alinhado = true; break;
      case "2": if (ent.tipo === "INSERT") ent.nomeBloco = val; break;
      case "10": { const v = Number(val); if (Number.isFinite(v)) ent.xs.push(v); break; }
      case "20": { const v = Number(val); if (Number.isFinite(v)) ent.ys.push(v); break; }
      case "11": { const v = Number(val); if (Number.isFinite(v)) ent.x2 = v; break; }
      case "21": { const v = Number(val); if (Number.isFinite(v)) ent.y2 = v; break; }
      case "40": { const v = Number(val); if (Number.isFinite(v)) ent.raio = v; break; }
      case "41": { const v = Number(val); if (Number.isFinite(v) && v !== 0) ent.escalaX = v; break; }
      case "42": { const v = Number(val); if (Number.isFinite(v) && v !== 0) ent.escalaY = v; break; }
      case "50": { const v = Number(val); if (Number.isFinite(v)) { if (ent.tipo === "INSERT") ent.rotacao = v; else ent.ang0 = v; } break; }
      case "51": { const v = Number(val); if (Number.isFinite(v)) ent.ang1 = v; break; }
      case "70": { const v = Number(val); if (Number.isFinite(v)) ent.flags = v; break; }
      case "67": ent.folha = val === "1"; break;
      case "230": { const v = Number(val); if (Number.isFinite(v)) ent.espelhada = v < 0; break; }
    }
  }
  fecharEntidade();

  // ---- blocos posicionados (INSERT): desenho do bloco levado ao lugar dele ----
  // Blocos podem conter outros INSERT (bloco dentro de bloco): a expansão é
  // recursiva, compondo as transformações, com teto de profundidade e pontos.
  let blocosExpandidos = 0, pontosBlocos = 0;
  const transfInsert = (ins: Entidade, b: Bloco): Transf => {
    const cos = Math.cos((ins.rotacao * Math.PI) / 180);
    const sen = Math.sin((ins.rotacao * Math.PI) / 180);
    const ix = ins.xs[0], iy = ins.ys[0];
    return ([x, y]) => {
      const dx = (x - b.base[0]) * ins.escalaX;
      const dy = (y - b.base[1]) * ins.escalaY;
      return [ix + dx * cos - dy * sen, iy + dx * sen + dy * cos];
    };
  };
  const expandir = (ins: Entidade, externa: Transf | null, profundidade: number, pilha: Set<string>) => {
    const nome = ins.nomeBloco as string;
    const b = blocos.get(nome);
    if (!b) { blocosNaoResolvidos++; return; }
    if (pilha.has(nome) || profundidade > PROFUNDIDADE_BLOCOS) return;
    const local = transfInsert(ins, b);
    const t: Transf = externa ? (p) => externa(local(p)) : local;
    for (const p of b.polis) {
      if (pontosBlocos > TETO_PONTOS_BLOCOS) return;
      pontosBlocos += p.pts.length;
      saida.push({ layer: p.layer, pts: p.pts.map(t) });
    }
    if (b.textos.length) {
      const [ox, oy] = t([0, 0]), [ux, uy] = t([1, 0]);
      const fator = Math.hypot(ux - ox, uy - oy);
      for (const tx of b.textos) { const [x, y] = t([tx.x, tx.y]); textosBrutos.push({ s: tx.s, x, y, h: tx.h * fator }); }
    }
    if (b.polis.length) blocosExpandidos++;
    if (b.insercoes.length) {
      pilha.add(nome);
      for (const filho of b.insercoes) expandir(filho, t, profundidade + 1, pilha);
      pilha.delete(nome);
    }
  };
  for (const ins of insercoes) expandir(ins, null, 0, new Set());

  if (!saida.length) {
    const dominantes = Object.entries(porTipo).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([t, n]) => `${t}: ${n.toLocaleString("pt-BR")}`).join(", ");
    throw new ErroDxf(
      "O DXF não tem nenhuma linha, polilinha, arco ou círculo aproveitável.",
      `Foram lidas ${entidadesLidas.toLocaleString("pt-BR")} entidades e todas são de anotação (${dominantes}).`,
      "No CAD, confirme que as quadras e lotes estão desenhados como linhas ou polilinhas — e não só como texto, cota ou hachura — e exporte de novo.",
      { porTipo, entidadesLidas }
    );
  }

  // ---- sistema de coordenadas pela MEDIANA (imune a coordenada corrompida) ----
  const amostraX: number[] = [], amostraY: number[] = [];
  const salto = Math.max(1, Math.floor(saida.length / 4000));
  for (let i = 0; i < saida.length; i += salto) {
    const p = saida[i].pts[0];
    if (p) { amostraX.push(p[0]); amostraY.push(p[1]); }
  }
  let medX = mediana(amostraX), medY = mediana(amostraY);
  const medianaOriginal = { x: medX, y: medY };

  // Unidade do desenho: planta em mm/cm/km tem a mesma forma, só a escala muda.
  let unidade = "metros";
  if (!ehGrausBrasil(medX, medY) && !ehUtmPlausivel(medX, medY)) {
    const u = UNIDADES.find(({ fator }) => ehUtmPlausivel(medX * fator, medY * fator));
    if (u) {
      unidade = u.nome;
      for (const poli of saida) poli.pts = poli.pts.map(([x, y]) => [x * u.fator, y * u.fator]);
      for (const tx of textosBrutos) { tx.x *= u.fator; tx.y *= u.fator; tx.h *= u.fator; }
      for (let i = 0; i < amostraX.length; i++) { amostraX[i] *= u.fator; amostraY[i] *= u.fator; }
      medX *= u.fator; medY *= u.fator;
    }
  }

  // Parte do desenho em terreno, parte em coordenada local (legenda, detalhe,
  // carimbo copiado no model space): se a parcela em UTM é expressiva, a
  // mediana passa a ser só dela e o resto cai no filtro de plausibilidade.
  let parcelaTerreno = 1;
  if (!ehGrausBrasil(medX, medY) && !ehUtmPlausivel(medX, medY)) {
    const ix: number[] = [], iy: number[] = [];
    for (let i = 0; i < amostraX.length; i++) {
      if (ehUtmPlausivel(amostraX[i], amostraY[i])) { ix.push(amostraX[i]); iy.push(amostraY[i]); }
    }
    parcelaTerreno = amostraX.length ? ix.length / amostraX.length : 0;
    if (ix.length >= 20 && parcelaTerreno >= 0.05) { medX = mediana(ix); medY = mediana(iy); }
  }

  let zona: number | "graus";
  let transformar: (p: [number, number]) => [number, number];
  let plausivel: (p: [number, number]) => boolean;

  if (ehGrausBrasil(medX, medY)) {
    zona = "graus";
    transformar = (p) => p;
    plausivel = (p) => ehGrausBrasil(p[0], p[1]) && Math.abs(p[0] - medX) < 3 && Math.abs(p[1] - medY) < 3;
  } else if (ehUtmPlausivel(medX, medY)) {
    zona = zonaForcada ?? 22;
    if (!zonaForcada) {
      for (const z of [22, 23, 21, 24]) {
        const [lng, lat] = proj4(ZONAS[z], "EPSG:4326", [medX, medY]) as [number, number];
        if (ehGrausBrasil(lng, lat)) { zona = z; break; }
      }
    }
    const def = ZONAS[zona as number];
    transformar = (p) => proj4(def, "EPSG:4326", p) as [number, number];
    // 150 km da mediana: uma planta urbana não passa disso; o que passa é lixo
    plausivel = (p) =>
      ehUtmPlausivel(p[0], p[1]) && Math.abs(p[0] - medX) < 150_000 && Math.abs(p[1] - medY) < 150_000;
  } else {
    throw new ErroDxf(
      "O desenho não está em coordenadas de terreno.",
      `A mediana das coordenadas é X ${medX.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} / Y ${medY.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} — fora de UTM (100.000 a 900.000 / 6 a 10 milhões) e fora de graus.`,
      "O arquivo provavelmente está em coordenadas locais do CAD. Georreferencie o desenho (ou use a planta original georreferenciada) e exporte o DXF de novo. Se no CAD o desenho aparece nas coordenadas certas, confira se ele está no Model (e não só no Layout) e se não foi exportado com ponto-base deslocado.",
      { medianaX: medianaOriginal.x, medianaY: medianaOriginal.y, geometrias: saida.length, entidadesDaFolha, porTipo }
    );
  }

  // ---- projeção, bbox e agrupamento por layer ----
  const porLayer = new Map<string, [number, number][][]>();
  const bbox: [number, number, number, number] = [180, 90, -180, -90];
  let linhas = 0, pontosDescartados = 0;

  for (const poli of saida) {
    const validos: [number, number][] = [];
    for (const p of poli.pts) {
      if (!plausivel(p)) { pontosDescartados++; continue; }
      const [lng, lat] = transformar(p);
      const c: [number, number] = [arred(lng), arred(lat)];
      if (c[0] < bbox[0]) bbox[0] = c[0];
      if (c[1] < bbox[1]) bbox[1] = c[1];
      if (c[0] > bbox[2]) bbox[2] = c[0];
      if (c[1] > bbox[3]) bbox[3] = c[1];
      validos.push(c);
    }
    if (validos.length < 2) continue;
    if (!porLayer.has(poli.layer)) porLayer.set(poli.layer, []);
    porLayer.get(poli.layer)!.push(validos);
    linhas++;
  }

  if (!linhas) {
    throw new ErroDxf(
      "Todas as coordenadas do DXF ficaram fora da região.",
      `${pontosDescartados.toLocaleString("pt-BR")} pontos foram descartados por estarem a mais de 150 km do centro do desenho.`,
      "Confira no CAD se sobraram entidades soltas muito distantes — é comum ficar lixo no canto do arquivo.",
      { pontosDescartados, medianaX: medX, medianaY: medY }
    );
  }

  const textos: TextoPlanta[] = [];
  for (const tx of classificarTextos(textosBrutos)) {
    if (!plausivel([tx.x, tx.y])) continue;
    const [lng, lat] = transformar([tx.x, tx.y]);
    const { x: _x, y: _y, ...resto } = tx;
    void _x; void _y;
    textos.push({ ...resto, h: Math.round(tx.h * 1000) / 1000, c: [arred(lng), arred(lat)] });
  }

  return {
    textos,
    geojson: {
      type: "FeatureCollection",
      features: [...porLayer.entries()].map(([layer, l]) => ({
        type: "Feature",
        geometry: { type: "MultiLineString", coordinates: l },
        properties: { layer },
      })),
    },
    linhas,
    layersCad: porLayer.size,
    bbox,
    centro: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    zona,
    diagnostico: {
      entidadesLidas,
      porTipo,
      geometriasPorTipo,
      ignoradasSemGeometria,
      blocosExpandidos,
      blocosNaoResolvidos,
      entidadesDaFolha,
      unidade,
      parcelaTerreno: Math.round(parcelaTerreno * 1000) / 1000,
      pontosDescartados,
      layers: [...porLayer.entries()]
        .map(([nome, l]) => ({ nome, linhas: l.length }))
        .sort((a, b) => b.linhas - a.linhas),
      segundos: Math.round((Date.now() - inicio) / 100) / 10,
    },
  };
}
