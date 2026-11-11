"use client";

/**
 * Mapa regional estilo Google Maps: base vetorial (CARTO Voyager) + satélite,
 * painel lateral de resultados com busca, hover sincronizado lista↔mapa,
 * tooltip ao passar o mouse, flyTo suave, cartografia urbana (raster e vetorial),
 * fullscreen, escala e localização do usuário.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap, MapLayerMouseEvent, GeoJSONSource, Popup, VectorTileSource } from "maplibre-gl";
import { CENTRO_REGIAO, SATELITE } from "@/lib/map/config";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { formatBRL, formatArea } from "@/lib/format";
import { transformarGeoJSON, centroDe, removerLinhasExcluidas, aplicarEdicoesGeoJSON, TRANSFORM_ZERO, type Transform, type AjusteLocal, type EdicaoGeometria } from "@/lib/geo/deslocar";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PainelImovel from "@/components/map/PainelImovel";
import { RADAR_ANEL, STATUS_MAPA } from "@/components/map/statusMapa";
import { PainelCamadas, Legenda, VIDRO, BotaoFechar } from "@/components/map/UiMapa";
import { ArrowRight, ChevronLeft, ChevronRight, CircleHelp, Crosshair, Ellipsis, Flag, History, ImageUp, Layers, Lock, MapPin, ScanSearch, Search } from "lucide-react";
import BuscaPorImagem from "@/components/map/BuscaPorImagem";
import MatriculaSigef from "@/components/rural/MatriculaSigef";
import Ferramentas from "@/components/map/Ferramentas";
import { guardarCarPendente } from "@/lib/map/carPendente";
import { CartaoLote, CartaoLotes, LOTES_MAX, LOTE_ZOOM_MIN, MEDIDA_ZOOM_MIN, ROTULO_ZOOM_MIN, type LoteInfo } from "@/components/map/lotes";
import ComparaImagens from "@/components/map/ComparaImagens";
import CenasCopernicus from "@/components/map/CenasCopernicus";
import { IMAGENS_HISTORICAS, imagemHistoricaPorId } from "@/lib/map/historico";
import { useTema } from "@/components/shell/BotaoTema";
import { usePreferencias } from "@/lib/usePreferencias";
import { escaparHtml } from "@/lib/seguranca/html";
import { GerenciadorCamadasOficiais, type EstadoCamada, type FeicaoNoPonto } from "@/components/map/camadasOficiaisMapa";
import { CAMADAS_OFICIAIS, camadaOficialPorId, descreverFeicao, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import { GerenciadorRelevo, type EstadoRelevo, type RelevoId } from "@/components/map/camadasRelevo";
import { FORMATOS_BUSCA, interpretarBusca } from "@/lib/map/buscaRural";
import BotaoCompartilharPonto, { MarcadorDaUrl } from "@/components/map/CompartilharPonto";
import CartaoPonto, { usePressaoLonga, type PontoLivre } from "@/components/map/CartaoPonto";

type ImovelProps = {
  id: string;
  codigo: string;
  titulo: string;
  tipo: "urbano" | "rural";
  modalidade?: "venda" | "leilao";
  status: string;
  valor: number | null;
  area_m2: number | null;
  lng: number;
  lat: number;
  municipio: string | null;
  capa: string | null;
};

type Camada = {
  id: string; nome: string; tipo: "raster" | "vector";
  tiles?: string; geojson?: string;
  min_zoom: number; max_zoom: number; opacidade: number;
  /** retângulo da planta em graus [oeste, sul, leste, norte]; null em planta antiga */
  bbox?: [number, number, number, number] | null;
  layers_ocultos?: string[];
  geojson_publico?: string;
  centro?: [number, number] | null;
  transform?: Transform;
  ajustes?: AjusteLocal[];
  /** linhas apagadas na calibração (só usadas se o arquivo público não veio) */
  linhas_excluidas?: string[];
  /** linhas corrigidas e divididas na calibração (idem: só sem o arquivo público) */
  edicoes?: EdicaoGeometria[];
  /** multiplicador da espessura das linhas, definido na calibração */
  espessura?: number;
};

/**
 * Cores da planta urbana sobre cada base.
 *
 * O traço é desenhado DUAS vezes: um contorno escuro embaixo e a linha clara em
 * cima. Com uma linha só, a divisa de lote sumia — sobre telhado de cerâmica
 * claro o amarelo some, e sobre asfalto o traço escuro some. O contorno garante
 * contraste contra os dois, que é como carta cadastral é impressa há décadas.
 */
/**
 * Cor da cartografia RURAL (malha do CAR). A urbana usa CARTO_CORES — amarelo
 * claro no satélite, verde-acinzentado no mapa. Laranja separa as duas à
 * primeira vista (pedido: "cores cartográficas distintas para urbano e rural").
 */
const COR_RURAL = "#FF9D3D";

/** A partir deste zoom a malha do CAR aparece (tiles vetoriais; de longe, só as áreas grandes). */
const CAR_ZOOM_MIN = 7;
/** Arquivo PMTiles com a malha nacional do CAR (scripts/car-nacional). Vazio = banco + SICAR sob demanda. */
const CAR_NACIONAL = process.env.NEXT_PUBLIC_CAR_NACIONAL_URL?.trim() || "";

type CarProps = {
  cod: string;
  area_ha: number | null;
  condicao: string | null;
  status: string | null;
  tipo: string | null;
  municipio: string | null;
};

const CAR_TIPO: Record<string, string> = {
  IRU: "Imóvel rural", AST: "Assentamento", PCT: "Povos e comunidades tradicionais",
};

/** Cartão do imóvel do CAR clicado: o atalho para o proprietário anunciar a área dele. */
/** O que as camadas oficiais ligadas têm no ponto clicado: uma linha por feição, com a cor da camada. */
function ListaOficiais({ itens }: { itens: FeicaoNoPonto[] }) {
  return (
    <ul className="space-y-2">
      {itens.slice(0, 12).map((f, i) => {
        const c = camadaOficialPorId(f.camada)!;
        const { titulo, detalhe } = descreverFeicao(f.camada, f.props);
        return (
          <li key={i} className="flex gap-2.5 rounded-xl border border-linha bg-superficie-2/60 px-3 py-2">
            <span className={"mt-1 inline-block size-2.5 shrink-0 " + (c.ponto ? "rounded-full" : "rounded-sm")} style={{ background: c.cor }} />
            <span className="min-w-0 text-sm leading-snug">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-2">{c.orgao} · {c.nome}</span>
              <span className="block font-semibold text-texto">{titulo}</span>
              {detalhe && <span className="block text-xs text-texto-2">{detalhe}</span>}
            </span>
          </li>
        );
      })}
      {itens.length > 12 && <li className="text-xs text-texto-2">e mais {itens.length - 12} no ponto clicado.</li>}
    </ul>
  );
}

/** Clique fora do CAR mas sobre camadas oficiais: o mesmo resumo, sem o cartão do imóvel. */
function CartaoOficiais({ itens, ponto, onFechar }: {
  itens: FeicaoNoPonto[]; ponto: { lng: number; lat: number; zoom: number } | null; onFechar: () => void;
}) {
  return (
    <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-10 w-80 max-w-[calc(100%-1.5rem)] max-h-[70%] overflow-y-auto p-5 space-y-3 ${VIDRO}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="lp-display text-2xl text-verde">Neste ponto</p>
        <BotaoFechar onClick={onFechar} />
      </div>
      <ListaOficiais itens={itens} />
      {ponto && <BotaoCompartilharPonto lng={ponto.lng} lat={ponto.lat} zoom={Math.max(ponto.zoom, 15)} />}
    </div>
  );
}

function CartaoCar({ car, onFechar, oficiais = [] }: { car: CarProps; onFechar: () => void; oficiais?: FeicaoNoPonto[] }) {
  const area = Number(car.area_ha);
  return (
    <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-10 w-80 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-5rem)] overflow-y-auto p-5 space-y-4 ${VIDRO}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="lp-eyebrow !text-[10px] !tracking-[0.2em] !text-ouro">{CAR_TIPO[car.tipo ?? ""] ?? "Imóvel rural"} · CAR</p>
          <p className="lp-display text-2xl text-verde mt-2">
            {Number.isFinite(area) && area > 0 ? formatArea(area * 10_000, "rural") : "Área não informada"}
          </p>
        </div>
        <BotaoFechar onClick={onFechar} />
      </div>
      <dl className="text-sm divide-y divide-linha rounded-xl border border-linha bg-superficie-2/60 px-3.5">
        <div className="flex justify-between gap-2 py-2.5"><dt className="text-texto-2">Município</dt><dd className="text-texto font-medium">{car.municipio ?? "—"}</dd></div>
        <div className="flex justify-between gap-2 py-2.5"><dt className="text-texto-2 shrink-0">Situação no CAR</dt><dd className="text-texto text-right">{car.condicao ?? "—"}</dd></div>
        <div className="py-2.5">
          <dt className="text-texto-2">Código do CAR</dt>
          <dd className="mt-0.5 font-mono text-[11px] text-texto break-all">{car.cod}</dd>
        </div>
      </dl>
      <MatriculaSigef cod={car.cod} compacto />
      {oficiais.length > 0 && (
        <div className="space-y-2">
          <p className="lp-eyebrow !text-[10px] !tracking-[0.2em] !text-ouro">Também neste ponto</p>
          <ListaOficiais itens={oficiais} />
        </div>
      )}
      <div className="space-y-2">
        <Link href={`/painel/novo?car=${encodeURIComponent(car.cod)}`} onClick={() => guardarCarPendente(car.cod)}
          className="btn-ouro flex w-full items-center justify-center gap-1.5 py-2.5 text-sm">
          Esta área é minha — anunciar <ArrowRight className="size-4" />
        </Link>
        <Link href={`/consulta/car/${encodeURIComponent(car.cod)}`}
          className="btn-contorno flex w-full items-center justify-center gap-1.5 py-2.5 text-sm">
          <ScanSearch className="size-4" /> Consultar informações
        </Link>
      </div>
      <Link href={`/cartografia/solicitar?referencia=${encodeURIComponent("car:" + car.cod)}&tipo=divergencia`}
        className="flex items-center justify-center gap-1.5 text-xs text-texto-2 hover:text-verde transition">
        <Flag className="size-3.5" /> O mapa está divergente desta área
      </Link>
      <p className="text-[11px] text-texto-2 leading-relaxed border-t border-linha pt-3">
        A divisa vem pronta do CAR. Para publicar, a Arini confere a matrícula do imóvel — o CAR é
        autodeclarado e não comprova propriedade.
      </p>
    </div>
  );
}

const CARTO_CORES = {
  satelite: { linha: "#FFE299", contorno: "#1A1204" },
  ruas: { linha: "#8FB3A1", contorno: "#05100C" },
} as const;

