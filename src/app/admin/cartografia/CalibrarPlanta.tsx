"use client";

/**
 * Calibração da planta sobre o satélite.
 *
 * A versão anterior só tinha setas de teclado e deslocamento em metros. Três
 * coisas apareceram nas plantas reais e entraram aqui:
 *
 *  - ARRASTAR COM O MOUSE. Alinhar 60 m com seta de 10 em 10 m é seis cliques;
 *    arrastar é um gesto. As setas continuam, para o ajuste fino.
 *  - DOIS PONTOS DE CONTROLE. Planta amarrada por um ponto só fecha no centro e
 *    abre nas pontas. O operador marca o mesmo cruzamento na planta e no
 *    satélite duas vezes, e daí sai deslocamento, giro e escala de uma vez.
 *  - CAMADAS DO CAD. O DXF de Iturama trouxe projeto paisagístico junto
 *    (VEGET_I com 25 mil linhas, Paisagismo com 15 mil). Desenhar árvore sobre
 *    o satélite polui o mapa — aqui elas se apagam sem reenviar o arquivo.
 *  - AJUSTE POR PARTE (16/10/2026, pedido do Carlos). Quando só uma quadra ou
 *    um bairro está fora, mover a planta inteira desalinha o que já batia. O
 *    operador desenha uma área em volta do trecho e move/gira só aquilo; o
 *    resto fica onde está. Ver "AJUSTE POR PARTE" em src/lib/geo/deslocar.ts.
 *  - APAGAR LINHAS E ESPESSURA (05/11/2026, áudio do Carlos: "onde eu posso
 *    excluir alguma coisa (...) aumentar as linhas"). No modo "Apagar linhas" o
 *    clique tira a linha mais próxima da planta; o original não muda e dá para
 *    desfazer ou restaurar tudo. A espessura multiplica a largura com que o
 *    mapa público desenha a planta.
 *  - EDIÇÃO EM LOTE (10/11/2026, vídeo e áudios do Carlos). Ele apagou 65
 *    linhas uma a uma e pediu "igual recorte de print": o modo "Selecionar
 *    área" arrasta um retângulo e pega todas as linhas dentro, para apagar de
 *    uma vez ou virar uma parte que anda junta. A parte também passou a
 *    esticar (escala), a linha pode ser dividida, ter um trecho apagado ou ser
 *    arrastada inteira, a tela ocupa a janela toda e o salvamento é automático
 *    ("alterou, salvou", para um deslize não perder o trabalho).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BoxSelect, ChevronDown, ChevronUp, Crosshair, Eraser, Hand, MousePointer2, Move, PenLine, Pencil, RotateCcw, Save, Scissors, Trash2, Undo2, X } from "lucide-react";
import type { Map as MLMap, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { SATELITE, SATELITE_ALTO, ZOOM_SATELITE_ALTO } from "@/lib/map/config";
import {
  centroDe, ajustarPorPontos, DESLOCAMENTO_DATUM, TRANSFORM_ZERO,
  afim, compor, inverter, aplicarMatriz, aplicarMatrizPonto, centroArea, partesDasLinhas,
  areasSeSobrepoem, aplicarEdicoesGeoJSON, pontoNaArea, centroFeature,
  type Transform, type ParDeControle, type AjusteLocal, type EdicaoGeometria,
} from "@/lib/geo/deslocar";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import { AvisoErro } from "@/components/ui/Aviso";

type Camada = {
  id: string; nome: string; municipio: string | null;
  geojson?: string; tipo: string;
  opacidade: number;
  datum?: string;
  layers_ocultos?: string[];
  layers_cad?: { nome: string; linhas: number }[];
  transform?: Transform;
  ajustes?: AjusteLocal[];
  linhas_excluidas?: string[];
  espessura?: number;
  edicoes?: EdicaoGeometria[];
  offset: { leste_m: number; norte_m: number };
};

type Modo = "navegar" | "mover" | "pontos" | "parte" | "apagar" | "objeto" | "vertices" | "selecao";
type LinhaSelecionada = { feature: number; linha: number };
/** O que o clique faz na linha escolhida em "Ajustar linha". */
type FerramentaLinha = "vertices" | "dividir" | "trecho";

/** O que o desfazer guarda: a planta inteira, as partes, as linhas apagadas e as corrigidas. */
type Estado = { t: Transform; ajustes: AjusteLocal[]; excluidas: Set<string>; edicoes: EdicaoGeometria[] };

/** Espera depois da última alteração antes de salvar sozinho. */
const ESPERA_AUTOSALVAR_MS = 12_000;
const CHAVE_AUTOSALVAR = "arini:calibrar:autosalvar";

/** Larguras base das linhas na calibração; a espessura escolhida multiplica. */
const LARGURA = { linha: [13, 1, 16, 1.6, 19, 2.6], contorno: [13, 2.2, 16, 3.4, 19, 5], parte: [13, 1.2, 16, 2, 19, 3] };
const largura = (paradas: number[], k: number) =>
  ["interpolate", ["linear"], ["zoom"], ...paradas.map((v, i) => (i % 2 ? Math.round(v * k * 100) / 100 : v))] as never;

const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Monta o que o mapa desenha: a planta (cada linha com a matriz da sua parte, ou
 * a da planta inteira), separando a parte ATIVA numa fonte própria — é ela que
 * o arraste empurra sozinha — e o contorno de cada parte na posição atual.
 */
function montar(
  bruto: GeoJSON.FeatureCollection, centro: [number, number], t: Transform,
  esconder: Set<string>, ajustes: AjusteLocal[], ativa: string | null, membros: Int32Array[],
  apagadas: Set<string> = new Set(),
) {
  const g = afim(centro, t);
  const ms = ajustes.map((a) => compor(g, afim(centroArea(a.area), a.t)));
  const iAtiva = ativa ? ajustes.findIndex((a) => a.id === ativa) : -1;
  const resto: GeoJSON.Feature[] = [], parte: GeoJSON.Feature[] = [];
  bruto.features.forEach((f, i) => {
    if (!f.geometry || !("coordinates" in f.geometry)) return;
    if (esconder.size && esconder.has(String(f.properties?.layer ?? ""))) return;
    if (apagadas.size && apagadas.has(String(i))) return;
    const quem = membros[i];
    // __i = posição no arquivo original: é por ela que o clique acha a linha a apagar
    const props = { ...f.properties, __i: i };
    // MultiLineString (uma por camada do CAD): as linhas da parte ativa saem
    // num objeto à parte, com as mesmas propriedades
    if (f.geometry.type === "MultiLineString") {
      const ficam: GeoJSON.Position[][] = [], vao: GeoJSON.Position[][] = [];
      f.geometry.coordinates.forEach((l, j) => {
        if (apagadas.size && apagadas.has(`${i}:${j}`)) return;
        const k = quem?.[j] ?? -1;
        const nl = aplicarMatriz(l, k >= 0 ? ms[k] : g) as GeoJSON.Position[];
        (k >= 0 && k === iAtiva ? vao : ficam).push(nl);
      });
      if (ficam.length) resto.push({ ...f, properties: props, geometry: { type: "MultiLineString", coordinates: ficam } });
      if (vao.length) parte.push({ ...f, properties: props, geometry: { type: "MultiLineString", coordinates: vao } });
      return;
    }
    const k = quem?.[0] ?? -1;
    const nf = {
      ...f,
      properties: props,
      geometry: { ...f.geometry, coordinates: aplicarMatriz((f.geometry as { coordinates: unknown }).coordinates, k >= 0 ? ms[k] : g) },
    } as GeoJSON.Feature;
    (k >= 0 && k === iAtiva ? parte : resto).push(nf);
  });
  const contornos: GeoJSON.Feature[] = ajustes.map((a, i) => {
    const anel = a.area.map((p) => aplicarMatrizPonto(ms[i], p));
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...anel, anel[0]]] },
      properties: { id: a.id, ativa: a.id === ativa, nome: a.nome },
    };
  });
  return {
    resto: { type: "FeatureCollection", features: resto } as GeoJSON.FeatureCollection,
    parte: { type: "FeatureCollection", features: parte } as GeoJSON.FeatureCollection,
    contornos: { type: "FeatureCollection", features: contornos } as GeoJSON.FeatureCollection,
  };
}

/** Parte de cada linha do desenho cru, por objeto (-1 = só a calibração da planta). */
function calcularMembros(bruto: GeoJSON.FeatureCollection, ajustes: AjusteLocal[]): Int32Array[] {
  const areas = ajustes.map((a) => a.area);
  return bruto.features.map((f) => partesDasLinhas(f, areas));
}

/** Deslocamento visto na tela (metros) → deslocamento da parte, que é aplicado antes do giro e da escala da planta. */
function telaParaParte(dLeste: number, dNorte: number, t: Transform): [number, number] {
  const rad = (-t.rotacaoGraus * Math.PI) / 180, cos = Math.cos(rad), sen = Math.sin(rad), s = t.escala || 1;
  return [(dLeste * cos - dNorte * sen) / s, (dLeste * sen + dNorte * cos) / s];
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Duas transformações são a mesma coisa dentro da precisão que o banco guarda. */
const ehIgualAoSalvo = (a: Transform, b: Transform) =>
  Math.abs(a.offsetLesteM - b.offsetLesteM) < 0.01 &&
  Math.abs(a.offsetNorteM - b.offsetNorteM) < 0.01 &&
  Math.abs(a.rotacaoGraus - b.rotacaoGraus) < 1e-4 &&
  Math.abs(a.escala - b.escala) < 1e-6;

function coordenadasLinha(fc: GeoJSON.FeatureCollection, s: LinhaSelecionada): [number, number][] | null {
  const g = fc.features[s.feature]?.geometry;
  if (g?.type === "MultiLineString") return (g.coordinates[s.linha] as [number, number][] | undefined) ?? null;
  if (g?.type === "LineString" && s.linha === 0) return g.coordinates as [number, number][];
  return null;
}

const distanciaSegmento2 = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const den = dx * dx + dy * dy;
  const u = den ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den)) : 0;
  const x = a[0] + u * dx, y = a[1] + u * dy;
  return (p[0] - x) ** 2 + (p[1] - y) ** 2;
};

/** Procura a polilinha mais perto do clique no desenho cru. Só roda ao clicar. */
function linhaMaisProxima(
  fc: GeoJSON.FeatureCollection, p: [number, number], limite: number, apagadas: Set<string> = new Set(),
): LinhaSelecionada | null {
  let melhor = limite * limite, achou: LinhaSelecionada | null = null;
  fc.features.forEach((f, feature) => {
    const linhas = f.geometry?.type === "MultiLineString" ? f.geometry.coordinates
      : f.geometry?.type === "LineString" ? [f.geometry.coordinates] : [];
    if (apagadas.has(String(feature))) return;
    const multi = f.geometry?.type === "MultiLineString";
    linhas.forEach((linha, i) => {
      // linha apagada não aparece no mapa, então não pode ser escolhida
      if (multi && apagadas.has(`${feature}:${i}`)) return;
      for (let j = 1; j < linha.length; j++) {
        const d = distanciaSegmento2(p, linha[j - 1] as [number, number], linha[j] as [number, number]);
        if (d < melhor) { melhor = d; achou = { feature, linha: i }; }
      }
    });
  });
  return achou;
}

/** Contorno convexo (cadeia monótona) — junta várias caixas de seleção numa área só. */
function contornoConvexo(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cruz = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo: [number, number][] = [], cima: [number, number][] = [];
  for (const q of p) { while (baixo.length >= 2 && cruz(baixo[baixo.length - 2], baixo[baixo.length - 1], q) <= 0) baixo.pop(); baixo.push(q); }
  for (const q of [...p].reverse()) { while (cima.length >= 2 && cruz(cima[cima.length - 2], cima[cima.length - 1], q) <= 0) cima.pop(); cima.push(q); }
  return [...baixo.slice(0, -1), ...cima.slice(0, -1)];
}

/** Centro do retângulo envolvente de uma linha (o mesmo critério de parteDaLinha). */
function centroLinha(l: GeoJSON.Position[]): [number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of l) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x0 > x1 ? null : [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** Ponto mais próximo de `p` numa polilinha: índice do segmento (vértice final) e o ponto projetado. */
function segmentoMaisProximo(linha: [number, number][], p: [number, number]): { j: number; ponto: [number, number]; d2: number } | null {
  let melhor: { j: number; ponto: [number, number]; d2: number } | null = null;
  for (let j = 1; j < linha.length; j++) {
    const a = linha[j - 1], b = linha[j];
    const dx = b[0] - a[0], dy = b[1] - a[1], den = dx * dx + dy * dy;
    const u = den ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den)) : 0;
    const q: [number, number] = [a[0] + u * dx, a[1] + u * dy];
    const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (!melhor || d2 < melhor.d2) melhor = { j, ponto: q, d2 };
  }
  return melhor;
}