/** espessura por zoom: fina na visão da cidade, cheia no zoom do lote */
const CARTO_LARGURA = ["interpolate", ["linear"], ["zoom"], 12, 0.5, 15, 1.1, 17, 1.8, 19, 2.6];
const CARTO_CONTORNO = ["interpolate", ["linear"], ["zoom"], 12, 1.4, 15, 2.4, 17, 3.4, 19, 4.6];
/** Espessura da planta × o multiplicador da calibração (áudio do Carlos, 05/11). */
const comEspessura = (expr: (string | number | string[])[], k = 1) =>
  k === 1 ? expr : expr.map((v, i) => (i >= 4 && i % 2 === 0 && typeof v === "number" ? Math.round(v * k * 100) / 100 : v));

// a base vetorial acompanha o tema: dark-matter no escuro, positron no claro
const ESTILO_RUAS = {
  escuro: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  claro: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

/**
 * Hash da URL no momento em que o último mapa foi desmontado. O remove() do
 * MapLibre apaga o #pos=…; se o componente remonta em seguida (Strict Mode,
 * navegação client-side vinda da home), o mapa novo reabre nesta posição.
 */
let hashDaSaida: { hash: string; quando: number } | null = null;

/** Abaixo deste zoom o imóvel aparece como marcador; acima, pela divisa. */
const ZOOM_MARCADOR = 12.5;

/** Um ponto no centro de cada imóvel, com as mesmas propriedades. */
function centrosDe(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features
      .filter((f) => Number.isFinite((f.properties as { lng?: number })?.lng))
      .map((f) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [(f.properties as { lng: number }).lng, (f.properties as { lat: number }).lat] },
        properties: f.properties,
      })),
  };
}

const CORES_MATCH: unknown[] = [
  // `cor` vem do banco: é o status, ou "leilao" para leilão ainda disponível
  "match", ["coalesce", ["get", "cor"], ["get", "status"]],
  "leilao", STATUS_MAPA.leilao,
  "publicado", STATUS_MAPA.publicado,
  "em_negociacao", STATUS_MAPA.em_negociacao,
  "vendido", STATUS_MAPA.vendido,
  "#6FB08F",
];

const FAIXAS_PRECO: { label: string; min: number; max: number | null }[] = [
  { label: "Qualquer preço", min: 0, max: null },
  { label: "Até R$ 500 mil", min: 0, max: 500_000 },
  { label: "R$ 500 mil – 1 mi", min: 500_000, max: 1_000_000 },
  { label: "R$ 1 – 3 mi", min: 1_000_000, max: 3_000_000 },
  { label: "Acima de R$ 3 mi", min: 3_000_000, max: null },
];

function mediaUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function MapaRegional({
  recursos, logado = false, versaoLotes = "",
}: {
  /** recursos do plano de quem está olhando (planos por nicho); ausente = tudo liberado */
  recursos?: string[];
  logado?: boolean;
  /**
   * Muda quando os lotes de alguma planta são gerados de novo (recalibração):
   * vai no endereço do tile, então navegador, servidor e Cloudflare buscam o novo.
   */
  versaoLotes?: string;
} = {}) {
  const tema = useTema();
  const router = useRouter();
  const liberado = (r: string) => !recursos || recursos.includes(r);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const dadosRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const municipiosRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  const cartoVetorIdsRef = useRef<string[]>([]);
  // plantas urbanas conhecidas mas ainda não baixadas, e as que já entraram
  const plantasRef = useRef<Camada[]>([]);
  const plantasCarregadasRef = useRef<Set<string>>(new Set());
  const baseRef = useRef<"ruas" | "satelite">("satelite");
  // malha do CAR: se a camada está ligada
  const carAtivoRef = useRef(true);
  const carHoverRef = useRef<string | null>(null);

  // satélite é a base de abertura (pedido do Carlos em 01/10/2026); "Mapa" vira opção
  const [base, setBase] = useState<"ruas" | "satelite">("satelite");
  const [selecionado, setSelecionado] = useState<ImovelProps | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "urbano" | "rural" | "leilao">("todos");
  const [faixaPreco, setFaixaPreco] = useState(0);
  const [busca, setBusca] = useState("");
  // busca limpa depois de ir até uma coordenada: o anel dourado fica no mapa
  const manterPontoBuscaRef = useRef(false);
  // no celular o mapa é o protagonista: a lista começa fechada e vira gaveta
  const [painelAberto, setPainelAberto] = useState(true);
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) setPainelAberto(false);
  }, []);
  const [raio, setRaio] = useState(5000);
  const [camadasAbertas, setCamadasAbertas] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [lista, setLista] = useState<ImovelProps[]>([]);
  const [mapaPronto, setMapaPronto] = useState<MLMap | null>(null);
  const [carAtivo, setCarAtivo] = useState(true);
  // 5.10: base do mapa e camada do CAR vêm das preferências da conta (ou do navegador)
  // e cada troca fica lembrada. Aplicadas uma vez, quando chegam do servidor.
  const { prefs, carregado: prefsCarregadas, salvar: salvarPrefs } = usePreferencias();
  const prefsAplicadasRef = useRef(false);
  useEffect(() => {
    if (!prefsCarregadas || prefsAplicadasRef.current) return;
    prefsAplicadasRef.current = true;
    setBase(prefs.mapa_base === "mapa" ? "ruas" : "satelite");
    setCarAtivo(prefs.camada_car);
  }, [prefsCarregadas, prefs.mapa_base, prefs.camada_car]);
  const [carSel, setCarSel] = useState<CarProps | null>(null);
  // camadas oficiais (SIGEF, embargos, ANM…): ligadas no painel, pedidas por janela
  const camadasRef = useRef<GerenciadorCamadasOficiais | null>(null);
  const [camadasAtivas, setCamadasAtivas] = useState<Set<CamadaOficialId>>(new Set());
  const camadasAtivasRef = useRef(camadasAtivas);
  const [estadoCamadas, setEstadoCamadas] = useState<Partial<Record<CamadaOficialId, EstadoCamada>>>({});
  const [noPonto, setNoPonto] = useState<FeicaoNoPonto[]>([]);
  // onde foi o último clique: o cartão "Neste ponto" oferece compartilhar esse ponto
  const [pontoClicado, setPontoClicado] = useState<{ lng: number; lat: number; zoom: number } | null>(null);
  // pressão longa / botão direito em qualquer ponto: cartão mínimo "Neste ponto" (QA 09/11)
  const [pontoLivre, setPontoLivre] = useState<PontoLivre | null>(null);
  const alternarCamada = useCallback((id: CamadaOficialId) => {
    const nova = new Set(camadasAtivasRef.current);
    if (nova.has(id)) nova.delete(id); else nova.add(id);
    camadasAtivasRef.current = nova;
    camadasRef.current?.alternar(id, nova.has(id));
    setCamadasAtivas(nova);
  }, []);
  // relevo e água (itens 3 e 21 da segunda etapa): dados abertos, para qualquer plano
  const relevoRef = useRef<GerenciadorRelevo | null>(null);
  const [relevoAtivas, setRelevoAtivas] = useState<Set<RelevoId>>(new Set());
  const relevoAtivasRef = useRef(relevoAtivas);
  const [estadoRelevo, setEstadoRelevo] = useState<EstadoRelevo>({});
  const alternarRelevo = useCallback((id: RelevoId) => {
    const nova = new Set(relevoAtivasRef.current);
    if (nova.has(id)) nova.delete(id); else nova.add(id);
    relevoAtivasRef.current = nova;
    relevoRef.current?.alternar(id, nova.has(id));
    setRelevoAtivas(nova);
  }, []);
  // camadas da base CARTO (as do tema): o resto é nosso e atravessa a troca de tema
  const baseEstiloRef = useRef<{ fontes: Set<string>; camadas: Set<string> } | null>(null);
  const temaAplicadoRef = useRef(tema);
  const [carAviso, setCarAviso] = useState("");
  // barra de chips: menu "Mais" (celular) e a altura medida, para os painéis abrirem logo abaixo
  const [maisAberto, setMaisAberto] = useState(false);
  const chipsRef = useRef<HTMLDivElement>(null);
  const areaMapaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const barra = chipsRef.current, area = areaMapaRef.current;
    if (!barra || !area) return;
    const medir = () => area.style.setProperty("--abaixo-chips", `${barra.offsetHeight + 20}px`);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(barra);
    return () => obs.disconnect();
  }, []);
  // posição de entrada (#pos=…), lida UMA vez no primeiro mount: o remove() do
  // MapLibre apaga o hash, e no remount (Strict Mode em dev, navegação vinda da
  // home) o segundo mapa nascia na visão padrão em vez do município clicado
  const hashEntradaRef = useRef<string | null>(null);
  // lotes urbanos: o lote sob o cursor e o clicado
  const loteHoverRef = useRef<string | null>(null);
  const [loteSel, setLoteSel] = useState<LoteInfo | null>(null);
  // seleção de vários lotes (loteamento): null = desligada; o ref serve ao clique do mapa
  const [varios, setVarios] = useState<LoteInfo[] | null>(null);
  const variosRef = useRef<LoteInfo[] | null>(null);
  const [avisoVarios, setAvisoVarios] = useState("");
  const mudarVarios = useCallback((lista: LoteInfo[] | null) => {
    const map = mapRef.current;
    if (map?.getSource("lotes")) {
      map.removeFeatureState({ source: "lotes", sourceLayer: "lotes" });
      for (const l of lista ?? []) map.setFeatureState({ source: "lotes", sourceLayer: "lotes", id: l.id }, { sel: true });
    }
    variosRef.current = lista;
    setVarios(lista);
  }, []);
  // Planta completa do CAD: desligada por padrão. Pedido do Carlos em 01/10/2026
  // ("lapidar o mapa: tirar círculos, setas, nomes de rua, deixar só o essencial").
  // O essencial — a divisa de cada lote e as metragens — vem da camada de lotes,
  // que é limpa por construção e pesa ~1 MB na tela, contra 14 MB da planta.
  const [plantaAtiva, setPlantaAtiva] = useState(false);
  const plantaAtivaRef = useRef(false);
  // desenho em curso (medir / consultar área): o clique é vértice, não abre cartão
  const desenhandoRef = useRef(false);
  const aoDesenhar = useCallback((ativo: boolean) => { desenhandoRef.current = ativo; }, []);
  // Imagem do ano (roadmap 3.8): satélite histórico no lugar do atual, ou lado a lado
  const [imagemAno, setImagemAno] = useState<string | null>(null);
  const [comparar, setComparar] = useState(false);
  const [seletorAno, setSeletorAno] = useState(false);
  // busca por imagem (Revisão do Carlos, 29/10)
  const [buscaImagem, setBuscaImagem] = useState(false);
  const buscaInputRef = useRef<HTMLInputElement>(null);
  const [avisoPlano, setAvisoPlano] = useState("");
  const imagemAnoRef = useRef<string | null>(null);
  const compararRef = useRef(false);

  /**
   * Põe (ou tira) a imagem do ano logo acima do satélite atual, abaixo de toda
   * a cartografia e dos dados. No modo comparar ela sai daqui: quem mostra é o
   * mapa de cima (ComparaImagens), recortado pela cortina.
   */
  const aplicarHistorico = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("satelite")) return;
    if (map.getLayer("historico")) map.removeLayer("historico");
    if (map.getSource("historico")) map.removeSource("historico");
    const img = imagemHistoricaPorId(imagemAnoRef.current);
    if (!img || compararRef.current) return;
    const camadas = map.getStyle().layers;
    const depois = camadas[camadas.findIndex((l) => l.id === "satelite") + 1]?.id;
    map.addSource("historico", img.fonte);
    map.addLayer({ id: "historico", type: "raster", source: "historico" }, depois);
  }, []);

  /**
   * CAR e lotes chegam como TILES VETORIAIS gerados no banco (migration 0031):
   * o MapLibre pede só os tiles da tela, guarda em cache e desenha na GPU. Não
   * há mais GeoJSON inteiro a cada movimento nem metragens recalculadas aqui —
   * as etiquetas dos lados vêm prontas no próprio tile (camada `medidas`).
   * Única coisa que resta ao código: avisar quando a malha do CAR ainda não
   * entra (abaixo do zoom 7, longe demais para qualquer divisa fazer sentido)
   * ou entra só com as áreas grandes.
   */
  const conferirZoomCar = useCallback(() => {
    const map = mapRef.current;
    if (!map || !carAtivoRef.current) { setCarAviso(""); return; }
    const z = map.getZoom();
    setCarAviso(
      z < CAR_ZOOM_MIN ? "Aproxime o mapa para ver os imóveis rurais do CAR."
        // com o arquivo nacional as faixas vão até o z12 (scripts/car-nacional/gerar.mjs)
        : z < (CAR_NACIONAL ? 12 : 11) ? "De longe, só as áreas maiores do CAR aparecem. Aproxime para ver todas."
        : ""
    );
  }, []);

  /**
   * CAR sob demanda (08/10/2026): fora da base regional, ao parar num zoom
   * ≥ 11 o mapa pede ao servidor o CAR da janela (POST /api/car/janela), que
   * busca no SICAR o que faltar e grava. Se entrou imóvel novo, troca a URL
   * dos tiles do CAR (`?v=`) para o MapLibre pedir de novo a área.
   * As células z11 já pedidas nesta visita não são pedidas outra vez.
   */
  const carCelulasPedidasRef = useRef(new Set<string>());
  const carTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const garantirCarSobDemanda = useCallback(() => {
    if (carTimerRef.current) clearTimeout(carTimerRef.current);
    carTimerRef.current = setTimeout(async () => {
      const map = mapRef.current;
      if (!map || !carAtivoRef.current || CAR_NACIONAL || map.getZoom() < 11) return;
      const b = map.getBounds();
      const n = 2 ** 11;
      const cx = (lng: number) => Math.floor(((lng + 180) / 360) * n);
      const cy = (lat: number) => {
        const r = (lat * Math.PI) / 180;
        return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
      };
      const celulas: string[] = [];
      for (let x = cx(b.getWest()); x <= cx(b.getEast()); x++)
        for (let y = cy(b.getNorth()); y <= cy(b.getSouth()); y++) celulas.push(`${x}/${y}`);
      if (celulas.every((c) => carCelulasPedidasRef.current.has(c))) return;
      celulas.forEach((c) => carCelulasPedidasRef.current.add(c));

      const aviso = setTimeout(() => setCarAviso("Buscando no SICAR os imóveis rurais desta região…"), 600);
      try {
        const r = await fetch("/api/car/janela", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth() }),
        });
        const j = await r.json().catch(() => null) as { imoveis?: number; longe?: boolean } | null;
        // erro, ou janela grande demais (`longe`, monitor grande no z11): as
        // células não foram buscadas — desmarca para pedir de novo ao aproximar
        if (!r.ok || j?.longe) celulas.forEach((c) => carCelulasPedidasRef.current.delete(c));
        if (j?.imoveis && mapRef.current) {
          const fonte = mapRef.current.getSource("car") as VectorTileSource | undefined;
          fonte?.setTiles([`${window.location.origin}/api/tiles/car/{z}/{x}/{y}.pbf?v=${Date.now()}`]);
        }
      } catch {
        celulas.forEach((c) => carCelulasPedidasRef.current.delete(c));
      } finally {
        clearTimeout(aviso);
        conferirZoomCar();
      }
    }, 700);
  }, [conferirZoomCar]);

  /**
   * Baixa e desenha as plantas urbanas que a tela está pedindo — e só essas.
   *
   * POR QUE ISSO EXISTE. Antes, abrir /mapa baixava as três plantas do piloto
   * (22 MB, sendo 19 MB só de Iturama) dentro do `load`, em série, antes de
   * desenhar imóvel nenhum. Na visão regional, em z9, nenhuma delas chega a ser
   * desenhada: a planta só entra a partir do zoom da cidade. Eram 22 MB para
   * mostrar zero linha — invisível na fibra daqui, meio minuto num 4G do
   * Pontal, que é onde o corretor de fato abre o mapa.
   *
   * Agora a planta é buscada quando as DUAS coisas valem: o zoom passou do
   * mínimo da camada e o retângulo dela encosta na tela. Cada uma entra uma vez
   * só (`plantasCarregadasRef`); planta antiga sem `bbox` entra pelo zoom, como
   * antes, em vez de ser descartada por um retângulo que não existe.
   */
  const garantirPlantas = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !plantasRef.current.length || !plantaAtivaRef.current) return;

    const z = map.getZoom();
    const tela = map.getBounds();
    const pendentes = plantasRef.current.filter((c) => {
      if (plantasCarregadasRef.current.has(c.id)) return false;
      if (z < c.min_zoom) return false;
      if (!c.bbox) return true;
      const [x0, y0, x1, y1] = c.bbox;
      return !(x1 < tela.getWest() || x0 > tela.getEast() || y1 < tela.getSouth() || y0 > tela.getNorth());
    });
    if (!pendentes.length) return;

    // marca antes de buscar: `moveend` dispara de novo enquanto o arquivo vem
    for (const c of pendentes) plantasCarregadasRef.current.add(c.id);

    await Promise.all(pendentes.map(async (c) => {
      // versão já filtrada no servidor quando existe; o centro gravado é o do
      // arquivo completo, o mesmo que a calibração usou para girar e escalar
      const bruto = await fetch(c.geojson_publico ?? c.geojson!).then((r) => r.json()).catch(() => null);
      if (!bruto || !mapRef.current || mapRef.current.getSource(`carto-${c.id}`)) {
        if (!bruto) plantasCarregadasRef.current.delete(c.id); // deixa tentar de novo
        return;
      }
      // calibração: giro, escala e deslocamento em torno do centro da planta,
      // mais as camadas de CAD que o operador escondeu
      // sem o arquivo público, o original ainda tem as linhas apagadas: tira aqui
      // (o centro continua o do arquivo completo, medido antes de apagar)
      const centro = c.centro ?? centroDe(bruto);
      // as correções de linha vêm antes das apagadas: um pedaço de linha dividida
      // só existe depois delas, e a chave "i:j" dele conta com isso
      const editado = !c.geojson_publico && c.edicoes?.length ? aplicarEdicoesGeoJSON(bruto, c.edicoes) : bruto;
      const semApagadas = !c.geojson_publico && c.linhas_excluidas?.length ? removerLinhasExcluidas(editado, c.linhas_excluidas) : editado;
      const dados = transformarGeoJSON(
        semApagadas, centro, c.transform ?? TRANSFORM_ZERO, c.layers_ocultos ?? [], c.ajustes ?? []
      );
      const m = mapRef.current;
      const cores = CARTO_CORES[baseRef.current];
      // abaixo das divisas de município e dos imóveis: a planta é fundo, não dado
      const antesDe = m.getLayer("municipios-linha") ? "municipios-linha" : undefined;
      m.addSource(`carto-${c.id}`, { type: "geojson", data: dados });
      m.addLayer({
        id: `carto-${c.id}-contorno`, type: "line", source: `carto-${c.id}`,
        minzoom: c.min_zoom,
        paint: {
          "line-color": cores.contorno,
          "line-width": comEspessura(CARTO_CONTORNO, c.espessura) as never,
          "line-opacity": 0.45,
        },
      }, antesDe);
      m.addLayer({
        id: `carto-${c.id}`, type: "line", source: `carto-${c.id}`,
        minzoom: c.min_zoom,
        paint: {
          "line-color": cores.linha,
          "line-width": comEspessura(CARTO_LARGURA, c.espessura) as never,
          "line-opacity": Math.min(0.95, c.opacidade),
        },
      }, antesDe);
      cartoVetorIdsRef.current.push(`carto-${c.id}`, `carto-${c.id}-contorno`);
    }));
  }, []);

  // ---------- filtro compartilhado (lista + mapa) ----------
  const filtrar = useCallback((tipo: string, faixaIdx: number, q: string) => {
    const dados = dadosRef.current;
    if (!dados) return [] as GeoJSON.Feature[];
    const faixa = FAIXAS_PRECO[faixaIdx];
    const termo = norm(q.trim());
    return dados.features.filter((f) => {
      const p = f.properties as ImovelProps;
      if (tipo === "leilao") { if (p.modalidade !== "leilao") return false; }
      else if (tipo !== "todos" && p.tipo !== tipo) return false;
      if (p.valor != null) {
        if (p.valor < faixa.min) return false;
        if (faixa.max != null && p.valor > faixa.max) return false;
      } else if (faixaIdx !== 0) return false;
      if (termo) {
        const alvo = norm(`${p.titulo} ${p.codigo} ${p.municipio ?? ""}`);
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, []);

  const aplicar = useCallback((tipo: string, faixaIdx: number, q: string) => {
    const map = mapRef.current;
    const features = filtrar(tipo, faixaIdx, q);
    if (map?.getSource("imoveis")) {
      (map.getSource("imoveis") as GeoJSONSource).setData({ type: "FeatureCollection", features });
      (map.getSource("imoveis-centros") as GeoJSONSource | undefined)?.setData(centrosDe(features));
    }
    setLista(
      features
        .map((f) => f.properties as ImovelProps)
        .sort((a, b) => (a.status === "vendido" ? 1 : 0) - (b.status === "vendido" ? 1 : 0))
    );
  }, [filtrar]);

  const voarPara = useCallback((p: ImovelProps) => {
    setSelecionado(p);
    mapRef.current?.flyTo({
      center: [p.lng, p.lat],
      zoom: p.tipo === "urbano" ? 16.5 : 13.8,
      pitch: 0,
      duration: 1400,
      essential: true,
    });
  }, []);

  const destacar = useCallback((id: string | null) => {
    const map = mapRef.current;
    if (!map || !map.getSource("imoveis")) return;
    if (hoverIdRef.current && hoverIdRef.current !== id) {
      map.setFeatureState({ source: "imoveis", id: hoverIdRef.current }, { hover: false });
    }
    if (id) map.setFeatureState({ source: "imoveis", id }, { hover: true });
    hoverIdRef.current = id;
  }, []);

  // ---------- criação do mapa ----------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelado = false;
    let mapa: MLMap | undefined;

    // remount logo depois de um remove() (mesma página): o hash que valia é o guardado na saída
    const recente = hashDaSaida && Date.now() - hashDaSaida.quando < 3000 ? hashDaSaida.hash : "";
    hashEntradaRef.current ??= window.location.hash.includes("pos=") ? window.location.hash : recente || window.location.hash;
    const entrada = hashEntradaRef.current;
    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado || !containerRef.current) return;
      // o mapa anterior (remount) pode ter apagado o hash: devolve o de entrada
      // antes de criar, para o MapLibre abrir nele
      if (entrada.includes("pos=") && !window.location.hash.includes("pos=")) {
        history.replaceState(history.state, "", window.location.pathname + window.location.search + entrada);
      }
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: ESTILO_RUAS[tema],
        center: CENTRO_REGIAO,
        zoom: 9,
        // abaixo do zoom 4 o satélite pede dezenas de tiles do mundo inteiro e
        // o mapa parece "quebrado" enquanto carrega; o produto é o Brasil
        minZoom: 4,
        maxBounds: [[-80, -38], [-28, 9]],
        hash: "pos", // posição na URL → link compartilhável, estilo Google Maps
        fadeDuration: 150,
        // v5 moveu as opções de WebGL para cá; sem isto "Capturar Imagem" sai em branco
        canvasContextAttributes: { preserveDrawingBuffer: true },
        attributionControl: { compact: true },
      });
      mapa = map;
      mapRef.current = map;
      // em desenvolvimento, o mapa fica acessível no console (window.__mapa) para depurar camadas
      if (process.env.NODE_ENV !== "production") (window as unknown as { __mapa?: MLMap }).__mapa = map;
      setMapaPronto(map);
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new maplibregl.FullscreenControl(), "top-right");
      map.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

      const popup = new maplibregl.Popup({
        closeButton: false, closeOnClick: false, offset: 14, maxWidth: "260px",
      });
      popupRef.current = popup;

      map.on("load", async () => {
        // o que veio do estilo da CARTO; tudo o que entrar depois é nosso (troca de tema)
        const estilo = map.getStyle();
        baseEstiloRef.current = { fontes: new Set(Object.keys(estilo.sources)), camadas: new Set(estilo.layers.map((l) => l.id)) };
        temaAplicadoRef.current = tema;
        const [municipios, imoveis, cartografia] = await Promise.all([
          fetch("/api/geo/municipios").then((r) => r.json()),
          fetch("/api/geo/imoveis").then((r) => r.json()),
          fetch("/api/geo/cartografia").then((r) => r.json()).catch(() => []),
        ]);
        dadosRef.current = imoveis;
        municipiosRef.current = municipios;

        // satélite fica acima da base vetorial e abaixo das camadas de dados
        map.addSource("satelite", SATELITE);
        map.addLayer({ id: "satelite", type: "raster", source: "satelite", layout: { visibility: baseRef.current === "satelite" ? "visible" : "none" } });
        aplicarHistorico();

        // Cartografia urbana. O raster entra agora — tile só é baixado quando
        // aparece na tela, o MapLibre cuida disso. A planta VETORIAL é um
        // arquivo único e grande (Iturama tem 19 MB), então ela fica guardada
        // aqui e só é buscada quando a cidade entra na tela no zoom de lote —
        // ver `garantirPlantas`, chamada no fim da carga e a cada movimento.
        plantasRef.current = (cartografia as Camada[]).filter((c) => c.tipo === "vector" && c.geojson);
        for (const c of cartografia as Camada[]) {
          if (c.tipo === "raster" && c.tiles) {
            map.addSource(`carto-${c.id}`, {
              type: "raster", tiles: [c.tiles], tileSize: 256,
              minzoom: c.min_zoom, maxzoom: c.max_zoom,
            });
            map.addLayer({
              id: `carto-${c.id}`, type: "raster", source: `carto-${c.id}`,
              paint: { "raster-opacity": c.opacidade },
            });
          }
        }

        map.addSource("municipios", { type: "geojson", data: municipios });
        map.addLayer({
          id: "municipios-linha", type: "line", source: "municipios",
          paint: { "line-color": "#6FB08F", "line-width": 1.2, "line-opacity": 0.35, "line-dasharray": [3, 2] },
        });

        // Lotes urbanos clicáveis (pedido do Carlos, 01/10/2026). O preenchimento
        // é invisível: quem desenha a divisa é a planta; o lote só "acende" sob
        // o cursor e quando é clicado.
        const origem = window.location.origin;
        map.addSource("lotes", {
          type: "vector", tiles: [`${origem}/api/tiles/lotes/{z}/{x}/{y}.pbf${versaoLotes ? `?v=${versaoLotes}` : ""}`],
          minzoom: LOTE_ZOOM_MIN, maxzoom: 17, promoteId: { lotes: "id" },
        });
        map.addLayer({
          id: "lotes-fill", type: "fill", source: "lotes", "source-layer": "lotes", minzoom: LOTE_ZOOM_MIN,
          paint: {
            "fill-color": "#FFE299",
            "fill-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 0.42,
              ["boolean", ["feature-state", "hover"], false], 0.25, 0.01] as never,
          },
        });
        map.addLayer({
          id: "lotes-borda", type: "line", source: "lotes", "source-layer": "lotes", minzoom: LOTE_ZOOM_MIN,
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "sel"], false], "#D9BD6F", CARTO_CORES[baseRef.current].linha] as never,
            // o zoom só pode ser a entrada do interpolate mais externo; o estado
            // (clicado / sob o cursor) entra dentro de cada parada
            "line-width": ["interpolate", ["linear"], ["zoom"],
              15, ["case", ["boolean", ["feature-state", "sel"], false], 3, ["boolean", ["feature-state", "hover"], false], 2.4, 0.5],
              17, ["case", ["boolean", ["feature-state", "sel"], false], 3, ["boolean", ["feature-state", "hover"], false], 2.4, 1.1],
              19, ["case", ["boolean", ["feature-state", "sel"], false], 3.5, ["boolean", ["feature-state", "hover"], false], 3, 2]] as never,
            "line-opacity": 0.95,
          },
        });
        // contorno escuro por baixo: a divisa clara some sobre telhado claro
        map.addLayer({
          id: "lotes-contorno", type: "line", source: "lotes", "source-layer": "lotes", minzoom: LOTE_ZOOM_MIN,
          paint: {
            "line-color": CARTO_CORES[baseRef.current].contorno,
            "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1.3, 17, 2.6, 19, 4] as never,
            "line-opacity": 0.45,
          },
        }, "lotes-borda");
        map.addLayer({
          id: "lotes-medidas", type: "symbol", source: "lotes", "source-layer": "medidas", minzoom: MEDIDA_ZOOM_MIN,
          layout: {
            "text-field": ["get", "m"],
            "text-font": ["Open Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 18, 9.5, 20, 13],
            "text-rotate": ["get", "ang"],
            "text-rotation-alignment": "map",
            "text-padding": 1,
          },
          paint: { "text-color": "#FFFFFF", "text-halo-color": "rgba(10,19,16,0.9)", "text-halo-width": 1.4 },
        });
        // quadra e número do lote, lidos dos textos da planta (roadmap 2.11). Vem
        // depois das medidas para ganhar a disputa de espaço: o número importa mais.
        map.addLayer({
          id: "lotes-rotulos", type: "symbol", source: "lotes", "source-layer": "rotulos", minzoom: ROTULO_ZOOM_MIN,
          layout: {
            "text-field": ["case",
              ["all", ["has", "numero"], ["has", "quadra"]],
              ["format", ["get", "numero"], {}, "\nQd ", { "font-scale": 0.72 }, ["get", "quadra"], { "font-scale": 0.72 }],
              ["has", "numero"], ["get", "numero"],
              ["concat", "Qd ", ["get", "quadra"]]] as never,
            "text-font": ["Open Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 18, 12, 20, 16],
            "text-padding": 2,
          },
          paint: { "text-color": "#D9BD6F", "text-halo-color": "rgba(10,34,25,0.92)", "text-halo-width": 1.6 },
        });

        // malha do CAR: abaixo dos anúncios (quem está à venda fica por cima).
        // Com o arquivo nacional publicado (NEXT_PUBLIC_CAR_NACIONAL_URL), o
        // Brasil inteiro vem dele, pronto e servido pela CDN; sem ele, do
        // banco (base regional + busca no SICAR sob demanda).
        map.addSource("car", CAR_NACIONAL
          ? {
              type: "vector", url: `pmtiles://${CAR_NACIONAL.startsWith("/") ? origem + CAR_NACIONAL : CAR_NACIONAL}`,
              promoteId: { car: "cod" },
            }
          : {
              type: "vector", tiles: [`${origem}/api/tiles/car/{z}/{x}/{y}.pbf`],
              minzoom: CAR_ZOOM_MIN, maxzoom: 13, promoteId: { car: "cod" },
            });
        map.addLayer({
          id: "car-fill", type: "fill", source: "car", "source-layer": "car", minzoom: CAR_ZOOM_MIN,
          paint: {
            "fill-color": COR_RURAL,
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.25, 0.04] as never,
          },
        });
        // o traço afina conforme afasta: de longe a malha vira textura, de perto vira divisa
        map.addLayer({
          id: "car-linha", type: "line", source: "car", "source-layer": "car", minzoom: CAR_ZOOM_MIN,
          paint: {
            "line-color": COR_RURAL,
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.25, 10, 0.5, 12, 0.9, 15, 1.6] as never,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.45, 10, 0.65, 12, 0.8] as never,
          },
        });

        map.addSource("imoveis", { type: "geojson", data: imoveis, promoteId: "id" });
        map.addLayer({
          id: "imoveis-fill", type: "fill", source: "imoveis",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": CORES_MATCH as never,
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.55, 0.32] as never,
          },
        });
        map.addLayer({
          id: "imoveis-linha", type: "line", source: "imoveis",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "line-color": CORES_MATCH as never,
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4.5, 2.5] as never,
          },
        });
        map.addLayer({
          id: "imoveis-ponto", type: "circle", source: "imoveis",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": CORES_MATCH as never,
            "circle-radius": ["case", ["boolean", ["feature-state", "hover"], false], 7, 5] as never,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": RADAR_ANEL,
          },
        });

        // Visão regional: afastando o zoom, o polígono de um lote vira menos de
        // um pixel e o imóvel "some" do mapa — queixa do Carlos em 01/10/2026.
        // Abaixo do zoom em que a divisa aparece, cada imóvel vira um marcador
        // no centro dele, na cor do status.
        map.addSource("imoveis-centros", { type: "geojson", data: centrosDe(imoveis.features ?? []) });
        // Radar do manual (prancha 09): o pino é um ponto com anel Oliva em volta
        // (em tamanho pequeno vale só anel + ponto, sem as tarjas).
        map.addLayer({
          id: "imoveis-marcador-anel", type: "circle", source: "imoveis-centros", maxzoom: ZOOM_MARCADOR,
          paint: {
            "circle-color": "rgba(0,0,0,0)",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6.5, 9, 8, 12, 10] as never,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": RADAR_ANEL,
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0.95, 12.5, 0.3] as never,
          },
        });
        map.addLayer({
          id: "imoveis-marcador", type: "circle", source: "imoveis-centros", maxzoom: ZOOM_MARCADOR,
          paint: {
            "circle-color": CORES_MATCH as never,
            // pequeno (pedido do Stenio em 08/10: os pontos cobriam a divisa e a
            // cidade); some aos poucos perto do zoom em que a divisa já aparece
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3, 9, 4, 12, 5] as never,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#F2F2EC",
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 1, 12.5, 0.35] as never,
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 1, 12.5, 0.35] as never,
          },
        });

        // enquadra a região
        const coords: [number, number][] = [];
        for (const f of municipios.features ?? []) {
          const walk = (c: unknown): void => {
            if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
            else if (Array.isArray(c)) c.forEach(walk);
          };
          walk(f.geometry?.coordinates);
        }
        // respeita posição vinda da URL (#pos=…); sem ela, enquadra a região. Lê o
        // hash de ENTRADA: o MapLibre já gravou #pos=9/… sozinho antes daqui
        if (coords.length && !entrada.includes("pos=")) {
          const lngs = coords.map((c) => c[0]);
          const lats = coords.map((c) => c[1]);
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: { top: 40, bottom: 40, left: 380, right: 40 }, duration: 0 }
          );
        }

        // interações
        const aoClicar = (e: MapLayerMouseEvent) => {
          if (desenhandoRef.current) return;
          const f = e.features?.[0];
          if (f) voarPara(f.properties as unknown as ImovelProps);
        };
        const aoMover = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as unknown as ImovelProps;
          map.getCanvas().style.cursor = "pointer";
          destacar(p.id);
          popup
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="padding:10px 14px;font-family:inherit;border-top:2px solid #D9BD6F">
                 <p style="font-weight:600;font-size:13px;color:var(--texto);margin:0">${escaparHtml(p.titulo)}</p>
                 <p style="font-size:12px;color:var(--verde);font-weight:700;margin:2px 0 0">${escaparHtml(formatBRL(p.valor))}</p>
               </div>`
            )
            .addTo(map);
        };
        const aoSair = () => {
          map.getCanvas().style.cursor = "";
          destacar(null);
          popup.remove();
        };
        for (const layer of ["imoveis-fill", "imoveis-ponto", "imoveis-marcador"]) {
          map.on("click", layer, aoClicar);
          map.on("mousemove", layer, aoMover);
          map.on("mouseleave", layer, aoSair);
        }

        // CAR: clique abre o cartão "anunciar esta área" — mas anúncio por
        // cima tem prioridade (o clique nele já abre o imóvel)
        map.on("click", "car-fill", (e: MapLayerMouseEvent) => {
          if (desenhandoRef.current) return;
          const emAnuncio = map.queryRenderedFeatures(e.point, { layers: ["imoveis-fill", "imoveis-ponto"].filter((l) => map.getLayer(l)) });
          if (emAnuncio.length) return;
          const f = e.features?.[0];
          if (f) setCarSel(f.properties as unknown as CarProps);
        });
        map.on("mousemove", "car-fill", (e: MapLayerMouseEvent) => {
          const cod = String(e.features?.[0]?.properties?.cod ?? "");
          if (!cod || cod === carHoverRef.current) return;
          if (carHoverRef.current) map.setFeatureState({ source: "car", sourceLayer: "car", id: carHoverRef.current }, { hover: false });
          carHoverRef.current = cod;
          map.setFeatureState({ source: "car", sourceLayer: "car", id: cod }, { hover: true });
          if (!map.getCanvas().style.cursor) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "car-fill", () => {
          if (carHoverRef.current) map.setFeatureState({ source: "car", sourceLayer: "car", id: carHoverRef.current }, { hover: false });
          carHoverRef.current = null;
          map.getCanvas().style.cursor = "";
        });
        map.on("zoomend", conferirZoomCar);
        conferirZoomCar();

        // lote urbano: clique abre o cartão com as medidas
        map.on("click", "lotes-fill", async (e: MapLayerMouseEvent) => {
          if (desenhandoRef.current) return;
          const emAnuncio = map.queryRenderedFeatures(e.point, { layers: ["imoveis-fill", "imoveis-ponto"].filter((l) => map.getLayer(l)) });
          const id = String(e.features?.[0]?.properties?.id ?? "");
          if (emAnuncio.length || !id) return;
          // modo loteamento: o clique marca ou desmarca, sem abrir o cartão
          const marcados = variosRef.current;
          if (marcados) {
            setAvisoVarios("");
            if (marcados.some((l) => l.id === id)) return mudarVarios(marcados.filter((l) => l.id !== id));
            if (marcados.length >= LOTES_MAX) return setAvisoVarios(`No máximo ${LOTES_MAX} lotes por envio.`);
          }
          const f = await fetch(`/api/geo/lotes/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (!f?.properties) return;
          if (variosRef.current) {
            const lote = f.properties as LoteInfo;
            if (lote.anuncio) return setAvisoVarios(`Esse lote já tem anúncio (${lote.anuncio}) e fica de fora.`);
            if (!variosRef.current.some((l) => l.id === id)) mudarVarios([...variosRef.current, lote]);
            return;
          }
          map.removeFeatureState({ source: "lotes", sourceLayer: "lotes" });
          map.setFeatureState({ source: "lotes", sourceLayer: "lotes", id }, { sel: true });
          setLoteSel(f.properties as LoteInfo);
        });
        map.on("mousemove", "lotes-fill", (e: MapLayerMouseEvent) => {
          const id = String(e.features?.[0]?.properties?.id ?? "");
          if (!id || id === loteHoverRef.current) return;
          if (loteHoverRef.current) map.setFeatureState({ source: "lotes", sourceLayer: "lotes", id: loteHoverRef.current }, { hover: false });
          loteHoverRef.current = id;
          map.setFeatureState({ source: "lotes", sourceLayer: "lotes", id }, { hover: true });
          if (!map.getCanvas().style.cursor) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "lotes-fill", () => {
          if (loteHoverRef.current) map.setFeatureState({ source: "lotes", sourceLayer: "lotes", id: loteHoverRef.current }, { hover: false });
          loteHoverRef.current = null;
          map.getCanvas().style.cursor = "";
        });

        setLista((imoveis.features ?? []).map((f: GeoJSON.Feature) => f.properties as ImovelProps));
        setPronto(true);

        // planta urbana entra sob demanda: uma vez agora (o link pode já vir no
        // zoom da cidade, pelo hash da URL) e depois a cada parada do mapa
        map.on("moveend", () => void garantirPlantas());
        void garantirPlantas();
        // CAR fora da base regional: busca no SICAR ao parar o mapa
        map.on("moveend", garantirCarSobDemanda);
        garantirCarSobDemanda();

        // camadas oficiais: o mapa é recriado na troca de tema, então religa as que estavam ligadas
        camadasRef.current = new GerenciadorCamadasOficiais(map, setEstadoCamadas);
        camadasAtivasRef.current.forEach((id) => camadasRef.current?.alternar(id, true));
        // relevo e água: nada é baixado até alguém ligar uma camada no painel
        relevoRef.current = new GerenciadorRelevo(map, setEstadoRelevo, tema);
        relevoRef.current.mudarBase(baseRef.current);
        relevoAtivasRef.current.forEach((id) => relevoRef.current?.alternar(id, true));
        // clique: reúne no cartão tudo o que as camadas ligadas têm no ponto;
        // fora do CAR, o cartão do imóvel rural fecha (não fica um de outro lugar)
        map.on("click", (e) => {
          if (desenhandoRef.current) return;
          const oficiais = camadasRef.current?.noPonto(e.point) ?? [];
          setNoPonto(oficiais);
          setPontoClicado({ lng: e.lngLat.lng, lat: e.lngLat.lat, zoom: map.getZoom() });
          const noCar = !!map.getLayer("car-fill") && map.getLayoutProperty("car-fill", "visibility") !== "none"
            && map.queryRenderedFeatures(e.point, { layers: ["car-fill"] }).length > 0;
          if (!noCar) setCarSel(null);
          // o cartão do clique abre no mesmo canto do painel de camadas: o painel cede a vez
          if (noCar || oficiais.length) setCamadasAbertas(false);
        });

        // atalhos do menu (/mapa?camada=…): CAR ou uma camada oficial já ligada
        const pedida = new URLSearchParams(window.location.search).get("camada");
        if (pedida === "car") setCarAtivo(true);
        else if (pedida && camadaOficialPorId(pedida)) {
          setCamadasAbertas(true);
          if ((!recursos || recursos.includes("camadas_oficiais")) && !camadasAtivasRef.current.has(pedida as CamadaOficialId)) {
            alternarCamada(pedida as CamadaOficialId);
          }
        }
      });
    })();

    return () => {
      cancelado = true;
      camadasRef.current?.destruir();
      camadasRef.current = null;
      relevoRef.current?.destruir();
      relevoRef.current = null;
      hashDaSaida = { hash: window.location.hash, quando: Date.now() };
      mapa?.remove();
      mapRef.current = null;
    };
    // o mapa nasce uma vez; a troca de tema é do efeito abaixo (sem recriar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Tema claro/escuro: troca só o estilo da base CARTO (setStyle), levando junto
   * todas as fontes e camadas nossas — satélite, CAR, lotes, anúncios, camadas
   * oficiais, relevo, desenho. Antes o mapa inteiro era destruído e recriado,
   * o que baixava de novo imóveis, municípios e cartografia a cada troca.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pronto || !baseEstiloRef.current || temaAplicadoRef.current === tema) return;
    temaAplicadoRef.current = tema;
    map.setStyle(ESTILO_RUAS[tema], {
      transformStyle: (anterior, nova) => {
        const base = baseEstiloRef.current;
        if (!anterior || !base) return nova;
        baseEstiloRef.current = { fontes: new Set(Object.keys(nova.sources)), camadas: new Set(nova.layers.map((l) => l.id)) };
        const fontes = Object.fromEntries(Object.entries(anterior.sources).filter(([id]) => !base.fontes.has(id)));
        const camadas = anterior.layers.filter((l) => !base.camadas.has(l.id));
        return { ...nova, sources: { ...nova.sources, ...fontes }, layers: [...nova.layers, ...camadas] };
      },
    });
    relevoRef.current?.mudarTema(tema);
  }, [tema, pronto]);

  // base ruas/satélite (a planta da cidade muda de cor para continuar legível)
  useEffect(() => {
    baseRef.current = base; // planta que chegar depois já nasce na cor certa
    const map = mapRef.current;
    if (!map || !pronto || !map.getLayer("satelite")) return;
    map.setLayoutProperty("satelite", "visibility", base === "satelite" ? "visible" : "none");
    relevoRef.current?.mudarBase(base);
    const cores = CARTO_CORES[base];
    if (map.getLayer("lotes-borda")) {
      map.setPaintProperty("lotes-borda", "line-color",
        ["case", ["boolean", ["feature-state", "sel"], false], "#D9BD6F", cores.linha]);
      map.setPaintProperty("lotes-contorno", "line-color", cores.contorno);
      map.setPaintProperty("lotes-medidas", "text-color", base === "satelite" ? "#FFFFFF" : cores.linha);
    }
    for (const id of cartoVetorIdsRef.current) {
      if (map.getLayer(id)) {
        map.setPaintProperty(id, "line-color", id.endsWith("-contorno") ? cores.contorno : cores.linha);
      }
    }
  }, [base, pronto]);

  // imagem do ano / comparar
  useEffect(() => {
    imagemAnoRef.current = imagemAno;
    compararRef.current = comparar && !!imagemAno;
    if (!pronto) return;
    aplicarHistorico();
  }, [imagemAno, comparar, pronto, mapaPronto, aplicarHistorico]);

  // liga/desliga a planta completa do CAD
  useEffect(() => {
    plantaAtivaRef.current = plantaAtiva;
    const map = mapRef.current;
    if (!map || !pronto) return;
    for (const id of cartoVetorIdsRef.current) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", plantaAtiva ? "visible" : "none");
    }
    if (plantaAtiva) void garantirPlantas();
  }, [plantaAtiva, pronto, garantirPlantas]);

  // liga/desliga a malha do CAR
  useEffect(() => {
    carAtivoRef.current = carAtivo;
    const map = mapRef.current;
    if (!map || !pronto || !map.getLayer("car-fill")) return;
    for (const id of ["car-fill", "car-linha"]) map.setLayoutProperty(id, "visibility", carAtivo ? "visible" : "none");
    if (carAtivo) { conferirZoomCar(); garantirCarSobDemanda(); }
    else { setCarSel(null); setCarAviso(""); }
  }, [carAtivo, pronto, conferirZoomCar, garantirCarSobDemanda]);

  // busca rural inteligente (item 23): o formato do texto diz o que é
  const buscaLida = useMemo(() => interpretarBusca(busca), [busca]);
  // coordenada e CAR não são nome de imóvel: não filtram a lista; o código de anúncio filtra pelo código
  const termoFiltro = buscaLida.tipo === "texto" ? busca : buscaLida.tipo === "anuncio" ? buscaLida.codigo : "";

  // filtros e busca
  useEffect(() => {
    if (pronto) aplicar(filtroTipo, faixaPreco, termoFiltro);
  }, [filtroTipo, faixaPreco, termoFiltro, pronto, aplicar]);

  // busca que casa com município → voa até ele
  const municipioSugerido = useMemo(() => {
    if (buscaLida.tipo !== "texto") return null;
    const termo = norm(busca.trim());
    if (!termo || termo.length < 3) return null;
    const f = (municipiosRef.current?.features ?? []).find((m) =>
      norm(String((m.properties as { nome?: string })?.nome ?? "")).includes(termo)
    );
    return f ? { nome: (f.properties as { nome: string }).nome, geometry: f.geometry } : null;
  }, [busca, buscaLida.tipo]);

  // fora da região: municípios do Brasil inteiro pelo IBGE (cache de um dia no servidor)
  const [municipiosBrasil, setMunicipiosBrasil] = useState<{ cod: number; nome: string; uf: string }[]>([]);
  useEffect(() => {
    const termo = busca.trim();
    if (buscaLida.tipo !== "texto" || termo.length < 3) return; // a lista só aparece com 3+ letras
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/geo/municipio-busca?q=${encodeURIComponent(termo)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { municipios?: { cod: number; nome: string; uf: string }[] } | null) => setMunicipiosBrasil(j?.municipios ?? []))
        .catch(() => {});
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [busca, buscaLida.tipo]);

  const [buscaAviso, setBuscaAviso] = useState("");
  const [ajudaBusca, setAjudaBusca] = useState(false);

  const irParaMunicipioIbge = useCallback(async (cod: number) => {
    setBuscaAviso("");
    const j = await fetch(`/api/geo/municipio-busca?cod=${cod}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as
      { bbox?: [number, number, number, number] } | null;
    if (!j?.bbox) { setBuscaAviso("O IBGE não respondeu agora. Tente de novo em instantes."); return; }
    const [w, s, e, n] = j.bbox;
    mapRef.current?.fitBounds([[w, s], [e, n]], { padding: 60, duration: 1200 });
  }, []);

  /** Coordenada digitada: voa até o ponto e o marca com o anel dourado. */
  const irParaPonto = useCallback((lat: number, lng: number) => {
    const map = mapRef.current;
    if (!map) return;
    const dado: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} }],
    };
    const fonte = map.getSource("busca-ponto") as GeoJSONSource | undefined;
    if (fonte) fonte.setData(dado);
    else {
      map.addSource("busca-ponto", { type: "geojson", data: dado });
      map.addLayer({ id: "busca-ponto-anel", type: "circle", source: "busca-ponto",
        paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2.5, "circle-stroke-color": "#D9BD6F" } });
      map.addLayer({ id: "busca-ponto", type: "circle", source: "busca-ponto",
        paint: { "circle-radius": 4.5, "circle-color": "#D9BD6F", "circle-stroke-width": 1.5, "circle-stroke-color": "#124431" } });
    }
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), duration: 1400, essential: true });
  }, []);

  // apagou a busca: o ponto marcado sai do mapa
  useEffect(() => {
    if (busca.trim()) return;
    // a busca foi limpa depois de ir até a coordenada: o anel fica
    if (manterPontoBuscaRef.current) { manterPontoBuscaRef.current = false; return; }
    (mapRef.current?.getSource("busca-ponto") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
  }, [busca]);

  /** Código do CAR: enquadra a divisa e abre o cartão; fora da base importada, vai para a consulta (que busca no SICAR). */
  const abrirCar = useCallback(async (cod: string) => {
    setBuscaAviso("Procurando o imóvel no CAR…");
    const f = await fetch(`/api/geo/car/${encodeURIComponent(cod)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as
      { geometry?: GeoJSON.Geometry; properties?: Partial<CarProps> } | null;
    if (!f?.geometry) { router.push(`/consulta/car/${encodeURIComponent(cod)}`); return; }
    setBuscaAviso("");
    const coords: [number, number][] = [];
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    walk((f.geometry as { coordinates?: unknown }).coordinates);
    if (coords.length && mapRef.current) {
      const lngs = coords.map((c) => c[0]), lats = coords.map((c) => c[1]);
      mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, duration: 1200 });
    }
    setCarAtivo(true);
    setCarSel({
      cod, area_ha: f.properties?.area_ha ?? null, condicao: f.properties?.condicao ?? null,
      status: f.properties?.status ?? null, tipo: f.properties?.tipo ?? null, municipio: f.properties?.municipio ?? null,
    });
  }, [router]);

  /** Código de anúncio: abre na lista do mapa se estiver nela; senão, a página do imóvel. */
  const abrirAnuncio = useCallback((codigo: string) => {
    const f = dadosRef.current?.features.find((x) => (x.properties as ImovelProps).codigo?.toUpperCase() === codigo);
    if (f) voarPara(f.properties as ImovelProps);
    else router.push(`/imovel/${codigo}`);
  }, [router, voarPara]);

  /** Enter na caixa de busca: faz o que a primeira sugestão faria. */
  const confirmarBusca = () => {
    const b = buscaLida;
    if (b.tipo === "coordenada") escolherSugestao(() => irParaPonto(b.lat, b.lng), true);
    else if (b.tipo === "car") escolherSugestao(() => void abrirCar(b.cod));
    else if (b.tipo === "anuncio") escolherSugestao(() => abrirAnuncio(b.codigo));
    else if (municipioSugerido) escolherSugestao(irParaMunicipio);
    else if (municipiosBrasil[0]) { const cod = municipiosBrasil[0].cod; escolherSugestao(() => void irParaMunicipioIbge(cod)); }
  };

  const irParaMunicipio = useCallback(() => {
    if (!municipioSugerido) return;
    const coords: [number, number][] = [];
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    walk((municipioSugerido.geometry as GeoJSON.Polygon).coordinates);
    if (coords.length && mapRef.current) {
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      mapRef.current.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 60, duration: 1200 }
      );
    }
  }, [municipioSugerido]);

  usePressaoLonga(mapaPronto, {
    ativo: () => !desenhandoRef.current && !variosRef.current,
    aoPressionar: (p) => {
      // o cartão mínimo ocupa o mesmo canto: os outros cartões cedem a vez
      setCarSel(null); setNoPonto([]); setCamadasAbertas(false);
      if (loteSel) { setLoteSel(null); mapRef.current?.removeFeatureState({ source: "lotes", sourceLayer: "lotes" }); }
      setPontoLivre(p);
    },
    aoClicar: () => setPontoLivre(null),
  });

  /** Escolheu uma sugestão da busca: o voo já aconteceu, o texto não filtra mais a lista. */
  const escolherSugestao = (acao: () => void, manterPonto = false) => {
    acao();
    manterPontoBuscaRef.current = manterPonto;
    setBusca("");
  };

  const ativos = lista.filter((p) => p.status !== "vendido").length;

  /** "Não encontrei meu imóvel": leva o ponto onde a pessoa estava olhando. */
  const irParaSolicitacao = () => {
    const c = mapRef.current?.getCenter();
    const z = mapRef.current?.getZoom();
    const qs = c ? `?lng=${c.lng.toFixed(6)}&lat=${c.lat.toFixed(6)}&zoom=${(z ?? 14).toFixed(1)}` : "";
    router.push(`/cartografia/solicitar${qs}`);
  };

  // chips sobre o satélite: vidro do tema com desfoque (o ativo continua verde pelo data-ativo do .chip)
  const chipBase = "chip inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium whitespace-nowrap shadow-[0_8px_24px_-12px_rgb(0_0_0/0.7)] backdrop-blur-md";

  const chipsSecundarios = (
    <>
      {/* Revisão do Carlos (29/10): "buscar imóveis" como opção de filtro no mapa */}
      <button onClick={() => { setPainelAberto(true); setTimeout(() => buscaInputRef.current?.focus(), 320); }}
        className={chipBase} title="Abrir a lista com a busca e os filtros de imóveis">
        <Search className="size-3.5" /> Buscar imóveis
      </button>
      <button onClick={() => { setBuscaImagem(!buscaImagem); setSeletorAno(false); }} data-ativo={buscaImagem} className={chipBase}
        title="Encontre o local por uma foto com GPS, um print de mapa, um croqui ou um documento">
        <ImageUp className="size-3.5" /> Buscar por imagem
      </button>
      <button
        onClick={() => {
          if (!liberado("camadas_oficiais")) {
            setAvisoPlano(logado
              ? "As imagens históricas fazem parte da consulta profissional e não estão no seu plano."
              : "Entre na sua conta para ver as imagens históricas.");
            return;
          }
          setSeletorAno(!seletorAno);
        }}
        data-ativo={!!imagemAno || seletorAno} className={chipBase}
        title="Imagens de satélite de anos anteriores (Esri Wayback e Sentinel-2)">
        {liberado("camadas_oficiais") ? <History className="size-3.5" /> : <Lock className="size-3.5" />} {imagemAno ? `Imagem de ${imagemHistoricaPorId(imagemAno)?.ano}` : "Imagem do ano"}
      </button>
      <button onClick={() => { setCarAtivo(!carAtivo); void salvarPrefs({ camada_car: !carAtivo }); }} data-ativo={carAtivo} className={chipBase}
        title="Imóveis rurais do Cadastro Ambiental Rural (SICAR)">
        Imóveis rurais (CAR)
      </button>
      <button onClick={() => setPlantaAtiva(!plantaAtiva)} data-ativo={plantaAtiva} className={chipBase}
        title="Desenho completo da planta da cidade, como veio do CAD: ruas, calçadas, textos e detalhes">
        Planta completa
      </button>
    </>
  );

  return (
    <div className="relative flex-1 min-h-0 flex bg-fundo">
      {/* ---------- resultados ---------- */}
      <aside className={
        "absolute lg:relative z-20 h-full bg-superficie border-r border-linha transition-all duration-300 flex flex-col " +
        (painelAberto ? "w-[85%] sm:w-[320px]" : "w-0 overflow-hidden")
      }>
        <div className="p-4 space-y-3 border-b border-linha">
          <form role="search" className="relative" onSubmit={(e) => { e.preventDefault(); confirmarBusca(); }}>
            <input ref={buscaInputRef} data-tour="busca" value={busca} onChange={(e) => { setBusca(e.target.value); setBuscaAviso(""); }}
              aria-label="Buscar imóvel, município, CAR, código ou coordenada"
              placeholder="Imóvel, município, CAR, AIB-… ou coordenada"
              title="Também aceita graus/minutos/segundos e UTM (ex.: 22K 612345 7818123). Enter para ir."
              className="w-full rounded-full border border-linha-forte bg-superficie-2 pl-10 pr-10 py-2.5 text-sm text-texto placeholder:text-texto-2/70 transition focus:border-verde focus:outline-none focus:ring-2 focus:ring-verde/30" />
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-texto-2" />
            <button type="button" onClick={() => setAjudaBusca(!ajudaBusca)} aria-expanded={ajudaBusca}
              aria-label="Formatos aceitos na busca" title="Formatos aceitos na busca"
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-texto-2 transition hover:bg-superficie hover:text-verde">
              <CircleHelp className="size-4" />
            </button>
          </form>

          {ajudaBusca && (
            <dl className="rounded-xl border border-linha bg-superficie-2/60 px-3.5 py-2.5 text-xs space-y-1.5">
              {FORMATOS_BUSCA.map((f) => (
                <div key={f.rotulo} className="flex items-baseline justify-between gap-3">
                  <dt className="text-texto-2">{f.rotulo}</dt>
                  <dd className="font-mono text-[11px] text-texto text-right">{f.exemplo}</dd>
                </div>
              ))}
            </dl>
          )}

          {buscaLida.tipo === "coordenada" && (
            <button onClick={() => escolherSugestao(() => irParaPonto(buscaLida.lat, buscaLida.lng), true)}
              className="flex w-full items-center justify-between gap-2 text-left text-sm rounded-full border border-verde/25 bg-verde/12 text-verde px-3.5 py-2.5 hover:bg-verde/20 transition">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5"><Crosshair className="size-3.5 shrink-0" /> Ir para o ponto
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-texto-2">
                    {buscaLida.formato === "utm" ? "UTM" : buscaLida.formato === "gms" ? "GMS" : "graus"}
                  </span>
                </span>
                <strong className="block font-mono text-xs tabular-nums">{buscaLida.rotulo}</strong>
              </span>
              <ArrowRight className="size-4 shrink-0" />
            </button>
          )}
          {buscaLida.tipo === "car" && (
            <button onClick={() => escolherSugestao(() => void abrirCar(buscaLida.cod))}
              className="flex w-full items-center justify-between gap-2 text-left text-sm rounded-full border border-verde/25 bg-verde/12 text-verde px-3.5 py-2.5 hover:bg-verde/20 transition">
              <span className="min-w-0">Abrir o imóvel do CAR
                <strong className="block truncate font-mono text-[11px]">{buscaLida.cod}</strong>
              </span>
              <ArrowRight className="size-4 shrink-0" />
            </button>
          )}
          {buscaLida.tipo === "anuncio" && (
            <button onClick={() => escolherSugestao(() => abrirAnuncio(buscaLida.codigo))}
              className="flex w-full items-center justify-between gap-2 text-left text-sm rounded-full border border-verde/25 bg-verde/12 text-verde px-3.5 py-2.5 hover:bg-verde/20 transition">
              <span>Abrir o anúncio <strong className="font-mono">{buscaLida.codigo}</strong></span>
              <ArrowRight className="size-4 shrink-0" />
            </button>
          )}
          {municipioSugerido && (
            <button onClick={() => escolherSugestao(irParaMunicipio)}
              className="flex w-full items-center justify-between gap-2 text-left text-sm rounded-full border border-verde/25 bg-verde/12 text-verde px-3.5 py-2.5 hover:bg-verde/20 transition">
              <span>Ir para <strong>{municipioSugerido.nome}</strong></span>
              <ArrowRight className="size-4 shrink-0" />
            </button>
          )}
          {buscaLida.tipo === "texto" && busca.trim().length >= 3 && municipiosBrasil
            .filter((m) => !municipioSugerido || norm(m.nome) !== norm(municipioSugerido.nome))
            .slice(0, municipioSugerido ? 2 : 3)
            .map((m) => (
              <button key={m.cod} onClick={() => escolherSugestao(() => void irParaMunicipioIbge(m.cod))}
                className="flex w-full items-center justify-between gap-2 text-left text-sm rounded-full border border-linha-forte px-3.5 py-2 text-texto-3 hover:border-verde/40 hover:text-verde transition">
                <span className="flex items-center gap-1.5 min-w-0"><MapPin className="size-3.5 shrink-0" />
                  <span className="truncate">{m.nome} <span className="text-texto-2">· {m.uf}</span></span>
                </span>
                <ArrowRight className="size-4 shrink-0" />
              </button>
            ))}
          {buscaAviso && <p className="text-xs text-texto-2" aria-live="polite">{buscaAviso}</p>}

          <div className="flex gap-1.5 flex-wrap">
            {(["todos", "rural", "urbano", "leilao"] as const).map((t) => (
              <button key={t} onClick={() => setFiltroTipo(t)} data-ativo={filtroTipo === t}
                className="chip px-3.5 py-1.5 text-xs capitalize">
                {t === "leilao" ? "leilão" : t}
              </button>
            ))}
          </div>

          <select value={faixaPreco} onChange={(e) => setFaixaPreco(Number(e.target.value))} aria-label="Faixa de preço"
            className="w-full rounded-xl border border-linha-forte bg-superficie-2 px-3.5 py-2.5 text-sm text-texto transition focus:border-verde focus:outline-none focus:ring-2 focus:ring-verde/30">
            {FAIXAS_PRECO.map((f, i) => <option key={f.label} value={i}>{f.label}</option>)}
          </select>

          {/* antes de a lista chegar, "0 imóveis disponíveis" parecia mapa vazio */}
          <p className="text-sm text-texto-2" aria-live="polite">
            {pronto ? (
              <>
                <span className="font-display text-base font-bold text-texto tabular-nums">{ativos}</span>{" "}
                {ativos === 1 ? "imóvel disponível" : "imóveis disponíveis"}
              </>
            ) : "Carregando imóveis…"}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-linha">
          {lista.map((p) => (
            <button key={p.id}
              onClick={() => voarPara(p)}
              onMouseEnter={() => destacar(p.id)}
              onMouseLeave={() => destacar(null)}
              className={
                "w-full text-left flex gap-3.5 px-4 py-3.5 transition hover:bg-superficie-2 border-l-2 " +
                (selecionado?.id === p.id ? "bg-superficie-2 border-l-verde" : "border-l-transparent")
              }>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.capa ? mediaUrl(p.capa) : p.tipo === "rural" ? "/img/aerea-campo.jpg" : "/img/fazenda-gado.jpg"}
                alt="" className="w-24 h-[72px] rounded-xl object-cover shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block lp-display text-[1.1rem] leading-tight text-verde truncate">{p.titulo}</span>
                <span className="block text-xs text-texto-2 mt-0.5">
                  {p.municipio ?? "—"} · {formatArea(p.area_m2, p.tipo)}
                </span>
                <span className="block text-[0.95rem] font-bold text-verde mt-1 tabular-nums">
                  {p.status === "vendido"
                    ? <s className="text-texto-2">{formatBRL(p.valor)}</s>
                    : formatBRL(p.valor)}
                </span>
              </span>
              <span className="mt-1.5 mr-1 w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: STATUS_MAPA[p.status] ?? STATUS_MAPA.publicado, boxShadow: `0 0 0 2px var(--superficie), 0 0 0 3.5px ${RADAR_ANEL}` }} />
            </button>
          ))}
          {!lista.length && pronto && (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-verde/10 text-verde"><Search className="size-6" /></span>
              <p className="mt-3 text-sm text-texto-2">Nada encontrado com esses filtros.</p>
              <button onClick={irParaSolicitacao}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#D9BD6F] px-4 py-2 text-xs font-bold text-[#124431] transition hover:brightness-105">
                <Flag className="size-3.5" /> Não encontrei meu imóvel
              </button>
            </div>
          )}
        </div>
      </aside>

      <button
        onClick={() => setPainelAberto(!painelAberto)}
        title={painelAberto ? "Recolher lista" : "Mostrar lista"}
        className={
          "absolute z-30 top-1/2 -translate-y-1/2 bg-superficie border border-l-0 border-linha-forte shadow-lg rounded-r-[10px] w-7 h-14 flex items-center justify-center text-texto-2 hover:text-verde transition-all duration-300 " +
          (painelAberto ? "left-[85%] sm:left-[320px]" : "left-0")
        }>
        {painelAberto ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      {/* ---------- mapa ---------- */}
      <div ref={areaMapaRef} className="relative flex-1 min-w-0">
        {/* inline: o CSS do maplibre força position:relative na classe e colapsaria a altura */}
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {/* Barra do mapa (QA 09/11): antes era uma fila só com rolagem lateral e, em
            1366 px ou no celular, "Não encontrei meu imóvel", Satélite/Mapa e Camadas
            sumiam para fora da tela. Agora os de prioridade vêm primeiro e a barra
            QUEBRA em linhas; no celular o resto vai para o menu "Mais". A altura real
            da barra vira --abaixo-chips, e os painéis abrem logo abaixo dela. */}
        <div ref={chipsRef} className="absolute top-3 left-3 right-14 z-10 flex flex-wrap items-start gap-2">
          {/* requisitos cartográficos §2.1 + Revisão do Carlos (29/10): "Não encontrei
              meu imóvel" precisa ser fácil de achar — fica em dourado, logo no começo */}
          <button
            onClick={irParaSolicitacao}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#D9BD6F] px-4 py-2 text-xs font-bold text-[#124431] shadow-[0_8px_24px_-12px_rgb(0_0_0/0.7)] ring-1 ring-[#124431]/20 transition hover:brightness-105"
            title="Informar um imóvel ausente ou uma divergência do mapa à equipe de cartografia">
            <Flag className="size-3.5" /> Não encontrei meu imóvel
          </button>
          {(["satelite", "ruas"] as const).map((b) => (
            <button key={b} onClick={() => { setBase(b); void salvarPrefs({ mapa_base: b === "ruas" ? "mapa" : "satelite" }); }} data-ativo={base === b} className={chipBase}>
              {b === "ruas" ? "Mapa" : "Satélite"}
            </button>
          ))}
          <button onClick={() => { setCamadasAbertas(!camadasAbertas); setMaisAberto(false); }} data-ativo={camadasAbertas}
            className={chipBase} data-tour="camadas">
            <Layers className="size-3.5" /> Camadas e Dados
          </button>
          <div className="hidden sm:contents">{chipsSecundarios}</div>
          <button onClick={() => setMaisAberto(!maisAberto)} data-ativo={maisAberto} aria-expanded={maisAberto} className={chipBase + " sm:hidden"} data-tour="mais">
            <Ellipsis className="size-3.5" /> Mais
          </button>
          {/* ancorado na barra (não no botão): não passa da borda da tela */}
          {maisAberto && (
            <div className={`sm:hidden absolute left-0 top-full z-30 mt-2 flex w-56 max-w-full flex-col items-stretch gap-1.5 p-2 ${VIDRO}`}
              onClick={() => setMaisAberto(false)}>
              {chipsSecundarios}
            </div>
          )}
        </div>

        {carAtivo && carAviso && !carSel && (
          <p className={`absolute top-[var(--abaixo-chips,4rem)] left-3 right-14 sm:right-auto px-3.5 py-2 text-xs text-texto-3 ${VIDRO} rounded-[10px]!`}>
            {carAviso}
          </p>
        )}

        {avisoPlano && (
          <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-10 px-4 py-3 flex items-center gap-3 text-sm max-w-[calc(100%-1.5rem)] ${VIDRO}`}>
            <Lock className="size-4 shrink-0 text-ouro" />
            <span className="text-texto-3">{avisoPlano}</span>
            <Link href={logado ? "/planos" : "/entrar"} className="inline-flex items-center gap-1 text-verde font-semibold whitespace-nowrap hover:underline">
              {logado ? "Ver planos" : "Entrar"} <ArrowRight className="size-3.5" />
            </Link>
            <BotaoFechar onClick={() => setAvisoPlano("")} />
          </div>
        )}

        {buscaImagem && (
          <BuscaPorImagem
            logado={logado}
            onFechar={() => setBuscaImagem(false)}
            onIr={(lng, lat, zoom) => mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1400 })}
            onBuscarTexto={(termo) => { setBusca(termo); setPainelAberto(true); }}
          />
        )}

        {seletorAno && (
          <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-20 w-80 max-w-[calc(100%-1.5rem)] p-5 space-y-3.5 max-h-[70%] overflow-y-auto ${VIDRO}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-full bg-verde/12 text-verde"><History className="size-[18px]" /></span>
                <p className="lp-display text-2xl text-verde">Imagem do ano</p>
              </div>
              <BotaoFechar onClick={() => setSeletorAno(false)} />
            </div>
            <select value={imagemAno ?? ""} aria-label="Ano da imagem de satélite"
              onChange={(e) => {
                const v = e.target.value || null;
                setImagemAno(v);
                if (v) setBase("satelite");
                else setComparar(false);
              }}
              className="w-full rounded-xl border border-linha-forte bg-superficie-2 px-3.5 py-2.5 text-sm text-texto transition focus:border-verde focus:outline-none focus:ring-2 focus:ring-verde/30">
              <option value="">Atual (padrão)</option>
              {imagemAno?.startsWith("cdse:") && (
                <option value={imagemAno}>{imagemHistoricaPorId(imagemAno)?.rotulo}</option>
              )}
              <optgroup label="Alta resolução — Esri Wayback (~0,5 m)">
                {IMAGENS_HISTORICAS.filter((i) => i.familia === "wayback").map((i) => (
                  <option key={i.id} value={i.id}>{i.rotulo}</option>
                ))}
              </optgroup>
              <optgroup label="Sentinel-2 sem nuvens — EOX (10 m)">
                {IMAGENS_HISTORICAS.filter((i) => i.familia === "sentinel").map((i) => (
                  <option key={i.id} value={i.id}>{i.rotulo}</option>
                ))}
              </optgroup>
            </select>
            <label className={"flex items-center gap-2.5 text-sm " + (imagemAno ? "text-texto" : "text-texto-2 opacity-60")}>
              <input type="checkbox" checked={comparar} disabled={!imagemAno}
                onChange={(e) => setComparar(e.target.checked)} className="size-4 accent-verde" />
              Comparar com a imagem atual (cortina)
            </label>
            <CenasCopernicus mapa={mapaPronto} selecionada={imagemAno}
              aoEscolher={(id) => { setImagemAno(id); if (id) setBase("satelite"); else setComparar(false); }} />
            <p className="text-xs text-texto-2 leading-relaxed border-t border-linha pt-3">
              Wayback mostra o mosaico da Esri como estava publicado no fim de cada ano — a foto de um lugar
              pode ser anterior. Sentinel-2 é um mosaico anual sem nuvens, bom para vegetação e mancha urbana,
              não para lote. A fonte aparece no canto do mapa.
            </p>
          </div>
        )}

        {comparar && imagemAno && mapaPronto && imagemHistoricaPorId(imagemAno) && (
          <ComparaImagens mapa={mapaPronto} imagem={imagemHistoricaPorId(imagemAno)!} onFechar={() => setComparar(false)} />
        )}

        {carSel && <CartaoCar car={carSel} oficiais={noPonto} onFechar={() => { setCarSel(null); setNoPonto([]); }} />}
        {!carSel && noPonto.length > 0 && !loteSel && <CartaoOficiais itens={noPonto} ponto={pontoClicado} onFechar={() => setNoPonto([])} />}
        {pontoLivre && !carSel && !loteSel && !varios && noPonto.length === 0 && (
          <CartaoPonto ponto={pontoLivre} onFechar={() => setPontoLivre(null)} />
        )}
        <MarcadorDaUrl map={mapaPronto} />
        {loteSel && !carSel && !varios && (
          <CartaoLote lote={loteSel} onFechar={() => {
            setLoteSel(null);
            mapRef.current?.removeFeatureState({ source: "lotes", sourceLayer: "lotes" });
          }} onVarios={() => { setAvisoVarios(""); mudarVarios([loteSel]); setLoteSel(null); }} />
        )}
        {varios && !carSel && (
          <CartaoLotes lotes={varios} aviso={avisoVarios}
            onRemover={(id) => mudarVarios(varios.filter((l) => l.id !== id))}
            onLimpar={() => mudarVarios([])}
            onSair={() => { setAvisoVarios(""); mudarVarios(null); }} />
        )}

        {camadasAbertas && (
          <PainelCamadas onFechar={() => setCamadasAbertas(false)}
            bloqueado={!liberado("camadas_oficiais")} logado={logado}
            ativas={camadasAtivas} estado={estadoCamadas} onAlternar={alternarCamada}
            relevoAtivas={relevoAtivas} estadoRelevo={estadoRelevo} onAlternarRelevo={alternarRelevo} />
        )}
        <Legenda relevo={[...relevoAtivas]} extras={CAMADAS_OFICIAIS.filter((c) => camadasAtivas.has(c.id))
          // camada com cor por valor (biomas): uma linha por valor na legenda
          .flatMap((c) => (c.cores ? Object.entries(c.cores).map(([nome, cor]) => ({ nome, cor })) : [c]))} />

        <Ferramentas
          mapa={mapaPronto}
          recursos={recursos}
          logado={logado}
          onDesenhando={aoDesenhar}
          onImportarKml={async (arquivo) => {
            const map = mapRef.current;
            if (!map) return;
            try {
              let kmlTexto: string;
              if (arquivo.name.toLowerCase().endsWith(".kmz")) {
                const JSZip = (await import("jszip")).default;
                const zip = await JSZip.loadAsync(await arquivo.arrayBuffer());
                const entrada = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(".kml"));
                if (!entrada) throw new Error("KMZ sem KML dentro");
                kmlTexto = await entrada.async("string");
              } else {
                kmlTexto = await arquivo.text();
              }
              const { kml } = await import("@tmcw/togeojson");
              const doc = new DOMParser().parseFromString(kmlTexto, "text/xml");
              const dados = kml(doc) as GeoJSON.FeatureCollection;

              if (map.getSource("kml-importado")) {
                (map.getSource("kml-importado") as GeoJSONSource).setData(dados);
              } else {
                map.addSource("kml-importado", { type: "geojson", data: dados });
                map.addLayer({
                  id: "kml-fill", type: "fill", source: "kml-importado",
                  filter: ["==", ["geometry-type"], "Polygon"],
                  paint: { "fill-color": "#D9BD6F", "fill-opacity": 0.2 },
                });
                map.addLayer({
                  id: "kml-linha", type: "line", source: "kml-importado",
                  paint: { "line-color": "#FFE299", "line-width": 2.5 },
                });
              }

              const coords: [number, number][] = [];
              const walk = (c: unknown): void => {
                if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
                else if (Array.isArray(c)) c.forEach(walk);
              };
              for (const f of dados.features) walk((f.geometry as { coordinates?: unknown })?.coordinates);
              if (coords.length) {
                const lngs = coords.map((c) => c[0]);
                const lats = coords.map((c) => c[1]);
                map.fitBounds(
                  [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                  { padding: 80, duration: 1000 }
                );
              }
            } catch (e) {
              console.error("falha ao importar KML:", e);
            }
          }}
          onCapturar={() => {
            const map = mapRef.current;
            if (!map) return;
            // redesenha antes de ler o canvas: sem isso o buffer volta em branco
            map.once("render", () => {
              const url = map.getCanvas().toDataURL("image/png");
              const a = document.createElement("a");
              a.href = url;
              a.download = `arini-mapa-${new Date().toISOString().slice(0, 10)}.png`;
              a.click();
            });
            map.triggerRepaint();
          }}
        />
      </div>

      {/* ---------- inteligência territorial do imóvel ---------- */}
      {selecionado && (
        <PainelImovel
          imovel={selecionado}
          raio={raio}
          onRaio={setRaio}
          onFechar={() => setSelecionado(null)}
        />
      )}
    </div>
  );
}