export default function CalibrarPlanta({ camada, onFechar }: { camada: Camada; onFechar: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const brutoRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const centroRef = useRef<[number, number]>([0, 0]);
  // solta os ouvintes de arraste registrados na janela quando o modal fecha
  const limparArrasteRef = useRef<(() => void) | null>(null);

  const inicial: Transform = camada.transform ?? {
    offsetLesteM: camada.offset?.leste_m ?? 0,
    offsetNorteM: camada.offset?.norte_m ?? 0,
    rotacaoGraus: 0,
    escala: 1,
  };

  const [t, setT] = useState<Transform>(inicial);
  const [ocultos, setOcultos] = useState<Set<string>>(new Set(camada.layers_ocultos ?? []));
  const [opacidade, setOpacidade] = useState(camada.opacidade ?? 0.85);
  const [modo, setModo] = useState<Modo>("mover");
  const [passo, setPasso] = useState(10);
  const [pares, setPares] = useState<ParDeControle[]>([]);
  const [pendente, setPendente] = useState<[number, number] | null>(null);
  const [residuo, setResiduo] = useState<number | null>(null);
  const [aba, setAba] = useState<"posicao" | "camadas">("posicao");
  const [historico, setHistorico] = useState<Estado[]>([]);
  const [ajustes, setAjustes] = useState<AjusteLocal[]>(camada.ajustes ?? []);
  // linhas apagadas ("i" ou "i:j", posição no arquivo original) e espessura das linhas
  const [excluidas, setExcluidas] = useState<Set<string>>(new Set(camada.linhas_excluidas ?? []));
  const [espessura, setEspessura] = useState(camada.espessura ?? 1);
  const [edicoes, setEdicoes] = useState<EdicaoGeometria[]>(camada.edicoes ?? []);
  const [linhaSelecionada, setLinhaSelecionada] = useState<LinhaSelecionada | null>(null);
  const [ferramentaLinha, setFerramentaLinha] = useState<FerramentaLinha>("vertices");
  // seleção em caixa: chaves das linhas ("i" ou "i:j") e o contorno das caixas, no desenho cru
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [caixasSelecao, setCaixasSelecao] = useState<[number, number][][]>([]);
  // painel de baixo recolhido = mais mapa (pedido do Carlos: "tela de edição maior")
  // começa recolhido: o mapa é a ferramenta; o painel abre por "Posição" ou "Camadas do CAD"
  const [painelAberto, setPainelAberto] = useState(false);
  // a calibração só abre por clique, no navegador: ler a preferência já na criação do estado é seguro
  const [autoSalvar, setAutoSalvar] = useState(() => {
    try { return localStorage.getItem(CHAVE_AUTOSALVAR) !== "0"; } catch { return true; }
  });
  function mudarAutoSalvar(v: boolean) {
    setAutoSalvar(v);
    try { localStorage.setItem(CHAVE_AUTOSALVAR, v ? "1" : "0"); } catch { /* preferência só desta sessão */ }
  }
  // null = ajustando a planta inteira; id = só aquela parte
  const [ativa, setAtiva] = useState<string | null>(null);
  // vértices da área sendo desenhada (posição na tela, em graus)
  const [desenho, setDesenho] = useState<[number, number][]>([]);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [carregando, setCarregando] = useState(true);

  // refs espelham o estado para os handlers do mapa, que são registrados uma vez
  const tRef = useRef(t); tRef.current = t;
  const ocultosRef = useRef(ocultos); ocultosRef.current = ocultos;
  const modoRef = useRef(modo); modoRef.current = modo;
  const pendenteRef = useRef(pendente); pendenteRef.current = pendente;
  const ajustesRef = useRef(ajustes); ajustesRef.current = ajustes;
  const ativaRef = useRef(ativa); ativaRef.current = ativa;
  const desenhoRef = useRef(desenho); desenhoRef.current = desenho;
  const excluidasRef = useRef(excluidas); excluidasRef.current = excluidas;
  // o clique de apagar é registrado uma vez; a busca da linha usa o estado do momento
  const apagarNoPontoRef = useRef<(e: MapMouseEvent) => void>(() => undefined);
  const edicoesRef = useRef(edicoes); edicoesRef.current = edicoes;
  const linhaSelecionadaRef = useRef(linhaSelecionada); linhaSelecionadaRef.current = linhaSelecionada;
  const ferramentaLinhaRef = useRef(ferramentaLinha); ferramentaLinhaRef.current = ferramentaLinha;
  const selecaoRef = useRef(selecao); selecaoRef.current = selecao;
  const caixasSelecaoRef = useRef(caixasSelecao); caixasSelecaoRef.current = caixasSelecao;
  // o arquivo como veio do armazenamento, nunca alterado: base para refazer uma linha ao desfazer
  const originalRef = useRef<GeoJSON.FeatureCollection | null>(null);
  // retângulo desenhado sobre o mapa durante a seleção em caixa
  const caixaRef = useRef<HTMLDivElement>(null);
  const selecionarNaCaixaRef = useRef<(cantos: [number, number][], somar: boolean) => void>(() => undefined);
  const editarLinhaNoPontoRef = useRef<(e: MapMouseEvent) => boolean>(() => false);
  const gravarEdicaoRef = useRef<(e: EdicaoGeometria) => void>(() => undefined);
  // parte de cada linha: só muda quando uma parte nasce ou some, não a cada movimento
  const membrosRef = useRef<{ chave: string; m: Int32Array[] }>({ chave: "", m: [] });
  const parteAtual = ajustes.find((a) => a.id === ativa) ?? null;
  // o clique do mapa é registrado uma vez; fechar a área usa o estado do momento
  const fecharAreaRef = useRef<() => void>(() => undefined);
  const criarParteDaLinhaRef = useRef<(s: LinhaSelecionada) => void>(() => undefined);

  const layersCad = useMemo(() => camada.layers_cad ?? [], [camada.layers_cad]);
  const totalLinhas = useMemo(() => layersCad.reduce((s, l) => s + l.linhas, 0), [layersCad]);
  const linhasVisiveis = useMemo(
    () => layersCad.filter((l) => !ocultos.has(l.nome)).reduce((s, l) => s + l.linhas, 0),
    [layersCad, ocultos]
  );

  /**
   * Redesenha a planta com a transformação nova — no máximo uma vez por quadro.
   *
   * Refazer o desenho custa caro: `transformarGeoJSON` percorre as 207 mil
   * linhas de Iturama e o MapLibre reprocessa a fonte inteira. Chamar isso a
   * cada evento travava a tela — segurar a seta do teclado enfileirava dezenas
   * de recálculos completos. Aqui os pedidos se acumulam num só, no próximo
   * quadro, e o último vence. Durante o ARRASTE nem isso acontece: ali a planta
   * é deslocada por `line-translate`, que é uniforme de GPU e não toca no dado.
   */
  const quadroRef = useRef<number | null>(null);
  const alvoRef = useRef<{ t: Transform; esconder: Set<string> } | null>(null);

  const redesenhar = useCallback((novo: Transform, esconder: Set<string>) => {
    alvoRef.current = { t: novo, esconder };
    if (quadroRef.current !== null) return;
    quadroRef.current = requestAnimationFrame(() => {
      quadroRef.current = null;
      const alvo = alvoRef.current;
      const map = mapRef.current, bruto = brutoRef.current;
      if (!alvo || !map || !bruto || !map.getSource("planta")) return;
      const lista = ajustesRef.current;
      const chave = lista.map((a) => a.id).join("|");
      if (membrosRef.current.chave !== chave || membrosRef.current.m.length !== bruto.features.length) {
        membrosRef.current = { chave, m: calcularMembros(bruto, lista) };
      }
      const d = montar(bruto, centroRef.current, alvo.t, alvo.esconder, lista, ativaRef.current, membrosRef.current.m, excluidasRef.current);
      (map.getSource("planta") as GeoJSONSource).setData(d.resto);
      (map.getSource("planta-parte") as GeoJSONSource | undefined)?.setData(d.parte);
      (map.getSource("partes") as GeoJSONSource | undefined)?.setData(d.contornos);
    });
  }, []);

  // zera a marca ao cancelar: no modo estrito do React a tela monta duas vezes,
  // e um quadro cancelado com a marca de pé travava todos os redesenhos seguintes
  useEffect(() => () => {
    if (quadroRef.current !== null) cancelAnimationFrame(quadroRef.current);
    quadroRef.current = null;
  }, []);

  /** Grava o estado atual no desfazer. */
  const registrar = useCallback(() => {
    // fotografa AGORA: dentro do updater a leitura dos refs acontece quando o
    // React processa a fila, e aí `definir` já trocou tRef pelo estado novo —
    // o desfazer guardava a posição nova e "voltava" para ela.
    const antes: Estado = { t: tRef.current, ajustes: ajustesRef.current, excluidas: excluidasRef.current, edicoes: edicoesRef.current };
    setHistorico((h) => [...h.slice(-50), antes]);
  }, []);

  /** Muda a planta inteira e/ou as partes, e redesenha uma vez. */
  const definir = useCallback((novoT: Transform, novosAjustes: AjusteLocal[], guardarHistorico = true) => {
    if (guardarHistorico) registrar();
    tRef.current = novoT; ajustesRef.current = novosAjustes;
    setT(novoT); setAjustes(novosAjustes);
    redesenhar(novoT, ocultosRef.current);
  }, [redesenhar, registrar]);

  const aplicar = useCallback((novo: Transform, guardarHistorico = true) => {
    definir(novo, ajustesRef.current, guardarHistorico);
  }, [definir]);

  /** Muda o ajuste da parte ativa. */
  const aplicarParte = useCallback((mudar: (t: Transform) => Transform, guardarHistorico = true) => {
    const id = ativaRef.current;
    if (!id) return;
    definir(tRef.current, ajustesRef.current.map((a) => (a.id === id ? { ...a, t: mudar(a.t) } : a)), guardarHistorico);
  }, [definir]);

  const desenharPares = useCallback((lista: ParDeControle[], meio: [number, number] | null) => {
    const map = mapRef.current;
    if (!map || !map.getSource("controle")) return;
    const feats: GeoJSON.Feature[] = [];
    lista.forEach((p, i) => {
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: p.planta }, properties: { tipo: "planta", i: i + 1 } });
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: p.satelite }, properties: { tipo: "satelite", i: i + 1 } });
      feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: [p.planta, p.satelite] }, properties: { tipo: "liga" } });
    });
    if (meio) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: meio }, properties: { tipo: "planta", i: lista.length + 1 } });
    (map.getSource("controle") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
  }, []);

  const desenharLinhaSelecionada = useCallback((s: LinhaSelecionada | null, coordsOverride?: [number, number][]) => {
    const map = mapRef.current, bruto = brutoRef.current;
    const fonte = map?.getSource("edicao") as GeoJSONSource | undefined;
    if (!fonte || !bruto || !s) { fonte?.setData(VAZIO); return; }
    const coords = coordsOverride ?? coordenadasLinha(bruto, s);
    if (!coords) { fonte.setData(VAZIO); return; }
    const g = afim(centroRef.current, tRef.current);
    const k = membrosRef.current.m[s.feature]?.[s.linha] ?? -1;
    const a = k >= 0 ? ajustesRef.current[k] : null;
    const m = a ? compor(g, afim(centroArea(a.area), a.t)) : g;
    const tela = coords.map((p) => aplicarMatrizPonto(m, p));
    fonte.setData({ type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "LineString", coordinates: tela }, properties: { tipo: "linha" } },
      ...tela.map((p, i) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: p }, properties: { tipo: "vertice", i } })),
    ] });
  }, []);

  // ---------- monta o mapa uma vez ----------
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !camada.geojson) return;
    let cancelado = false;
    let mapa: MLMap | undefined;

    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado || !containerRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        // calibrar é olhar telhado e meio-fio: a camada de perto entra a partir do z18
        style: SATELITE_ALTO
          ? {
              version: 8, sources: { sat: SATELITE, "sat-alto": SATELITE_ALTO },
              layers: [{ id: "sat", type: "raster", source: "sat" }, { id: "sat-alto", type: "raster", source: "sat-alto", minzoom: ZOOM_SATELITE_ALTO }],
            }
          : { version: 8, sources: { sat: SATELITE }, layers: [{ id: "sat", type: "raster", source: "sat" }] },
        center: [-50.196, -19.728],
        zoom: 15,
        attributionControl: { compact: true },
      });
      mapa = map;
      mapRef.current = map;
      // só em desenvolvimento: o teste de ponta a ponta lê as fontes do mapa
      if (process.env.NODE_ENV !== "production") (window as unknown as { __mapaCalibracao?: MLMap }).__mapaCalibracao = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      // régua: calibrar é julgar distância, e "isso aí é uns 20 m?" precisa de
      // referência na tela, não de conta de cabeça
      map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");

      const original = (await fetch(camada.geojson!).then((r) => r.json()).catch(() => null)) as GeoJSON.FeatureCollection | null;
      // lista própria de objetos: corrigir uma linha troca o objeto inteiro em
      // `bruto`, sem nunca mexer no original (é dele que o desfazer refaz a linha)
      const editado = original ? aplicarEdicoesGeoJSON(original, camada.edicoes ?? []) : null;
      const bruto = editado ? { ...editado, features: [...editado.features] } : null;
      originalRef.current = original;
      if (cancelado) return;
      if (!bruto) {
        setErro({
          mensagem: "Não consegui carregar o desenho da planta.",
          motivo: "O arquivo GeoJSON no armazenamento não respondeu.",
          solucao: "Recarregue a página; se repetir, republique a planta.",
          codigo: "geojson_indisponivel", status: 0,
        });
        setCarregando(false);
        return;
      }
      brutoRef.current = bruto;
      centroRef.current = centroDe(bruto);

      const aoCarregar = () => {
        // a primeira montagem já separa as partes; daqui em diante é o redesenhar()
        membrosRef.current = { chave: ajustesRef.current.map((a) => a.id).join("|"), m: calcularMembros(bruto, ajustesRef.current) };
        const d0 = montar(bruto, centroRef.current, inicial, new Set(camada.layers_ocultos ?? []), ajustesRef.current, null, membrosRef.current.m, excluidasRef.current);
        const k0 = camada.espessura ?? 1;
        map.addSource("planta", { type: "geojson", data: d0.resto });
        // contorno escuro embaixo, linha clara em cima: sobre telhado de
        // cerâmica o amarelo sozinho some, e é justamente ali que a divisa
        // precisa ser lida para calibrar
        map.addLayer({
          id: "planta-contorno", type: "line", source: "planta",
          paint: {
            "line-color": "#120C02",
            "line-width": largura(LARGURA.contorno, k0) as never,
            "line-opacity": 0.5,
          },
        });
        map.addLayer({
          id: "planta", type: "line", source: "planta",
          paint: {
            "line-color": "#FFE299",
            "line-width": largura(LARGURA.linha, k0) as never,
            "line-opacity": camada.opacidade ?? 0.85,
          },
        });

        // contorno de cada parte ajustada; a ativa em destaque
        map.addSource("partes", { type: "geojson", data: d0.contornos });
        map.addLayer({
          id: "partes-fundo", type: "fill", source: "partes",
          paint: { "fill-color": "#D9BD6F", "fill-opacity": ["case", ["get", "ativa"], 0.12, 0.04] as never },
        });
        map.addLayer({
          id: "partes-linha", type: "line", source: "partes",
          paint: {
            "line-color": "#D9BD6F",
            "line-width": ["case", ["get", "ativa"], 2.5, 1.2] as never,
            "line-dasharray": [3, 2],
          },
        });

        // a parte ativa numa fonte só dela: o arraste empurra só estas linhas
        map.addSource("planta-parte", { type: "geojson", data: VAZIO });
        map.addLayer({
          id: "planta-parte-contorno", type: "line", source: "planta-parte",
          paint: {
            "line-color": "#120C02",
            "line-width": largura(LARGURA.contorno, k0) as never,
            "line-opacity": 0.5,
          },
        });
        map.addLayer({
          id: "planta-parte", type: "line", source: "planta-parte",
          paint: {
            "line-color": "#FFE299",
            "line-width": largura(LARGURA.parte, k0) as never,
            "line-opacity": 0.95,
          },
        });

        // área sendo desenhada
        map.addSource("desenho", { type: "geojson", data: VAZIO });
        map.addLayer({
          id: "desenho-linha", type: "line", source: "desenho",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#D9BD6F", "line-width": 2, "line-dasharray": [2, 1] },
        });
        map.addLayer({
          id: "desenho-pontos", type: "circle", source: "desenho",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 5, "circle-color": "#D9BD6F", "circle-stroke-width": 2, "circle-stroke-color": "#0B140F" },
        });

        // Uma única linha em edição fica isolada: arrastar um vértice atualiza
        // só esta fonte pequena; a planta inteira é refeita apenas ao soltar.
        map.addSource("edicao", { type: "geojson", data: VAZIO });
        map.addLayer({
          id: "edicao-linha", type: "line", source: "edicao",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#FF8A3D", "line-width": 4 },
        });
        map.addLayer({
          id: "edicao-vertices", type: "circle", source: "edicao",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 6, "circle-color": "#FFF4D6", "circle-stroke-width": 2.5, "circle-stroke-color": "#FF6B1A" },
        });

        // linhas pegas pela seleção em caixa
        map.addSource("selecao", { type: "geojson", data: VAZIO });
        map.addLayer({
          id: "selecao-linha", type: "line", source: "selecao",
          paint: { "line-color": "#FF8A3D", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.6, 17, 3.2] as never, "line-opacity": 0.95 },
        });

        map.addSource("controle", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "controle-liga", type: "line", source: "controle",
          filter: ["==", ["get", "tipo"], "liga"],
          paint: { "line-color": "#D9BD6F", "line-width": 1.5, "line-dasharray": [2, 2] },
        });
        map.addLayer({
          id: "controle-pontos", type: "circle", source: "controle",
          filter: ["!=", ["get", "tipo"], "liga"],
          paint: {
            "circle-radius": 6,
            "circle-color": ["case", ["==", ["get", "tipo"], "planta"], "#FFE299", "#6FB08F"],
            "circle-stroke-width": 2, "circle-stroke-color": "#0B140F",
          },
        });

        map.jumpTo({ center: centroRef.current, zoom: 15.5 });
        setCarregando(false);
      };
      // o GeoJSON chega depois do mapa criado: se o satélite já carregou, o
      // "load" já passou e esperar por ele deixaria a tela em "carregando a planta…"
      if (map.isStyleLoaded()) aoCarregar();
      else map.once("load", aoCarregar);

      /* ---- arrastar a planta ----
       *
       * O arraste NÃO refaz o desenho. Ele empurra a camada em pixels com
       * `line-translate`, que o MapLibre resolve na GPU sem tocar no GeoJSON —
       * antes, cada pixel de mouse recalculava as 207 mil linhas de Iturama e a
       * planta andava aos solavancos, meio segundo atrás do cursor. Ao soltar,
       * a geometria é recalculada UMA vez, na posição final, e o empurrão
       * visual volta a zero: o que fica gravado é o dado, não o truque.
       *
       * Com Shift o movimento anda a 15% — é o ajuste de centímetro, para
       * encostar a divisa no meio-fio sem precisar do teclado.
       *
       * Os eventos de movimento e soltura ficam na JANELA, não no mapa: soltar
       * o botão fora do canvas (no painel de baixo, comum quando se arrasta
       * para cima) deixava a planta grudada no cursor.
       */
      const FINO = 0.15;
      let arrastando: {
        px: number; py: number; base: Transform; ultimo: [number, number];
        parte: AjusteLocal | null; camadas: string[];
      } | null = null;
      let quadroArraste: number | null = null;
      // i = -1: a linha inteira anda (arrastada pelo traço, não por um vértice)
      let verticeArrastando: {
        s: LinhaSelecionada; i: number; coords: [number, number][]; inversa: ReturnType<typeof inverter>;
        base?: [number, number][]; inicio?: [number, number];
      } | null = null;
      // seleção em caixa: canto onde o arraste começou (pixels do mapa)
      let caixa: { x: number; y: number; somar: boolean } | null = null;
      const canvas = map.getCanvas();

      const emMetros = (dxPx: number, dyPx: number, origem: { px: number; py: number }): [number, number] => {
        const a = map.unproject([origem.px, origem.py]);
        const b = map.unproject([origem.px + dxPx, origem.py + dyPx]);
        const lat = centroRef.current[1];
        return [
          (b.lng - a.lng) * 111_320 * Math.cos((lat * Math.PI) / 180),
          (b.lat - a.lat) * 110_540,
        ];
      };

      map.on("mousedown", (e: MapMouseEvent) => {
        if (modoRef.current === "selecao") {
          e.preventDefault();
          caixa = { x: e.point.x, y: e.point.y, somar: e.originalEvent.shiftKey };
          const el = caixaRef.current;
          if (el) { el.style.display = "block"; el.style.left = `${e.point.x}px`; el.style.top = `${e.point.y}px`; el.style.width = "0px"; el.style.height = "0px"; }
          return;
        }
        if (modoRef.current === "vertices" && linhaSelecionadaRef.current && ferramentaLinhaRef.current === "vertices") {
          const hits = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ["edicao-vertices"] });
          const i = Number(hits[0]?.properties?.i);
          const s = linhaSelecionadaRef.current, coords = brutoRef.current ? coordenadasLinha(brutoRef.current, s) : null;
          // sem vértice no clique, mas em cima da linha laranja: a linha inteira anda
          const naLinha = !Number.isInteger(i) &&
            map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ["edicao-linha"] }).length > 0;
          if (coords && ((Number.isInteger(i) && coords[i]) || naLinha)) {
            const global = afim(centroRef.current, tRef.current);
            const k = membrosRef.current.m[s.feature]?.[s.linha] ?? -1;
            const a = k >= 0 ? ajustesRef.current[k] : null;
            const matriz = a ? compor(global, afim(centroArea(a.area), a.t)) : global;
            const inversa = inverter(matriz);
            const copia = coords.map((p) => [...p] as [number, number]);
            verticeArrastando = naLinha
              ? { s, i: -1, coords: copia, inversa, base: coords.map((p) => [...p] as [number, number]), inicio: aplicarMatrizPonto(inversa, [e.lngLat.lng, e.lngLat.lat]) }
              : { s, i, coords: copia, inversa };
            map.dragPan.disable(); e.preventDefault(); canvas.style.cursor = "grabbing";
          }
          return;
        }
        if (modoRef.current !== "mover") return;
        e.preventDefault();
        // com uma parte ativa, só ela e o seu contorno andam
        const parte = ajustesRef.current.find((a) => a.id === ativaRef.current) ?? null;
        arrastando = {
          px: e.point.x, py: e.point.y, base: tRef.current, ultimo: [0, 0], parte,
          camadas: parte ? ["planta-parte", "planta-parte-contorno"] : ["planta", "planta-contorno", "partes-linha"],
        };
        // o zoom durante o arraste invalidaria a conversão pixel→metro
        map.scrollZoom.disable();
        canvas.style.cursor = "grabbing";
      });

      const aoMover = (ev: MouseEvent) => {
        if (caixa) {
          const r = canvas.getBoundingClientRect();
          const x = Math.max(0, Math.min(r.width, ev.clientX - r.left)), y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
          const el = caixaRef.current;
          if (el) {
            el.style.left = `${Math.min(x, caixa.x)}px`; el.style.top = `${Math.min(y, caixa.y)}px`;
            el.style.width = `${Math.abs(x - caixa.x)}px`; el.style.height = `${Math.abs(y - caixa.y)}px`;
          }
          return;
        }
        if (verticeArrastando) {
          const r = canvas.getBoundingClientRect();
          const ll = map.unproject([ev.clientX - r.left, ev.clientY - r.top]);
          const novo = aplicarMatrizPonto(verticeArrastando.inversa, [ll.lng, ll.lat]);
          if (verticeArrastando.i < 0 && verticeArrastando.base && verticeArrastando.inicio) {
            const dx = novo[0] - verticeArrastando.inicio[0], dy = novo[1] - verticeArrastando.inicio[1];
            verticeArrastando.coords = verticeArrastando.base.map((p) => [p[0] + dx, p[1] + dy] as [number, number]);
            desenharLinhaSelecionada(verticeArrastando.s, verticeArrastando.coords);
            return;
          }
          const coords = verticeArrastando.coords, ultimo = coords.length - 1;
          const fechada = ultimo > 1 && Math.hypot(coords[0][0] - coords[ultimo][0], coords[0][1] - coords[ultimo][1]) < 1e-8;
          coords[verticeArrastando.i] = novo;
          if (fechada && verticeArrastando.i === 0) coords[ultimo] = [...novo];
          else if (fechada && verticeArrastando.i === ultimo) coords[0] = [...novo];
          desenharLinhaSelecionada(verticeArrastando.s, verticeArrastando.coords);
          return;
        }
        if (!arrastando) return;
        const r = canvas.getBoundingClientRect();
        const k = ev.shiftKey ? FINO : 1;
        const dx = (ev.clientX - r.left - arrastando.px) * k;
        const dy = (ev.clientY - r.top - arrastando.py) * k;
        arrastando.ultimo = [dx, dy];
        if (quadroArraste === null) quadroArraste = requestAnimationFrame(() => {
          quadroArraste = null;
          if (!arrastando) return;
          for (const id of arrastando.camadas) {
            if (map.getLayer(id)) map.setPaintProperty(id, "line-translate", arrastando.ultimo);
          }
        });
        // Não chama setState aqui. Mesmo com o traço na GPU, renderizar este
        // componente React a cada mousemove era o gargalo percebido pelo Carlos.
        // O painel numérico consolida o valor uma única vez, ao soltar.
      };

      const aoSoltar = (ev: MouseEvent) => {
        if (caixa) {
          const r = canvas.getBoundingClientRect();
          const x = Math.max(0, Math.min(r.width, ev.clientX - r.left)), y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
          const c0 = caixa;
          caixa = null;
          if (caixaRef.current) caixaRef.current.style.display = "none";
          if (Math.abs(x - c0.x) < 4 || Math.abs(y - c0.y) < 4) {
            if (!c0.somar) { setMsg("Arraste para desenhar o retângulo em volta das linhas."); }
            return;
          }
          const cantos = ([[c0.x, c0.y], [x, c0.y], [x, y], [c0.x, y]] as [number, number][])
            .map(([px, py]) => { const ll = map.unproject([px, py]); return [ll.lng, ll.lat] as [number, number]; });
          selecionarNaCaixaRef.current(cantos, c0.somar);
          return;
        }
        if (verticeArrastando) {
          const { s, coords, i } = verticeArrastando;
          verticeArrastando = null;
          map.dragPan.disable(); canvas.style.cursor = "crosshair";
          const antes = brutoRef.current ? coordenadasLinha(brutoRef.current, s) : null;
          const parado = antes?.length === coords.length &&
            coords.every((p, k) => Math.abs(antes[k][0] - p[0]) < 1e-12 && Math.abs(antes[k][1] - p[1]) < 1e-12);
          if (parado) return; // clique sem arrastar
          registrar();
          gravarEdicaoRef.current({ feature: s.feature, linha: s.linha, coordinates: coords });
          desenharLinhaSelecionada(s, coords);
          setMsg(i < 0 ? "Linha movida inteira. Ctrl+Z desfaz." : "Linha reajustada. Ctrl+Z desfaz.");
          return;
        }
        if (!arrastando) return;
        const { base, ultimo, parte, camadas } = arrastando;
        const [dLeste, dNorte] = emMetros(ultimo[0], ultimo[1], arrastando);
        arrastando = null;
        if (quadroArraste !== null) { cancelAnimationFrame(quadroArraste); quadroArraste = null; }
        map.scrollZoom.enable();
        canvas.style.cursor = modoRef.current === "mover" ? "grab" : "";

        // o desfazer volta ao estado de ANTES do arraste
        const antesDoArraste: Estado = {
          t: base,
          ajustes: parte ? ajustesRef.current.map((a) => (a.id === parte.id ? parte : a)) : ajustesRef.current,
          excluidas: excluidasRef.current,
          edicoes: edicoesRef.current,
        };
        setHistorico((h) => [...h.slice(-50), antesDoArraste]);
        if (parte) {
          const [pl, pn] = telaParaParte(dLeste, dNorte, base);
          const novos = antesDoArraste.ajustes.map((a) => (a.id === parte.id
            ? { ...a, t: { ...parte.t, offsetLesteM: parte.t.offsetLesteM + pl, offsetNorteM: parte.t.offsetNorteM + pn } } : a));
          ajustesRef.current = novos;
          setAjustes(novos);
          redesenhar(base, ocultosRef.current);
        } else {
          const novo: Transform = {
            ...base,
            offsetLesteM: base.offsetLesteM + dLeste,
            offsetNorteM: base.offsetNorteM + dNorte,
          };
          tRef.current = novo;
          setT(novo);
          // a geometria assume a posição e o empurrão visual zera no mesmo quadro
          redesenhar(novo, ocultosRef.current);
        }
        for (const id of camadas) {
          if (map.getLayer(id)) map.setPaintProperty(id, "line-translate", [0, 0]);
        }
      };

      window.addEventListener("mousemove", aoMover);
      window.addEventListener("mouseup", aoSoltar);
      limparArrasteRef.current = () => {
        if (quadroArraste !== null) cancelAnimationFrame(quadroArraste);
        window.removeEventListener("mousemove", aoMover);
        window.removeEventListener("mouseup", aoSoltar);
      };

      // ---- área de uma parte nova: um clique por vértice; fecha clicando no
      // primeiro ponto (ou duplo clique). O MapLibre manda dois "click" antes
      // do "dblclick", então o duplo clique só fecha — o vértice já entrou.
      map.on("click", (e: MapMouseEvent) => {
        // dividir ou apagar um trecho da linha já escolhida
        if (modoRef.current === "vertices" && ferramentaLinhaRef.current !== "vertices" && linhaSelecionadaRef.current) {
          if (editarLinhaNoPontoRef.current(e)) return;
        }
        if (modoRef.current === "objeto" || modoRef.current === "vertices") {
          if (modoRef.current === "objeto") {
            const parteHit = map.queryRenderedFeatures(e.point, { layers: ["partes-fundo"] })[0];
            const id = String(parteHit?.properties?.id ?? "");
            if (id && ajustesRef.current.some((a) => a.id === id)) {
              ativaRef.current = id; setAtiva(id); setModo("mover");
              setMsg(`“${parteHit.properties?.nome ?? "Peça"}” selecionada. Arraste para mover só ela.`);
              return;
            }
          }
          const inv = inverter(afim(centroRef.current, tRef.current));
          const cru = aplicarMatrizPonto(inv, [e.lngLat.lng, e.lngLat.lat]);
          const lado = map.unproject([e.point.x + 14, e.point.y]);
          const cruLado = aplicarMatrizPonto(inv, [lado.lng, lado.lat]);
          const limite = Math.hypot(cruLado[0] - cru[0], cruLado[1] - cru[1]);
          const s = linhaMaisProxima(brutoRef.current ?? bruto, cru, limite, excluidasRef.current);
          if (!s) { setMsg("Clique mais perto de uma linha da planta."); return; }
          linhaSelecionadaRef.current = s; setLinhaSelecionada(s);
          if (modoRef.current === "objeto") criarParteDaLinhaRef.current(s);
          else { desenharLinhaSelecionada(s); setMsg("Arraste os pontos laranja para reajustar esta linha."); }
          return;
        }
        if (modoRef.current !== "parte") return;
        const atual = desenhoRef.current;
        if (atual.length >= 3) {
          const p0 = map.project(atual[0] as [number, number]);
          if (Math.hypot(p0.x - e.point.x, p0.y - e.point.y) < 12) { fecharAreaRef.current(); return; }
        }
        const novo = [...atual, [e.lngLat.lng, e.lngLat.lat] as [number, number]];
        desenhoRef.current = novo;
        setDesenho(novo);
      });
      map.on("dblclick", (e: MapMouseEvent) => {
        if (modoRef.current !== "parte") return;
        e.preventDefault();
        fecharAreaRef.current();
      });

      // ---- apagar linha ----
      map.on("click", (e: MapMouseEvent) => {
        if (modoRef.current !== "apagar") return;
        apagarNoPontoRef.current(e);
      });

      // ---- pontos de controle ----
      map.on("click", (e: MapMouseEvent) => {
        if (modoRef.current !== "pontos") return;
        const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (!pendenteRef.current) {
          pendenteRef.current = p;
          setPendente(p);
          setPares((atuais) => { desenharPares(atuais, p); return atuais; });
        } else {
          const par = { planta: pendenteRef.current, satelite: p };
          pendenteRef.current = null;
          setPendente(null);
          setPares((atuais) => { const novo = [...atuais, par]; desenharPares(novo, null); return novo; });
        }
      });
    })();

    return () => {
      cancelado = true;
      limparArrasteRef.current?.();
      limparArrasteRef.current = null;
      mapa?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camada.id]);

  // o modo controla o pan do mapa e o cursor
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (modo === "mover" || modo === "vertices" || modo === "selecao") {
      map.dragPan.disable(); map.getCanvas().style.cursor = modo === "mover" ? "grab" : "crosshair";
    } else {
      map.dragPan.enable(); map.getCanvas().style.cursor = modo === "pontos" || modo === "parte" || modo === "objeto" || modo === "apagar" ? "crosshair" : "";
    }
    // no desenho da área o duplo clique fecha a área, não aproxima o mapa
    if (modo === "parte") map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    // Shift + arrastar soma caixas na seleção; o zoom por caixa do MapLibre usa o mesmo gesto
    if (modo === "selecao") map.boxZoom.disable(); else map.boxZoom.enable();
    // a seleção só vale dentro do próprio modo: em outro modo ela confundiria o que vai ser movido
    if (modo !== "selecao" && selecaoRef.current.size) limparSelecao();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, carregando]);

  // a área em desenho aparece no mapa enquanto é desenhada
  useEffect(() => {
    const map = mapRef.current;
    const fonte = map?.getSource("desenho") as GeoJSONSource | undefined;
    if (!fonte) return;
    const feats: GeoJSON.Feature[] = desenho.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
    if (desenho.length >= 2) {
      feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: desenho.length >= 3 ? [...desenho, desenho[0]] : desenho }, properties: {} });
    }
    fonte.setData({ type: "FeatureCollection", features: feats });
  }, [desenho, carregando]);

  // trocar a parte ativa muda o que vai para a fonte que o arraste empurra
  useEffect(() => { redesenhar(tRef.current, ocultosRef.current); }, [ativa, redesenhar]);
  // o mapa ganha (ou devolve) a altura do painel de baixo
  const temSelecao = selecao.size > 0;
  useEffect(() => { mapRef.current?.resize(); }, [painelAberto, modo, temSelecao, erro, ajustes.length]);
  useEffect(() => { desenharLinhaSelecionada(modo === "vertices" ? linhaSelecionada : null); }, [linhaSelecionada, modo, carregando, desenharLinhaSelecionada]);

  criarParteDaLinhaRef.current = (s) => {
    const bruto = brutoRef.current;
    if (!bruto) return;
    const existente = membrosRef.current.m[s.feature]?.[s.linha] ?? -1;
    if (existente >= 0 && ajustesRef.current[existente]) {
      const id = ajustesRef.current[existente].id;
      ativaRef.current = id; setAtiva(id); setModo("mover");
      setMsg(`“${ajustesRef.current[existente].nome}” selecionada. Arraste para mover só esta peça.`);
      return;
    }
    const linha = coordenadasLinha(bruto, s);
    if (!linha?.length) return;
    const fechada = linha.length >= 4 && Math.hypot(linha[0][0] - linha.at(-1)![0], linha[0][1] - linha.at(-1)![1]) < 1e-8;
    let area: [number, number][];
    if (fechada) area = linha.slice(0, -1);
    else {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of linha) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const folga = Math.max((x1 - x0) * 0.08, (y1 - y0) * 0.08, 0.000003);
      area = [[x0 - folga, y0 - folga], [x1 + folga, y0 - folga], [x1 + folga, y1 + folga], [x0 - folga, y1 + folga]];
    }
    const encosta = ajustesRef.current.find((a) => areasSeSobrepoem(a.area, area));
    if (encosta) { setMsg(`Essa peça encosta em “${encosta.nome}”. Selecione essa parte ou remova-a primeiro.`); return; }
    const numero = ajustesRef.current.length + 1;
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).slice(0, 13);
    const nova: AjusteLocal = { id, nome: `Peça ${numero}`, area, t: { ...TRANSFORM_ZERO } };
    ativaRef.current = id; setAtiva(id);
    definir(tRef.current, [...ajustesRef.current, nova]);
    setModo("mover");
    setMsg(`${nova.nome} selecionada diretamente. Arraste para mover só ela.`);
  };

  /**
   * Refaz um objeto da planta a partir do ORIGINAL com as correções da lista,
   * na ordem. Toda correção de linha passa por aqui (nunca altera o objeto no
   * lugar), e é isso que deixa o desfazer voltar uma linha dividida ou movida.
   */
  function reconstruir(i: number, lista: EdicaoGeometria[]) {
    const original = originalRef.current, bruto = brutoRef.current;
    const o = original?.features[i];
    if (!o || !bruto) return;
    const minhas = lista.filter((e) => e.feature === i).map((e) => ({ ...e, feature: 0 }));
    bruto.features[i] = aplicarEdicoesGeoJSON({ type: "FeatureCollection", features: [o] }, minhas).features[0];
  }

  function trocarEdicoes(lista: EdicaoGeometria[], tocados: Iterable<number>) {
    edicoesRef.current = lista; setEdicoes(lista);
    for (const i of new Set(tocados)) reconstruir(i, lista);
    membrosRef.current.chave = "";
    redesenhar(tRef.current, ocultosRef.current);
  }

  /**
   * Grava a correção de uma linha. Substitui a ÚLTIMA correção da mesma linha
   * se ela não criou pedaços; senão entra no fim — as correções valem na ordem,
   * e tirar uma que dividiu a linha apagaria os pedaços (e mudaria as chaves
   * "i:j" das linhas que vieram depois).
   */
  gravarEdicaoRef.current = (nova: EdicaoGeometria) => {
    const lista = [...edicoesRef.current];
    let ultima = -1;
    lista.forEach((x, k) => { if (x.feature === nova.feature && x.linha === nova.linha) ultima = k; });
    if (!nova.extras?.length && ultima >= 0 && !lista[ultima].extras?.length) lista[ultima] = nova;
    else lista.push(nova);
    trocarEdicoes(lista, [nova.feature]);
  };

  /**
   * "Dividir" e "Apagar trecho" na linha escolhida (áudio do Carlos, 10/11:
   * "a ponta dela não era necessária, a outra já era necessária"). O clique é
   * levado ao desenho cru pela matriz da linha e cai no segmento mais próximo.
   */
  editarLinhaNoPontoRef.current = (e: MapMouseEvent) => {
    const map = mapRef.current, bruto = brutoRef.current, s = linhaSelecionadaRef.current;
    if (!map || !bruto || !s) return false;
    const coords = coordenadasLinha(bruto, s);
    if (!coords) return false;
    const g = afim(centroRef.current, tRef.current);
    const k = membrosRef.current.m[s.feature]?.[s.linha] ?? -1;
    const a = k >= 0 ? ajustesRef.current[k] : null;
    const inv = inverter(a ? compor(g, afim(centroArea(a.area), a.t)) : g);
    const cru = aplicarMatrizPonto(inv, [e.lngLat.lng, e.lngLat.lat]);
    const lado = map.unproject([e.point.x + 12, e.point.y]);
    const limite = Math.hypot(...(aplicarMatrizPonto(inv, [lado.lng, lado.lat]).map((v, n) => v - cru[n]) as [number, number]));
    const alvo = segmentoMaisProximo(coords, cru);
    // fora da linha laranja: deixa o clique escolher outra linha
    if (!alvo || Math.sqrt(alvo.d2) > limite) return false;
    const multi = bruto.features[s.feature]?.geometry?.type === "MultiLineString";
    const ferramenta = ferramentaLinhaRef.current;
    let primeira: [number, number][], segunda: [number, number][];
    if (ferramenta === "dividir") {
      primeira = [...coords.slice(0, alvo.j), alvo.ponto];
      segunda = [alvo.ponto, ...coords.slice(alvo.j)];
    } else {
      primeira = coords.slice(0, alvo.j);
      segunda = coords.slice(alvo.j);
    }
    const ok1 = primeira.length >= 2, ok2 = segunda.length >= 2;
    if (!ok1 && !ok2) {
      // linha de um segmento só: apagar o trecho é apagar a linha
      registrar();
      const chave = multi ? `${s.feature}:${s.linha}` : String(s.feature);
      const novo = new Set(excluidasRef.current); novo.add(chave);
      excluidasRef.current = novo; setExcluidas(novo);
      linhaSelecionadaRef.current = null; setLinhaSelecionada(null);
      redesenhar(tRef.current, ocultosRef.current);
      setMsg("A linha tinha um trecho só e foi apagada inteira. Ctrl+Z desfaz.");
      return true;
    }
    if (ok1 && ok2 && !multi) {
      setMsg("Esta linha é um objeto avulso do CAD: dá para encurtar pelas pontas ou apagar inteira, mas não partir em duas.");
      return true;
    }
    registrar();
    const fica = ok1 ? primeira : segunda;
    const extras = ok1 && ok2 ? [segunda] : undefined;
    gravarEdicaoRef.current({ feature: s.feature, linha: s.linha, coordinates: fica, ...(extras ? { extras } : {}) });
    desenharLinhaSelecionada(s, fica);
    setMsg(ferramenta === "dividir"
      ? "Linha dividida em duas. Escolha o pedaço que quer apagar ou mover. Ctrl+Z desfaz."
      : extras ? "Trecho apagado; a linha virou duas. Ctrl+Z desfaz." : "Ponta apagada. Ctrl+Z desfaz.");
    return true;
  };

  /**
   * Seleção em caixa: pega as linhas cujo centro cai dentro do retângulo, na
   * posição em que aparecem (com a calibração e a parte de cada uma). É o
   * mesmo critério que decide a parte de uma linha, então "Mover juntas" leva
   * exatamente o que ficou destacado.
   */
  selecionarNaCaixaRef.current = (cantos, somar) => {
    const bruto = brutoRef.current;
    if (!bruto) return;
    const g = afim(centroRef.current, tRef.current);
    const ms = ajustesRef.current.map((a) => compor(g, afim(centroArea(a.area), a.t)));
    const membros = membrosRef.current.m;
    const esconder = ocultosRef.current, apagadas = excluidasRef.current;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of cantos) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const dentro = (c: [number, number] | null, k: number) => {
      if (!c) return false;
      const p = aplicarMatrizPonto(k >= 0 ? ms[k] : g, c);
      return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && pontoNaArea(p, cantos);
    };
    const novo = new Set(somar ? selecaoRef.current : []);
    bruto.features.forEach((f, i) => {
      if (!f.geometry || apagadas.has(String(i))) return;
      if (esconder.size && esconder.has(String(f.properties?.layer ?? ""))) return;
      if (f.geometry.type === "MultiLineString") {
        f.geometry.coordinates.forEach((l, j) => {
          const chave = `${i}:${j}`;
          if (!apagadas.has(chave) && dentro(centroLinha(l), membros[i]?.[j] ?? -1)) novo.add(chave);
        });
      } else if (dentro(centroFeature(f), membros[i]?.[0] ?? -1)) novo.add(String(i));
    });
    // a área fica guardada no desenho cru (sem a calibração da planta), como a das partes
    const invG = inverter(g);
    const cru = cantos.map((p) => aplicarMatrizPonto(invG, p));
    const caixas = somar ? [...caixasSelecaoRef.current, cru] : [cru];
    selecaoRef.current = novo; setSelecao(novo);
    caixasSelecaoRef.current = caixas; setCaixasSelecao(caixas);
    desenharSelecao(novo);
    setMsg(novo.size
      ? `${fmt(novo.size)} linha${novo.size === 1 ? "" : "s"} selecionada${novo.size === 1 ? "" : "s"}. Apague (Delete) ou mova juntas. Shift + arrastar soma outra área.`
      : "Nenhuma linha dentro do retângulo.");
  };

  /** Destaca em laranja as linhas selecionadas, na posição em que aparecem. */
  function desenharSelecao(chaves: Set<string>) {
    const map = mapRef.current, bruto = brutoRef.current;
    const fonte = map?.getSource("selecao") as GeoJSONSource | undefined;
    if (!fonte || !bruto) return;
    if (!chaves.size) { fonte.setData(VAZIO); return; }
    const g = afim(centroRef.current, tRef.current);
    const ms = ajustesRef.current.map((a) => compor(g, afim(centroArea(a.area), a.t)));
    const linhas: GeoJSON.Position[][] = [];
    for (const chave of chaves) {
      const [i, j] = chave.split(":").map(Number);
      const f = bruto.features[i];
      if (!f?.geometry) continue;
      const k = membrosRef.current.m[i]?.[Number.isInteger(j) ? j : 0] ?? -1;
      const m = k >= 0 ? ms[k] : g;
      const geo = f.geometry;
      const lista = geo.type === "MultiLineString" ? (Number.isInteger(j) && geo.coordinates[j] ? [geo.coordinates[j]] : [])
        : geo.type === "LineString" ? [geo.coordinates]
        : geo.type === "Polygon" ? geo.coordinates
        : geo.type === "MultiPolygon" ? geo.coordinates.flat() : [];
      for (const l of lista) linhas.push(l.map((p) => aplicarMatrizPonto(m, p as [number, number])));
      if (linhas.length > 60_000) break; // destaque é só visual; não trava a tela
    }
    fonte.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: linhas } }] });
  }

  function limparSelecao() {
    const vazio = new Set<string>();
    selecaoRef.current = vazio; setSelecao(vazio);
    caixasSelecaoRef.current = []; setCaixasSelecao([]);
    desenharSelecao(vazio);
  }

  function apagarSelecionadas() {
    const sel = selecaoRef.current;
    if (!sel.size) return;
    registrar();
    const novo = new Set(excluidasRef.current);
    for (const c of sel) novo.add(c);
    excluidasRef.current = novo; setExcluidas(novo);
    const n = sel.size;
    limparSelecao();
    redesenhar(tRef.current, ocultosRef.current);
    setMsg(`${fmt(n)} linha${n === 1 ? "" : "s"} apagada${n === 1 ? "" : "s"} de uma vez. Ctrl+Z desfaz.`);
  }

  /** As linhas selecionadas viram uma parte: andam, giram e esticam juntas. */
  function moverSelecionadasJuntas() {
    const caixas = caixasSelecaoRef.current;
    if (!selecaoRef.current.size || !caixas.length) return;
    const area = caixas.length === 1 ? caixas[0] : contornoConvexo(caixas.flat());
    const encosta = ajustesRef.current.find((a) => areasSeSobrepoem(a.area, area));
    if (encosta) {
      setErro({
        mensagem: `A seleção encosta em “${encosta.nome}”.`,
        motivo: "Cada linha da planta só pode pertencer a uma parte.",
        solucao: `Selecione “${encosta.nome}” na faixa “Ajustar” para mover aquela parte, ou remova-a antes de selecionar por cima dela.`,
        codigo: "partes_sobrepostas", status: 0,
      });
      return;
    }
    const numero = ajustesRef.current.reduce((n, a) => Math.max(n, Number(a.nome.match(/(\d+)$/)?.[1] ?? 0)), 0) + 1;
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).slice(0, 13);
    const nova: AjusteLocal = { id, nome: `Parte ${numero}`, area, t: { ...TRANSFORM_ZERO } };
    const n = selecaoRef.current.size;
    limparSelecao();
    setErro(null);
    ativaRef.current = id; setAtiva(id);
    definir(tRef.current, [...ajustesRef.current, nova]);
    setModo("mover");
    setMsg(`${nova.nome} criada com ${fmt(n)} linhas. Arraste para mover juntas; gire ou estique no painel de baixo.`);
  }

  fecharAreaRef.current = () => {
    const map = mapRef.current, bruto = brutoRef.current;
    // o duplo clique deixa vértices repetidos no fim: fora
    const pts: [number, number][] = [];
    for (const p of desenhoRef.current) {
      const ult = pts[pts.length - 1];
      if (ult && map) {
        const a = map.project(ult), b = map.project(p);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 4) continue;
      }
      pts.push(p);
    }
    if (pts.length < 3 || !bruto) {
      setErro({
        mensagem: "A área precisa de pelo menos três pontos.",
        solucao: "Clique em volta da quadra ou do trecho que quer mover e feche clicando no primeiro ponto.",
        codigo: "area_curta", status: 0,
      });
      return;
    }
    // a área é guardada no desenho cru: desfaz a calibração da planta inteira
    const inv = inverter(afim(centroRef.current, tRef.current));
    const area = pts.map((p) => aplicarMatrizPonto(inv, p));
    const atuais = ajustesRef.current;
    const encosta = atuais.find((a) => areasSeSobrepoem(a.area, area));
    if (encosta) {
      setErro({
        mensagem: `A área nova encosta em “${encosta.nome}”.`,
        motivo: "Cada linha da planta só pode pertencer a uma parte.",
        solucao: "Desenhe a área sem cruzar o contorno laranja da outra parte, ou remova a outra parte antes.",
        codigo: "partes_sobrepostas", status: 0,
      });
      return;
    }
    // linhas que a área nova pega e que ainda não são de outra parte
    const linhas = bruto.features.reduce((n, f, i) => {
      const novas = partesDasLinhas(f, [area]);
      const ja = membrosRef.current.m[i];
      return n + novas.reduce((s, k, j) => s + (k === 0 && (ja?.[j] ?? -1) < 0 ? 1 : 0), 0);
    }, 0);
    if (!linhas) {
      setErro({
        mensagem: "Nenhuma linha da planta caiu dentro da área.",
        solucao: "Desenhe a área em volta das linhas amarelas que quer mover.",
        codigo: "area_vazia", status: 0,
      });
      return;
    }
    const numero = atuais.reduce((n, a) => Math.max(n, Number(a.nome.match(/(\d+)$/)?.[1] ?? 0)), 0) + 1;
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).slice(0, 13);
    const nova: AjusteLocal = { id, nome: `Parte ${numero}`, area, t: { ...TRANSFORM_ZERO } };
    setErro(null);
    desenhoRef.current = [];
    setDesenho([]);
    ativaRef.current = id;
    setAtiva(id);
    definir(tRef.current, [...atuais, nova]);
    setModo("mover");
    setMsg(`${nova.nome} criada com ${fmt(linhas)} linhas. Arraste para encaixar só este trecho.`);
  };

  /**
   * Apagar: acha a linha da planta mais perto do clique e tira da lista do mapa.
   * O ponto clicado volta para as coordenadas do desenho cru (desfazendo a
   * calibração da planta ou da parte daquela linha) e a distância é medida lá,
   * sem projetar as dezenas de milhares de vértices na tela a cada clique.
   */
  apagarNoPontoRef.current = (e: MapMouseEvent) => {
    const map = mapRef.current, bruto = brutoRef.current;
    if (!map || !bruto) return;
    const tol = 7;
    const achados = map.queryRenderedFeatures(
      [[e.point.x - tol, e.point.y - tol], [e.point.x + tol, e.point.y + tol]],
      { layers: ["planta", "planta-parte"].filter((id) => map.getLayer(id)) }
    );
    const indices = [...new Set(achados.map((f) => Number(f.properties?.__i)).filter((n) => Number.isInteger(n)))];
    if (!indices.length) {
      setMsg("Nenhuma linha da planta neste ponto. Aproxime o mapa e clique em cima da linha.");
      return;
    }
    const g = afim(centroRef.current, tRef.current);
    const ajs = ajustesRef.current;
    const invs = ajs.map((a) => inverter(compor(g, afim(centroArea(a.area), a.t))));
    const invG = inverter(g);
    const clique: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const cosLat = Math.cos((clique[1] * Math.PI) / 180);
    // distância ponto–segmento em graus, com a longitude encolhida pela latitude
    const dist = (p: [number, number], a: GeoJSON.Position, b: GeoJSON.Position) => {
      const ax = a[0] * cosLat, ay = a[1], bx = b[0] * cosLat, by = b[1], px = p[0] * cosLat, py = p[1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
    };
    const pontoCru = (k: number) => aplicarMatrizPonto(k >= 0 ? invs[k] : invG, clique) as [number, number];
    let melhor: { chave: string; d: number; camada: string } | null = null;
    for (const i of indices) {
      const f = bruto.features[i];
      if (!f?.geometry) continue;
      const camadaCad = String(f.properties?.layer ?? "");
      const linhas: GeoJSON.Position[][] =
        f.geometry.type === "MultiLineString" ? f.geometry.coordinates
        : f.geometry.type === "LineString" ? [f.geometry.coordinates]
        : f.geometry.type === "Polygon" ? f.geometry.coordinates
        : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.flat()
        : [];
      const multi = f.geometry.type === "MultiLineString";
      linhas.forEach((l, j) => {
        const chave = multi ? `${i}:${j}` : String(i);
        if (excluidasRef.current.has(chave)) return;
        const k = multi ? (membrosRef.current.m[i]?.[j] ?? -1) : (membrosRef.current.m[i]?.[0] ?? -1);
        const p = pontoCru(k);
        for (let v = 1; v < l.length; v++) {
          const d = dist(p, l[v - 1], l[v]);
          if (!melhor || d < melhor.d) melhor = { chave, d, camada: camadaCad };
        }
      });
    }
    // aceita até ~2× a tolerância do clique, convertida de pixels para graus
    const a = map.unproject([e.point.x, e.point.y]), b = map.unproject([e.point.x + tol * 2, e.point.y]);
    const limite = Math.abs(b.lng - a.lng) * cosLat;
    const achado = melhor as { chave: string; d: number; camada: string } | null;
    if (!achado || achado.d > limite) {
      setMsg("Nenhuma linha da planta neste ponto. Aproxime o mapa e clique em cima da linha.");
      return;
    }
    registrar();
    const novo = new Set(excluidasRef.current);
    novo.add(achado.chave);
    excluidasRef.current = novo;
    setExcluidas(novo);
    redesenhar(tRef.current, ocultosRef.current);
    setMsg(`Linha apagada${achado.camada ? ` (camada ${achado.camada})` : ""}. Ctrl+Z desfaz.`);
  };

  function restaurarApagadas() {
    if (!excluidasRef.current.size) return;
    registrar();
    const vazio = new Set<string>();
    excluidasRef.current = vazio;
    setExcluidas(vazio);
    redesenhar(tRef.current, ocultosRef.current);
  }

  function mudarEspessura(k: number) {
    setEspessura(k);
    const map = mapRef.current;
    if (!map) return;
    for (const [id, base] of [["planta", LARGURA.linha], ["planta-contorno", LARGURA.contorno], ["planta-parte", LARGURA.parte], ["planta-parte-contorno", LARGURA.contorno]] as const) {
      if (map.getLayer(id)) map.setPaintProperty(id, "line-width", largura(base, k));
    }
  }

  function cancelarDesenho() {
    desenhoRef.current = [];
    setDesenho([]);
    setModo("mover");
  }

  function selecionarParte(id: string | null) {
    ativaRef.current = id;
    setAtiva(id);
    if (modo === "parte") cancelarDesenho();
    if (id && modo === "pontos") setModo("mover");
  }

  function removerParte(id: string) {
    const restantes = ajustesRef.current.filter((a) => a.id !== id);
    ativaRef.current = null;
    setAtiva(null);
    definir(tRef.current, restantes);
  }

  function renomearParte(id: string, nome: string) {
    setAjustes((lista) => lista.map((a) => (a.id === id ? { ...a, nome: nome.slice(0, 60) } : a)));
  }

  const mover = useCallback((dLeste: number, dNorte: number) => {
    if (ativaRef.current) {
      // as setas falam em direção da tela (norte, leste); a parte guarda o
      // deslocamento antes do giro da planta
      const [pl, pn] = telaParaParte(dLeste, dNorte, tRef.current);
      aplicarParte((pt) => ({ ...pt, offsetLesteM: pt.offsetLesteM + pl, offsetNorteM: pt.offsetNorteM + pn }));
      return;
    }
    aplicar({ ...tRef.current, offsetLesteM: tRef.current.offsetLesteM + dLeste, offsetNorteM: tRef.current.offsetNorteM + dNorte });
  }, [aplicar, aplicarParte]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo && ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)) return;
      const p = e.shiftKey ? 1 : passo;
      if (e.key === "ArrowUp") { e.preventDefault(); mover(0, p); }
      else if (e.key === "ArrowDown") { e.preventDefault(); mover(0, -p); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); mover(-p, 0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); mover(p, 0); }
      else if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); desfazer(); }
      else if (e.key === "Enter" && modo === "parte") { e.preventDefault(); fecharAreaRef.current(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selecaoRef.current.size) { e.preventDefault(); apagarSelecionadas(); }
      // no desenho da área, Esc desiste da área; não fecha a calibração
      else if (e.key === "Escape") {
        if (modo === "parte") cancelarDesenho();
        else if (selecaoRef.current.size) limparSelecao();
        else if (pedirConfirmacao) setPedirConfirmacao(false);
        else fechar();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  function desfazer() {
    const h = historico;
    if (!h.length) return;
    const anterior = h[h.length - 1];
    setHistorico(h.slice(0, -1));
    // a parte ativa pode ter sumido no passo desfeito (ex.: desfazer a criação)
    if (ativaRef.current && !anterior.ajustes.some((a) => a.id === ativaRef.current)) {
      ativaRef.current = null;
      setAtiva(null);
    }
    if (anterior.excluidas !== excluidasRef.current) {
      excluidasRef.current = anterior.excluidas;
      setExcluidas(anterior.excluidas);
    }
    if (anterior.edicoes !== edicoesRef.current) {
      const tocados = [...edicoesRef.current, ...anterior.edicoes].map((e) => e.feature);
      trocarEdicoes(anterior.edicoes, tocados);
      const s = linhaSelecionadaRef.current;
      if (s && brutoRef.current && !coordenadasLinha(brutoRef.current, s)) { linhaSelecionadaRef.current = null; setLinhaSelecionada(null); }
      else desenharLinhaSelecionada(modoRef.current === "vertices" ? s : null);
    }
    if (selecaoRef.current.size) limparSelecao();
    definir(anterior.t, anterior.ajustes, false);
  }

  function alternarLayer(nome: string) {
    setOcultos((atual) => {
      const novo = new Set(atual);
      if (novo.has(nome)) novo.delete(nome); else novo.add(nome);
      redesenhar(tRef.current, novo);
      return novo;
    });
  }

  function aplicarPontos() {
    const ajuste = ajustarPorPontos(pares, centroRef.current, t);
    if (!ajuste) {
      setErro({
        mensagem: "Não deu para calcular o ajuste com esses pontos.",
        motivo: "Os pontos marcados na planta estão praticamente no mesmo lugar — sem distância entre eles não há como medir giro nem escala.",
        solucao: "Marque o segundo par num ponto distante do primeiro, de preferência em cantos opostos da cidade.",
        codigo: "pontos_degenerados", status: 0,
      });
      return;
    }
    setErro(null);
    setResiduo(ajuste.residuoM);
    aplicar({
      offsetLesteM: ajuste.offsetLesteM, offsetNorteM: ajuste.offsetNorteM,
      rotacaoGraus: ajuste.rotacaoGraus, escala: ajuste.escala,
    });
  }

  function aplicarDatum(chave: string) {
    const d = DESLOCAMENTO_DATUM[chave];
    if (!d) return;
    aplicar({ ...t, offsetLesteM: d.leste, offsetNorteM: d.norte });
  }

  /**
   * O aviso de sucesso repete o que o BANCO respondeu, não o que a tela tem.
   * É de propósito: a queixa era "calibro e não salva", e uma mensagem genérica
   * não distingue gravou de não gravou. Aqui, se o número ecoado bate com o
   * painel, gravou; se não bate, o operador vê na hora.
   */
  async function salvar(auto = false) {
    setSalvando(true); if (!auto) setMsg(""); setErro(null);
    const r = await enviarJson<{
      aplicado?: Record<string, number | string[]>;
      publico?: { bytes: number; linhas: number; linhas_total: number } | null;
      aviso_publico?: string | null;
      lotes_movidos?: number | null;
      aviso_lotes?: string | null;
    }>(
      `/api/admin/cartografia/${camada.id}`, "PATCH", {
        offset_leste_m: Math.round(t.offsetLesteM * 100) / 100,
        offset_norte_m: Math.round(t.offsetNorteM * 100) / 100,
        rotacao_graus: Math.round(t.rotacaoGraus * 1e4) / 1e4,
        escala: Math.round(t.escala * 1e6) / 1e6,
        opacidade,
        layers_ocultos: [...ocultos],
        pontos_controle: pares,
        ajustes_locais: ajustes,
        linhas_excluidas: [...excluidas],
        espessura_linha: espessura,
        edicoes_geometria: edicoes,
      });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro);
      // erro no automático desliga o automático: repetir o mesmo pedido a cada 12 s não resolve
      if (auto) { mudarAutoSalvar(false); setMsg("O salvamento automático falhou e foi desligado. Veja o erro abaixo."); }
      return;
    }

    // o que acabou de ser gravado passa a ser a referência de "sem pendência"
    // as partes voltam arredondadas do servidor (cm e 1e-4°): a tela passa a
    // usar o que foi gravado, senão acusaria pendência logo depois de salvar
    const gravadas = (r.dados.aplicado as { ajustes_locais?: AjusteLocal[] } | undefined)?.ajustes_locais;
    if (gravadas) { ajustesRef.current = gravadas; setAjustes(gravadas); }
    setSalvo({
      t: tRef.current, ocultos: [...ocultos].sort(), opacidade, ajustes: JSON.stringify(ajustesRef.current),
      excluidas: [...excluidas].sort().join(","), espessura, edicoes: JSON.stringify(edicoesRef.current),
    });

    const g = r.dados.aplicado ?? {};
    if (auto) {
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      setMsg(`Salvo automaticamente às ${hora}. Já vale no mapa público.` +
        (r.dados.aviso_publico ? ` Atenção: o arquivo filtrado não foi gerado (${r.dados.aviso_publico}).` : "") +
        (r.dados.aviso_lotes ? ` Atenção: ${r.dados.aviso_lotes}.` : ""));
      return;
    }
    const n = (v: unknown, casas: number) => (typeof v === "number" ? v.toFixed(casas) : "—");
    setMsg(
      `Gravado: leste ${n(g.offset_leste_m, 1)} m · norte ${n(g.offset_norte_m, 1)} m · ` +
      `giro ${n(g.rotacao_graus, 3)}° · escala ${typeof g.escala === "number" ? (g.escala * 100).toFixed(2) + "%" : "—"} · ` +
      `${ocultos.size} camada${ocultos.size === 1 ? "" : "s"} do CAD oculta${ocultos.size === 1 ? "" : "s"}. Já vale no mapa público.` +
      (r.dados.publico?.bytes
        ? ` O mapa público passa a baixar ${(r.dados.publico.bytes / 1048576).toFixed(1)} MB ` +
          `(${r.dados.publico.linhas.toLocaleString("pt-BR")} de ${r.dados.publico.linhas_total.toLocaleString("pt-BR")} linhas).`
        : "") +
      (r.dados.aviso_publico ? ` Atenção: o arquivo filtrado não foi gerado (${r.dados.aviso_publico}); o mapa filtra no navegador.` : "") +
      (ajustes.length ? ` ${ajustes.length} parte${ajustes.length === 1 ? "" : "s"} com ajuste próprio.` : "") +
      (excluidas.size ? ` ${fmt(excluidas.size)} linha${excluidas.size === 1 ? "" : "s"} apagada${excluidas.size === 1 ? "" : "s"}.` : "") +
      (espessura !== 1 ? ` Espessura das linhas ${espessura.toFixed(2).replace(".", ",")}×.` : "") +
      (edicoes.length ? ` ${edicoes.length} linha${edicoes.length === 1 ? "" : "s"} reajustada${edicoes.length === 1 ? "" : "s"} e publicada${edicoes.length === 1 ? "" : "s"}.` : "") +
      (r.dados.lotes_movidos ? ` ${fmt(r.dados.lotes_movidos)} lotes clicáveis acompanharam as partes.` : "") +
      (r.dados.aviso_lotes ? ` Atenção: ${r.dados.aviso_lotes}.` : "")
    );
  }

  /**
   * "Já salvei isso?" — a tela não respondia, e a queixa de que a calibração
   * não salvava vinha em parte daí. `salvo` guarda o último estado GRAVADO (o
   * que veio do banco ao abrir, depois o que o PATCH confirmou), e a barra do
   * rodapé compara com o que está na tela.
   *
   * A tolerância de 1 cm em metros e de 1e-6 em escala existe porque o valor
   * volta arredondado do banco (`salvar` manda 2 casas em metros): comparar por
   * igualdade exata acusaria pendência logo depois de salvar com sucesso.
   */
  const [salvo, setSalvo] = useState<{ t: Transform; ocultos: string[]; opacidade: number; ajustes: string; excluidas: string; espessura: number; edicoes: string }>({
    t: inicial,
    excluidas: [...(camada.linhas_excluidas ?? [])].sort().join(","),
    espessura: camada.espessura ?? 1,
    ajustes: JSON.stringify(camada.ajustes ?? []),
    edicoes: JSON.stringify(camada.edicoes ?? []),
    ocultos: [...(camada.layers_ocultos ?? [])].sort(),
    opacidade: camada.opacidade ?? 0.85,
  });

  const haMudancaNaoSalva = useMemo(() => {
    if (!ehIgualAoSalvo(salvo.t, t)) return true;
    if (Math.abs(salvo.opacidade - opacidade) > 1e-6) return true;
    if (salvo.ajustes !== JSON.stringify(ajustes)) return true;
    if (salvo.excluidas !== [...excluidas].sort().join(",")) return true;
    if (Math.abs(salvo.espessura - espessura) > 1e-6) return true;
    if (salvo.edicoes !== JSON.stringify(edicoes)) return true;
    const atuais = [...ocultos].sort();
    return atuais.length !== salvo.ocultos.length || atuais.some((n, i) => n !== salvo.ocultos[i]);
  }, [salvo, t, ocultos, opacidade, ajustes, excluidas, espessura, edicoes]);

  /**
   * Fechar com calibração pendente perdia o trabalho sem aviso (X, clique fora
   * ou Esc). Agora a barra de edição pergunta antes; sem pendência, fecha direto.
   */
  const [pedirConfirmacao, setPedirConfirmacao] = useState(false);

  /**
   * Salvamento automático (áudio do Carlos, 10/11/2026: "alterou, salvou (...)
   * um deslize e a gente perde todo o trabalho"). Salva sozinho alguns segundos
   * depois da ÚLTIMA alteração — cada salvamento regrava o arquivo do mapa
   * público, então salvar a cada clique pesaria. Não salva no meio de um
   * desenho de área nem com a pergunta de sair aberta.
   */
  const salvarRef = useRef(salvar); salvarRef.current = salvar;
  useEffect(() => {
    if (!autoSalvar || !haMudancaNaoSalva || salvando || carregando || modo === "parte" || pedirConfirmacao) return;
    const id = window.setTimeout(() => { void salvarRef.current(true); }, ESPERA_AUTOSALVAR_MS);
    return () => window.clearTimeout(id);
  }, [autoSalvar, haMudancaNaoSalva, salvando, carregando, modo, pedirConfirmacao, t, ajustes, excluidas, edicoes, ocultos, opacidade, espessura]);
  function fechar() {
    if (haMudancaNaoSalva && !salvando) setPedirConfirmacao(true);
    else onFechar();
  }

  const btn = "grid w-11 h-11 place-items-center rounded-xl bg-superficie border border-linha-forte hover:bg-verde hover:border-verde hover:text-white transition-colors text-base font-semibold";
  const chip = (ativo: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold border transition-colors ${ativo ? "bg-verde text-white border-verde" : "border-linha-forte text-texto-2 hover:text-texto hover:bg-superficie-2"}`;
  const deslocamentoTotal = Math.hypot(t.offsetLesteM, t.offsetNorteM);

  return (
    /*
      TELA CHEIA (10/11/2026, pedido do Carlos: "deixar a tela de edição
      maior"). Antes era um modal de 1.152 px com o mapa em 50% da altura; agora
      ocupa a janela, o mapa fica com todo o espaço que sobra e o painel de
      baixo pode ser recolhido.
    */
    <div className="fixed inset-0 z-50 bg-black/70 flex items-stretch justify-center sm:p-2" onClick={fechar}>
      <div className="bg-superficie border border-linha sm:rounded-xl w-full h-full flex flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 px-5 py-2.5 border-b border-linha flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-texto-2">Calibrar sobre o satélite</p>
            <p className="lp-display text-lg leading-tight text-texto">{camada.nome}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-texto-2">
              {modo === "mover" && !parteAtual && "Arraste a planta com o mouse até bater no satélite. Segure Shift enquanto arrasta para andar devagar; setas do teclado para o ajuste fino (Shift = 1 m). Ctrl+Z desfaz."}
              {modo === "mover" && parteAtual && `Movendo só “${parteAtual.nome}” (linhas laranja). O resto da planta fica parado. Arraste, use as setas ou gire no painel abaixo. Para voltar a mover tudo, escolha “Planta inteira”.`}
              {modo === "parte" && (desenho.length < 3
                ? "Clique em volta da quadra ou do trecho que quer mover separado — um clique por canto."
                : "Feche a área clicando no primeiro ponto, com duplo clique ou Enter. Esc desiste.")}
              {modo === "objeto" && "Clique diretamente numa quadra, lote ou polilinha fechada. Ela vira uma peça independente e já fica pronta para arrastar."}
              {modo === "vertices" && !linhaSelecionada && "Clique na linha que quer reajustar."}
              {modo === "vertices" && linhaSelecionada && ferramentaLinha === "vertices" && "Arraste um ponto laranja para mover só aquele vértice, ou arraste a linha laranja para mover a linha inteira."}
              {modo === "vertices" && linhaSelecionada && ferramentaLinha === "dividir" && "Clique no ponto da linha laranja onde ela deve ser dividida em duas."}
              {modo === "vertices" && linhaSelecionada && ferramentaLinha === "trecho" && "Clique no trecho da linha laranja que deve sumir (entre dois vértices). O resto da linha fica."}
              {modo === "selecao" && "Arraste um retângulo em volta das linhas, como num recorte de tela. Shift + arrastar soma outra área. Depois apague ou mova todas juntas."}
              {modo === "navegar" && "Arraste para navegar no mapa. Volte para “mover planta” quando quiser ajustar."}
              {modo === "apagar" && "Clique em cima de uma linha para apagá-la do mapa (aproxime para acertar a linha certa). Ctrl+Z desfaz; nada muda no mapa público antes de salvar."}
              {modo === "pontos" && (pendente
                ? "Agora clique no MESMO ponto no satélite."
                : "Clique num ponto da planta (um cruzamento, um canto de quadra).")}
            </p>
          </div>
          <button onClick={fechar} aria-label="Fechar" className="grid w-9 h-9 place-items-center rounded-lg text-texto-2 hover:bg-superficie-2 hover:text-texto shrink-0"><X className="size-5" /></button>
        </div>

        {/*
          BARRA DE EDIÇÃO — modo, desfazer e salvar no mesmo lugar.

          Antes, "Salvar calibração" e "Desfazer" ficavam no fim do modal.
          Medido em 17/09/2026 numa janela de 778 px: o modal pede 1.180 px de
          rolagem e o salvar caía em y=1135 — 357 px abaixo da dobra. Dava para
          calibrar a planta inteira sem nunca ver como gravar.

          Ficam aqui, colados nos botões de modo, porque é a mesma tarefa:
          escolher a ferramenta, mexer, desfazer se errou, gravar quando bateu.
          Desde a tela cheia (10/11/2026) nada rola: a barra fica sempre no alto.
        */}
        <div className="shrink-0 z-10 bg-superficie border-b border-linha px-5 py-2 space-y-2">
          {pedirConfirmacao && (
            <div role="alertdialog" aria-label="Sair sem salvar?"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-ouro/50 bg-ouro/10 px-4 py-3 text-sm">
              <span className="font-semibold text-texto">Esta calibração tem alterações que ainda não foram salvas.</span>
              <span className="ml-auto flex flex-wrap gap-2">
                <button onClick={() => setPedirConfirmacao(false)} className="rounded-lg btn-contorno px-3 py-1.5 hover:bg-superficie-2">
                  Continuar editando
                </button>
                <button onClick={() => { setPedirConfirmacao(false); void salvar(); }} className="btn-ouro px-3 py-1.5">
                  Salvar agora
                </button>
                <button onClick={onFechar} className="rounded-lg px-3 py-1.5 font-semibold text-critico hover:bg-critico/10">
                  Sair sem salvar
                </button>
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button className={chip(modo === "mover")} onClick={() => setModo("mover")}><Move className="size-4" /> Mover planta</button>
            <button className={chip(modo === "objeto")} onClick={() => setModo("objeto")}
              title="Clique numa peça fechada para separá-la e mover só ela"><MousePointer2 className="size-4" /> Selecionar peça</button>
            <button className={chip(modo === "vertices")} onClick={() => setModo("vertices")}
              title="Selecione uma linha e arraste seus vértices"><Pencil className="size-4" /> Ajustar linha</button>
            <button className={chip(modo === "navegar")} onClick={() => setModo("navegar")}><Hand className="size-4" /> Navegar</button>
            <button className={chip(modo === "pontos")} onClick={() => { selecionarParte(null); setModo("pontos"); }}
              title="Calibra a planta inteira por pares de pontos"><Crosshair className="size-4" /> Pontos de controle</button>
            <button className={chip(modo === "selecao")} onClick={() => { if (modo === "parte") cancelarDesenho(); setMsg(""); setModo("selecao"); }}
              title="Arraste um retângulo para pegar várias linhas de uma vez — apagar ou mover juntas"><BoxSelect className="size-4" /> Selecionar área</button>
            <button className={chip(modo === "parte")} onClick={() => { desenhoRef.current = []; setDesenho([]); setModo("parte"); }}
              title="Clique em volta de um lote, quadra ou bairro para mover, girar e esticar só aquele trecho"><PenLine className="size-4" /> Desenhar perímetro</button>
            <button className={chip(modo === "apagar")} onClick={() => { if (modo === "parte") cancelarDesenho(); setMsg(""); setModo("apagar"); }}
              title="Clique numa linha para apagá-la da planta (o arquivo original não muda)"><Eraser className="size-4" /> Apagar linhas</button>
            {excluidas.size > 0 && (
              <button onClick={restaurarApagadas}
                className="inline-flex items-center gap-1.5 rounded-lg btn-contorno px-3 py-1.5 text-sm hover:bg-superficie-2 transition"
                title="Volta todas as linhas apagadas">
                <RotateCcw className="size-4" /> Restaurar {fmt(excluidas.size)} apagada{excluidas.size === 1 ? "" : "s"}
              </button>
            )}

            <span className="w-px self-stretch bg-linha mx-1" aria-hidden />

            <button onClick={desfazer} disabled={!historico.length}
              className="inline-flex items-center gap-1.5 rounded-lg btn-contorno px-3 py-1.5 text-sm hover:bg-superficie-2 transition disabled:opacity-40"
              title="Volta o último movimento (Ctrl+Z)">
              <Undo2 className="size-4" /> Desfazer
            </button>
            <button onClick={() => (parteAtual ? aplicarParte(() => ({ ...TRANSFORM_ZERO })) : aplicar({ offsetLesteM: 0, offsetNorteM: 0, rotacaoGraus: 0, escala: 1 }))}
              disabled={ehIgualAoSalvo(TRANSFORM_ZERO, parteAtual?.t ?? t)}
              className="rounded-lg btn-contorno px-3 py-1.5 text-sm hover:bg-superficie-2 transition disabled:opacity-40"
              title="Zera deslocamento, giro e escala">
              Zerar posição
            </button>

            <label className="ml-auto inline-flex items-center gap-1.5 text-sm text-texto-2 cursor-pointer select-none"
              title="Salva sozinho alguns segundos depois da última alteração">
              <input type="checkbox" checked={autoSalvar} onChange={(e) => mudarAutoSalvar(e.target.checked)} />
              Salvar automaticamente
            </label>
            <button onClick={() => void salvar()} disabled={salvando || !haMudancaNaoSalva}
              className="btn-ouro inline-flex items-center gap-1.5 px-5 py-2 text-sm disabled:opacity-60">
              <Save className="size-4" />
              {salvando ? "Salvando…" : "Salvar calibração"}
            </button>
          </div>

          {modo === "selecao" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wider text-texto-2 mr-1">Seleção</span>
              <span className="text-texto tabular-nums">{selecao.size ? `${fmt(selecao.size)} linha${selecao.size === 1 ? "" : "s"}` : "nenhuma linha — arraste no mapa"}</span>
              <button onClick={apagarSelecionadas} disabled={!selecao.size}
                className="inline-flex items-center gap-1.5 rounded-lg btn-contorno px-3 py-1.5 text-sm hover:bg-superficie-2 text-critico disabled:opacity-40">
                <Eraser className="size-4" /> Apagar selecionadas
              </button>
              <button onClick={moverSelecionadasJuntas} disabled={!selecao.size}
                className="btn-verde inline-flex items-center gap-1.5 px-3 py-1.5 text-sm disabled:opacity-50">
                <Move className="size-4" /> Mover juntas
              </button>
              <button onClick={limparSelecao} disabled={!selecao.size}
                className="rounded-lg btn-contorno px-3 py-1.5 text-sm hover:bg-superficie-2 disabled:opacity-40">Limpar seleção</button>
            </div>
          )}

          {modo === "vertices" && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wider text-texto-2 mr-1">Na linha</span>
              <button className={chip(ferramentaLinha === "vertices")} onClick={() => setFerramentaLinha("vertices")}
                title="Arraste um vértice, ou a linha inteira"><Pencil className="size-4" /> Mover pontos</button>
              <button className={chip(ferramentaLinha === "dividir")} onClick={() => setFerramentaLinha("dividir")}
                title="Clique na linha para parti-la em duas"><Scissors className="size-4" /> Dividir</button>
              <button className={chip(ferramentaLinha === "trecho")} onClick={() => setFerramentaLinha("trecho")}
                title="Clique num trecho para apagar só ele"><Eraser className="size-4" /> Apagar trecho</button>
              {linhaSelecionada && (
                <button onClick={() => { linhaSelecionadaRef.current = null; setLinhaSelecionada(null); }}
                  className="rounded-lg btn-contorno px-3 py-1.5 text-sm hover:bg-superficie-2">Escolher outra linha</button>
              )}
            </div>
          )}

          {(ajustes.length > 0 || modo === "parte") && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wider text-texto-2 mr-1">Ajustar</span>
              <button className={chip(!ativa)} onClick={() => selecionarParte(null)}>Planta inteira</button>
              {ajustes.map((a) => (
                <button key={a.id} className={chip(ativa === a.id)} onClick={() => { selecionarParte(a.id); setModo("mover"); }}
                  title={`Mover só ${a.nome}`}>
                  <span className="size-2 rounded-full bg-[#D9BD6F]" aria-hidden /> {a.nome}
                </button>
              ))}
              {modo === "parte" && (
                <span className="inline-flex items-center gap-1.5 ml-1">
                  <button onClick={() => fecharAreaRef.current()} disabled={desenho.length < 3}
                    className="btn-verde px-3 py-1.5 text-sm disabled:opacity-50">Concluir área ({desenho.length} pontos)</button>
                  <button onClick={cancelarDesenho} className="rounded-lg btn-contorno px-3 py-1.5 text-sm hover:bg-superficie-2">Cancelar</button>
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            {/* a pendência vem antes do "salvo com sucesso": mexer na planta
                depois de salvar não pode continuar mostrando confirmação */}
            {haMudancaNaoSalva
              ? <span className="inline-flex items-center gap-1.5 font-semibold text-ouro"><span className="size-2 rounded-full bg-ouro" aria-hidden /> Alterações não salvas
                  {/* o retorno de cada ação aparece junto (o de um salvamento antigo, não) */}
                  {msg && !/^(Gravado|Salvo)/.test(msg) && <span className="font-normal text-texto-2"> · {msg}</span>}</span>
              : msg
                ? <span className="text-verde">{msg}</span>
                : <span className="text-texto-2">Nada para salvar — a planta está como está gravada.</span>}
            <span className="ml-auto text-texto-2 tabular-nums">
              {carregando ? "carregando a planta…" : `${fmt(Math.max(0, linhasVisiveis - excluidas.size))} de ${fmt(totalLinhas)} linhas no mapa`}
            </span>
          </div>
        </div>

        {erro && <div className="shrink-0 px-5 py-2"><AvisoErro erro={erro} aoFechar={() => setErro(null)} /></div>}

        {/* o MapLibre põe "position: relative" no contêiner: a altura vem do flex, não de inset-0 */}
        <div className="relative flex-1 min-h-[260px] flex flex-col">
          <div ref={containerRef} className="flex-1 min-h-0 w-full" />
          {/* retângulo da seleção em caixa, desenhado por cima do mapa */}
          <div ref={caixaRef} aria-hidden className="pointer-events-none absolute hidden border-2 border-dashed border-[#FF8A3D] bg-[#FF8A3D]/10" />
        </div>

        <div className={`shrink-0 border-t border-linha ${painelAberto ? "max-h-[34vh] overflow-auto" : ""}`}>
          <div className={`flex items-center gap-1.5 px-5 ${painelAberto ? "pt-3" : "py-2"}`}>
            <button className={chip(painelAberto && aba === "posicao")} onClick={() => { setAba("posicao"); setPainelAberto(true); }}>Posição</button>
            <button className={chip(painelAberto && aba === "camadas")} onClick={() => { setAba("camadas"); setPainelAberto(true); }}>
              Camadas do CAD {ocultos.size > 0 && `(${ocultos.size} ocultas)`}
            </button>
            <button onClick={() => setPainelAberto((v) => !v)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-texto-2 hover:bg-superficie-2 hover:text-texto"
              title={painelAberto ? "Recolher o painel e aumentar o mapa" : "Mostrar o painel de ajuste"}>
              {painelAberto ? <><ChevronDown className="size-4" /> Mais mapa</> : <><ChevronUp className="size-4" /> Mostrar painel</>}
            </button>
          </div>

          {painelAberto && aba === "posicao" && (
            <div className="p-6 flex flex-wrap items-start gap-8">
              <div className="grid grid-cols-3 gap-1.5 w-fit">
                <span />
                <button className={btn} onClick={() => mover(0, passo)} title="Norte" aria-label="Norte"><ArrowUp className="size-5" /></button>
                <span />
                <button className={btn} onClick={() => mover(-passo, 0)} title="Oeste" aria-label="Oeste"><ArrowLeft className="size-5" /></button>
                <button className={btn + " text-xs"} title={parteAtual ? `Zerar ${parteAtual.nome}` : "Zerar tudo"}
                  onClick={() => (parteAtual ? aplicarParte(() => ({ ...TRANSFORM_ZERO })) : aplicar({ offsetLesteM: 0, offsetNorteM: 0, rotacaoGraus: 0, escala: 1 }))}>0</button>
                <button className={btn} onClick={() => mover(passo, 0)} title="Leste" aria-label="Leste"><ArrowRight className="size-5" /></button>
                <span />
                <button className={btn} onClick={() => mover(0, -passo)} title="Sul" aria-label="Sul"><ArrowDown className="size-5" /></button>
                <span />
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-texto-2">Passo do ajuste</p>
                  <div className="flex gap-1.5">
                    {[1, 5, 10, 50].map((p) => (
                      <button key={p} onClick={() => setPasso(p)} className={chip(passo === p)}>{p} m</button>
                    ))}
                  </div>
                </div>
                {!parteAtual && <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-texto-2">Ponto de partida por datum da planta</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(DESLOCAMENTO_DATUM).map(([k, d]) => (
                      <button key={k} onClick={() => aplicarDatum(k)}
                        className="rounded-lg btn-contorno px-3 py-1.5 text-xs hover:bg-superficie-2 transition">
                        {d.rotulo}
                      </button>
                    ))}
                  </div>
                </div>}
              </div>

              {parteAtual && (
                <div className="space-y-3 min-w-64 max-w-md">
                  <label className="block space-y-1">
                    <span className="text-sm text-texto-2">Nome da parte</span>
                    <input value={parteAtual.nome} maxLength={60} onChange={(e) => renomearParte(parteAtual.id, e.target.value)}
                      className="w-full rounded-lg border border-linha-forte bg-superficie px-3 py-1.5 text-sm" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-sm text-texto-2">Giro da parte: <strong className="text-texto">{parteAtual.t.rotacaoGraus.toFixed(2)}°</strong></span>
                    <input type="range" min={-15} max={15} step={0.01} value={parteAtual.t.rotacaoGraus} className="w-full"
                      onPointerDown={registrar}
                      onChange={(e) => aplicarParte((pt) => ({ ...pt, rotacaoGraus: Number(e.target.value) }), false)} />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-sm text-texto-2">Tamanho da parte: <strong className="text-texto">{((parteAtual.t.escala || 1) * 100).toFixed(1)}%</strong></span>
                    <input type="range" min={0.8} max={1.25} step={0.001} value={parteAtual.t.escala || 1} className="w-full"
                      onPointerDown={registrar}
                      onChange={(e) => aplicarParte((pt) => ({ ...pt, escala: Number(e.target.value) }), false)} />
                    <span className="flex gap-1.5">
                      {[-1, -0.1, 0.1, 1].map((d) => (
                        <button key={d} type="button" className="rounded-md btn-contorno px-2 py-0.5 text-xs hover:bg-superficie-2"
                          onClick={() => aplicarParte((pt) => ({ ...pt, escala: Math.min(1.25, Math.max(0.8, Math.round(((pt.escala || 1) + d / 100) * 1e4) / 1e4)) }))}>
                          {d > 0 ? "+" : "−"}{Math.abs(d).toString().replace(".", ",")}%
                        </button>
                      ))}
                    </span>
                  </label>
                  <p className="text-xs text-texto-2 leading-relaxed">
                    A parte desloca, gira e estica em volta do próprio centro. Em 100% os lotes mantêm a área medida;
                    esticada, a área dos lotes acompanha o desenho. Os lotes clicáveis dela andam junto ao salvar e mantêm a numeração.
                  </p>
                  <button onClick={() => removerParte(parteAtual.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg btn-contorno px-3 py-1.5 text-sm hover:bg-superficie-2 text-alerta">
                    <Trash2 className="size-4" /> Remover esta parte
                  </button>
                </div>
              )}

              {!parteAtual && <div className="space-y-3 min-w-56">
                <label className="block space-y-1">
                  <span className="text-sm text-texto-2">Giro: <strong className="text-texto">{t.rotacaoGraus.toFixed(3)}°</strong></span>
                  <input type="range" min={-2} max={2} step={0.001} value={t.rotacaoGraus} className="w-full"
                    onChange={(e) => aplicar({ ...t, rotacaoGraus: Number(e.target.value) }, false)} />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-texto-2">Escala: <strong className="text-texto">{(t.escala * 100).toFixed(2)}%</strong></span>
                  <input type="range" min={0.98} max={1.02} step={0.0001} value={t.escala} className="w-full"
                    onChange={(e) => aplicar({ ...t, escala: Number(e.target.value) }, false)} />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-texto-2">Opacidade da planta: <strong className="text-texto">{Math.round(opacidade * 100)}%</strong></span>
                  <input type="range" min={0.15} max={1} step={0.05} value={opacidade} className="w-full"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setOpacidade(v);
                      mapRef.current?.setPaintProperty("planta", "line-opacity", v);
                    }} />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-texto-2">Espessura das linhas: <strong className="text-texto">{espessura.toFixed(2).replace(".", ",")}×</strong></span>
                  <input type="range" min={0.5} max={4} step={0.25} value={espessura} className="w-full"
                    onChange={(e) => mudarEspessura(Number(e.target.value))} />
                  <span className="block text-xs text-texto-2">Vale também no mapa público depois de salvar.</span>
                </label>
              </div>}

              <div className="text-sm tabular-nums space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-texto-2">
                  {parteAtual ? `Ajuste de ${parteAtual.nome}` : "Ajuste aplicado"}
                </p>
                <p className="lp-display text-lg text-texto">
                  {parteAtual
                    ? `leste ${parteAtual.t.offsetLesteM.toFixed(1)} m · norte ${parteAtual.t.offsetNorteM.toFixed(1)} m`
                    : `leste ${t.offsetLesteM.toFixed(1)} m · norte ${t.offsetNorteM.toFixed(1)} m`}
                </p>
                {parteAtual && <p className="text-xs text-texto-2">em relação à planta inteira, que segue em leste {t.offsetLesteM.toFixed(1)} m · norte {t.offsetNorteM.toFixed(1)} m</p>}
                <p className="text-xs text-texto-2">
                  deslocamento total {deslocamentoTotal.toFixed(1)} m
                  {deslocamentoTotal > 40 && deslocamentoTotal < 90 && " — na faixa típica de erro de datum"}
                </p>
                {pares.length > 0 && (
                  <p className="text-xs text-texto-2">
                    {pares.length} par(es) de controle
                    {residuo != null && <> · erro médio <strong className="text-texto">{residuo.toFixed(2)} m</strong></>}
                  </p>
                )}
                {/* Desfazer e Salvar ficam na barra fixa do rodapé — ver lá embaixo */}
                {(pares.length > 0 || pendente) && (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setPares([]); setPendente(null); setResiduo(null); desenharPares([], null); }}
                      className="rounded-lg btn-contorno px-3 py-1.5 text-xs hover:bg-superficie-2 transition">
                      Limpar pontos
                    </button>
                  </div>
                )}
              </div>

              {modo === "pontos" && !parteAtual && (
                <div className="w-full rounded-2xl border border-linha bg-superficie-2 p-5 text-sm space-y-3">
                  <p className="font-semibold text-texto">Como calibrar por pontos de controle</p>
                  <ol className="list-decimal ml-5 text-texto-2 space-y-1 text-sm leading-relaxed">
                    <li>Clique num cruzamento bem visível <strong>na planta</strong> (linha amarela).</li>
                    <li>Clique no <strong>mesmo cruzamento no satélite</strong>. Isso fecha um par.</li>
                    <li>Repita num ponto distante — o segundo par é o que corrige giro e escala.</li>
                    <li>Clique em <strong>Aplicar pontos</strong>.</li>
                  </ol>
                  <button onClick={aplicarPontos} disabled={!pares.length}
                    className="btn-verde px-4 py-2 text-sm disabled:opacity-50">
                    Aplicar {pares.length || ""} {pares.length === 1 ? "par" : "pares"}
                  </button>
                </div>
              )}
            </div>
          )}

          {painelAberto && aba === "camadas" && (
            <div className="p-6 space-y-4">
              {layersCad.length === 0 ? (
                <p className="text-sm text-texto-2">
                  Esta planta foi publicada antes do diagnóstico por camada. Reenvie o DXF para poder
                  escolher o que vai ao mapa.
                </p>
              ) : (
                <>
                  <p className="text-sm text-texto-2">
                    Desmarque o que não é cadastro — vegetação, paisagismo, cotas. A planta fica limpa no mapa
                    e mais leve no celular, sem reenviar o arquivo.
                  </p>
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 max-h-64 overflow-auto pr-1">
                    {layersCad.map((l) => (
                      <label key={l.nome} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-superficie-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={!ocultos.has(l.nome)} onChange={() => alternarLayer(l.nome)} />
                        <span className="flex-1 truncate" title={l.nome}>{l.nome}</span>
                        <span className="text-xs text-texto-2 tabular-nums">{fmt(l.linhas)}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button className="rounded-lg btn-contorno px-3 py-1.5 text-xs hover:bg-superficie-2"
                      onClick={() => { const v = new Set<string>(); setOcultos(v); redesenhar(t, v); }}>
                      Mostrar todas
                    </button>
                    <button className="rounded-lg btn-contorno px-3 py-1.5 text-xs hover:bg-superficie-2"
                      onClick={() => {
                        const v = new Set(layersCad.filter((l) => l.linhas < 200).map((l) => l.nome));
                        setOcultos(v); redesenhar(t, v);
                      }}>
                      Esconder as menores (menos de 200 linhas)
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
