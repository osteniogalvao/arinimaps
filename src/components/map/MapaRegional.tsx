"use client";

/**
 * Mapa regional estilo Google Maps: base vetorial (CARTO Voyager) + satélite,
 * painel lateral de resultados com busca, hover sincronizado lista↔mapa,
 * tooltip ao passar o mouse, flyTo suave, cartografia urbana (raster e vetorial),
 * fullscreen, escala e localização do usuário.
 */

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import bbox from "@turf/bbox";
import type { Map as MLMap, MapLayerMouseEvent, GeoJSONSource, Popup, StyleSpecification, VectorTileSource } from "maplibre-gl";
import { DETALHES_SATELITE, camadaDeDetalhe } from "@/lib/map/ortofotos";
import { CENTRO_REGIAO, LIMITES_MAPA_REGIONAL, MOSAICO_MENOS_NUVENS, SATELITE, SATELITE_GOOGLE, ZOOM_INICIAL_REGIONAL, ZOOM_MOSAICO_ATE } from "@/lib/map/config";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { useMunicipiosAtendidos } from "@/lib/map/useMunicipiosAtendidos";
import { listaDeMunicipios, municipioAtendidoDoCar } from "@/lib/geo/atendimento";
import { formatBRL, formatArea } from "@/lib/format";
import { transformarGeoJSON, centroDe, removerLinhasExcluidas, aplicarEdicoesGeoJSON, TRANSFORM_ZERO, type Transform, type AjusteLocal, type EdicaoGeometria } from "@/lib/geo/deslocar";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PainelImovel from "@/components/map/PainelImovel";
import PainelPredio, { type Predio } from "@/components/map/PainelPredio";
import type { SubtipoUnidade } from "@/lib/imovel/unidade";
import { RADAR_ANEL, STATUS_MAPA } from "@/components/map/statusMapa";
import { PainelCamadas, Legenda, VIDRO, BotaoFechar, FiltrosRapidos, ResumoCamadas, ALTURA_FAIXA, SITUACOES_CAR, type GrupoCamadas, type SituacaoCar } from "@/components/map/UiMapa";
import { ArrowRight, ChevronLeft, ChevronRight, CircleHelp, Crosshair, Ellipsis, Flag, History, ImageUp, Layers, Lock, Tag, Map as MapaIcone, MapPin, Satellite, ScanSearch, Search } from "lucide-react";
import CompararParcelasRurais from "@/components/map/CompararParcelasRurais";
import BuscaUrbana from "@/components/map/BuscaUrbana";
import BuscaPorImagem from "@/components/map/BuscaPorImagem";
import MatriculaSigef from "@/components/rural/MatriculaSigef";
import ResumoSigef from "@/components/rural/ResumoSigef";
import AmbienteCar from "./AmbienteCar";
import Ferramentas from "@/components/map/Ferramentas";
import { guardarCarPendente } from "@/lib/map/carPendente";
import { CartaoLote, CartaoLotes, LOTES_MAX, LOTE_ZOOM_MIN, MEDIDA_ZOOM_MIN, ROTULO_ZOOM_MIN, type LoteInfo } from "@/components/map/lotes";
import ComparaImagens from "@/components/map/ComparaImagens";
import CenasCopernicus from "@/components/map/CenasCopernicus";
import { IMAGENS_HISTORICAS, imagemHistoricaPorId } from "@/lib/map/historico";
import { useTema } from "@/components/shell/BotaoTema";
import { usePreferencias } from "@/lib/usePreferencias";
import { escaparHtml } from "@/lib/seguranca/html";
import { GerenciadorCamadasOficiais, type AreaCamadas, type EstadoCamada, type FeicaoNoPonto } from "@/components/map/camadasOficiaisMapa";
import { ListaNoPonto, LinhaRelevo, LinhaAmbiente, ambienteNoPonto, type AmbienteNoPonto } from "@/components/map/InfoNoPonto";
import { exibirCarNasAreas } from "@/components/map/vetoresNasAreas";
import RelevoNasAreas from "@/components/map/RelevoNasAreas";
import { CAMADAS_OFICIAIS, CORES_RURAIS, camadaOficialPorId, descreverFeicao, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import { CAMADAS_RELEVO, ESTILO_RUAS, GerenciadorRelevo, camadasDeRelevo, type EstadoRelevo, type RelevoId } from "@/components/map/camadasRelevo";
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
  // apartamento/sala em prédio (18/11/2026), vindos de /api/geo/imoveis
  pai?: string;
  pai_codigo?: string;
  pai_titulo?: string;
  subtipo?: SubtipoUnidade;
  andar?: number;
  unidade?: string;
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
 * claro no satélite, verde-acinzentado no mapa. Verde separa as duas à
 * primeira vista (pedido: "cores cartográficas distintas para urbano e rural").
 */
const COR_RURAL = CORES_RURAIS.car;
/** Contorno da área do CAR clicada (print do Carlos de 17/11: verde na malha, amarelo na seleção). */
const COR_SELECAO_CAR = "#FFD400";
/** Situação do CAR nos tiles (`status` do SICAR e `condicao`) agrupada como no subfiltro. */
const CONDICAO_CAR = ["downcase", ["coalesce", ["get", "condicao"], ""]];
const CATEGORIA_CAR = ["case",
  ["any", ["in", ["coalesce", ["get", "status"], ""], ["literal", ["CA", "SU"]]], ["in", "cancelad", CONDICAO_CAR], ["in", "suspens", CONDICAO_CAR]], "cancelado",
  ["in", "em análise", CONDICAO_CAR], "em_analise",
  ["in", "analisad", CONDICAO_CAR], "analisado",
  ["in", "aguardando", CONDICAO_CAR], "aguardando",
  "outros"];

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

/**
 * Extras do ponto clicado além das camadas oficiais (vídeo do Carlos, 17/11,
 * 22h00): altitude quando há camada de relevo ligada e o tema ambiental do
 * CAR quando a camada ambiental do imóvel está aberta.
 */
type ExtrasNoPonto = { lng: number; lat: number; relevo: boolean; ambiente: AmbienteNoPonto[] | null };

/** "Neste ponto": tudo o que as camadas ligadas têm onde a pessoa clicou. */
function NestePonto({ itens, extras }: { itens: FeicaoNoPonto[]; extras: ExtrasNoPonto | null }) {
  return <div className="space-y-2">
    {extras?.ambiente && <LinhaAmbiente itens={extras.ambiente} />}
    {extras?.relevo && <LinhaRelevo lng={extras.lng} lat={extras.lat} />}
    {itens.length > 0 && <ListaNoPonto itens={itens} />}
  </div>;
}
const temExtras = (x: ExtrasNoPonto | null) => !!x && (x.relevo || !!x.ambiente);

/** Clique fora do CAR mas sobre camadas oficiais: o mesmo resumo, sem o cartão do imóvel. */
function CartaoOficiais({ itens, extras, ponto, onFechar }: {
  itens: FeicaoNoPonto[]; extras: ExtrasNoPonto | null; ponto: { lng: number; lat: number; zoom: number } | null; onFechar: () => void;
}) {
  return (
    <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-10 w-80 max-w-[calc(100%-1.5rem)] max-h-[70%] overflow-y-auto p-5 space-y-3 ${VIDRO}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="lp-display text-2xl text-verde">Neste ponto</p>
        <BotaoFechar onClick={onFechar} />
      </div>
      <NestePonto itens={itens} extras={extras} />
      {ponto && <BotaoCompartilharPonto lng={ponto.lng} lat={ponto.lat} zoom={Math.max(ponto.zoom, 15)} />}
    </div>
  );
}

/**
 * Cartão do imóvel do CAR clicado, enxuto no modelo do Geomart (item 14 do
 * PDF do Carlos, 17/11/2026): área no topo, depois imóvel, matrícula,
 * município e CAR; as ações "é minha / anunciar", "vincular" e "consultar".
 * O resto (ambiental, divergência) fica em "Mais detalhes"; o que as camadas
 * ligadas têm no ponto aparece já no topo (vídeo do Carlos, 17/11, 22h00).
 */
/**
 * Pedido de 18/11/2026: visitante e conta gratuita veem só imóveis à venda. A
 * área do CAR sem anúncio é de terceiro: o cartão não mostra área, matrícula,
 * nº do CAR nem camadas; fica só o caminho para o dono anunciar ou vincular e
 * para os planos de consulta (a trava de verdade está nas rotas, src/lib/dados-terceiros.ts).
 */
function CartaoCarBloqueado({ car, logado, onFechar }: { car: CarProps; logado: boolean; onFechar: () => void }) {
  return (
    <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-10 w-80 max-w-[calc(100%-1.5rem)] p-4 space-y-3 ${VIDRO}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="lp-eyebrow !text-[10px] !tracking-[0.2em] !text-ouro">{CAR_TIPO[car.tipo ?? ""] ?? "Imóvel rural"}{car.municipio ? ` · ${car.municipio}` : ""}</p>
          <p className="lp-display text-2xl text-verde mt-1.5 flex items-center gap-2"><Lock className="size-5 shrink-0 text-ouro" /> Área sem anúncio</p>
        </div>
        <BotaoFechar onClick={onFechar} />
      </div>
      <p className="text-sm leading-relaxed text-texto-2">
        Esta área não está à venda na Arini. Área, matrícula, quadro ambiental e crédito rural de imóveis de terceiros fazem parte dos planos de consulta.
      </p>
      <div className="space-y-2">
        <Link href={logado ? "/planos" : "/entrar?cadastro=1"} className="btn-verde flex w-full items-center justify-center gap-1.5 py-2.5 text-sm">
          {logado ? "Ver planos de consulta" : "Criar conta grátis"} <ArrowRight className="size-4" />
        </Link>
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/painel/novo?car=${encodeURIComponent(car.cod)}`} onClick={() => guardarCarPendente(car.cod)}
            className="btn-contorno flex items-center justify-center py-2 text-sm">É minha · anunciar</Link>
          <Link href={`/painel/cofre?car=${encodeURIComponent(car.cod)}`} className="btn-contorno flex items-center justify-center py-2 text-sm">Vincular área</Link>
        </div>
      </div>
    </div>
  );
}

function CartaoCar({ car, mapa, podeAmbiente, onFechar, oficiais = [], extras = null }: { car: CarProps; mapa: MLMap | null; podeAmbiente: boolean; onFechar: () => void; oficiais?: FeicaoNoPonto[]; extras?: ExtrasNoPonto | null }) {
  const area = Number(car.area_ha);
  const [detalhes, setDetalhes] = useState(false);
  // áudio do Carlos (17/11, 19h09): anúncio só nos municípios que a Arini atende
  const atendidos = useMunicipiosAtendidos();
  const foraDaArea = !!atendidos && !municipioAtendidoDoCar(atendidos, car);
  const [aba, setAba] = useState<"ambiental" | "sigef">("sigef");
  const linha = "flex items-baseline justify-between gap-3 py-1.5";
  return (
    <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-10 w-80 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-var(--abaixo-chips,4rem)-6.5rem)] sm:max-h-[calc(100%-var(--abaixo-chips,4rem)-8rem)] overflow-y-auto overscroll-contain p-4 space-y-3 ${VIDRO}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="lp-eyebrow !text-[10px] !tracking-[0.2em] !text-ouro">{CAR_TIPO[car.tipo ?? ""] ?? "Imóvel rural"} · CAR</p>
          <p className="lp-display text-2xl text-verde mt-1.5">
            {Number.isFinite(area) && area > 0 ? formatArea(area * 10_000, "rural") : "Área não informada"}
          </p>
        </div>
        <BotaoFechar onClick={onFechar} />
      </div>
      {/* vídeo do Carlos (17/11, 22h00): o clique na fazenda também responde pelas camadas ligadas (solo, clima, crédito...) */}
      {(oficiais.length > 0 || temExtras(extras)) && <section aria-label="Neste ponto" className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-texto-2">Neste ponto · camadas ligadas</p>
        <NestePonto itens={oficiais} extras={extras} />
      </section>}
      <dl className="text-sm divide-y divide-linha rounded-xl border border-linha bg-superficie-2/60 px-3">
        <ResumoSigef cod={car.cod} linha={linha} />
        <div className={linha}><dt className="text-texto-2">Município</dt><dd className="text-right font-medium text-texto">{car.municipio ?? "—"}</dd></div>
        <div className={linha}>
          <dt className="shrink-0 text-texto-2">Nº do CAR</dt>
          <dd className="min-w-0 truncate text-right font-mono text-[11px] text-texto" title={car.cod}>{car.cod}</dd>
        </div>
      </dl>
      <div className="space-y-2">
        {foraDaArea ? (
          <div className="rounded-xl border border-ouro/50 bg-ouro/10 px-3 py-2.5 text-xs leading-relaxed text-texto">
            <p className="font-semibold">Anúncio ainda não disponível{car.municipio ? ` em ${car.municipio}` : " neste município"}.</p>
            <p className="mt-1 text-texto-2">Hoje a Arini anuncia em {listaDeMunicipios(atendidos!)}. A consulta desta área continua liberada.</p>
            <Link href="/expansao" className="mt-1.5 inline-flex items-center gap-1 font-semibold text-verde hover:underline">
              Quero a Arini na minha região <ArrowRight className="size-3.5" />
            </Link>
          </div>
        ) : (
          <Link href={`/painel/novo?car=${encodeURIComponent(car.cod)}`} onClick={() => guardarCarPendente(car.cod)}
            className="btn-ouro flex w-full items-center justify-center gap-1.5 py-2.5 text-sm">
            Esta área é minha · anunciar <ArrowRight className="size-4" />
          </Link>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/painel/cofre?car=${encodeURIComponent(car.cod)}`} className="btn-contorno flex items-center justify-center py-2 text-sm">Vincular área</Link>
          <Link href={`/consulta/car/${encodeURIComponent(car.cod)}`} className="btn-contorno flex items-center justify-center gap-1.5 py-2 text-sm">
            <ScanSearch className="size-4" /> Consultar
          </Link>
          {/* áudio do Carlos (18/11/2026): no celular faltava o 3D a partir do mapa */}
          <Link href={`/consulta/car/${encodeURIComponent(car.cod)}?tour=1`} className="btn-contorno col-span-2 flex items-center justify-center gap-1.5 py-2 text-sm">
            Tour 3D desta área
          </Link>
        </div>
      </div>
      <button type="button" aria-expanded={detalhes} onClick={() => setDetalhes(!detalhes)}
        className="w-full text-center text-xs font-semibold text-verde hover:underline">
        {detalhes ? "Menos detalhes" : "Mais detalhes desta área"}
      </button>
      {detalhes && <>
        <div role="group" aria-label="Detalhes desta área" className="flex flex-wrap gap-1">
          {(["sigef", "ambiental"] as const).map(k =>
            <button type="button" key={k} aria-pressed={aba === k} onClick={() => setAba(k)} className={"min-h-8 rounded-lg px-2.5 text-xs " + (aba === k ? "bg-verde text-white" : "border border-linha text-texto")}>
              {{ sigef: "Matrícula", ambiental: "Ambiental" }[k]}
            </button>)}
        </div>
        {aba === "sigef" && <>
          <p className="text-xs text-texto-2">Situação no CAR · <span className="text-texto">{car.condicao ?? "—"}</span></p>
          <MatriculaSigef cod={car.cod} compacto />
        </>}
        {aba === "ambiental" && (podeAmbiente
          ? <AmbienteCar cod={car.cod} mapa={mapa} />
          : <Link href="/planos" className="text-sm text-verde underline">Consultar planos com mapa ambiental</Link>)}
        <Link href={`/cartografia/solicitar?referencia=${encodeURIComponent("car:" + car.cod)}&tipo=divergencia`}
          className="flex items-center justify-center gap-1.5 text-xs text-texto-2 hover:text-verde transition">
          <Flag className="size-3.5" /> O mapa está divergente desta área
        </Link>
        <p className="text-[11px] text-texto-2 leading-relaxed border-t border-linha pt-3">
          A divisa vem pronta do CAR. Para publicar, a Arini confere a matrícula do imóvel. O CAR é
          autodeclarado e não comprova propriedade.
        </p>
      </>}
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

// O satélite desenha direto sobre um fundo local. O estilo e os tiles de
// ruas só são baixados se a pessoa escolher a base cartográfica.
const FUNDO_SATELITE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "fundo-satelite", type: "background", paint: { "background-color": "#17251f" } }],
};

/**
 * Hash da URL no momento em que o último mapa foi desmontado. O remove() do
 * MapLibre apaga o #pos=…; se o componente remonta em seguida (Strict Mode,
 * navegação client-side vinda da home), o mapa novo reabre nesta posição.
 */
let hashDaSaida: { hash: string; quando: number } | null = null;

/**
 * Camadas que o "só à venda" esconde: a cartografia rural (malha do CAR e o
 * recorte dela nas áreas, camadas oficiais, relevo e água, parcela SIGEF
 * achada na busca, divisas das áreas de camadas). Planta urbana, lotes,
 * municípios, satélite e os anúncios ficam.
 */
const PREFIXOS_CARTO_RURAL = ["car-", "of-", "relevo-", "areas-camadas", "busca-sigef"];

/**
 * 25/11/2026 (Stenio): na cartografia urbana o lote da planta que está à venda
 * acende como a fazenda à venda acende sobre o CAR — preenchimento e traço
 * dourados no próprio lote, com quadra e número para qualquer visitante. O
 * anúncio guarda o lote de origem (`lote_id`, migration 0053), que vem em
 * /api/geo/imoveis; o filtro é refeito sempre que a lista do mapa muda.
 */
const CAMADAS_LOTE_VENDA = ["lotes-venda-fill", "lotes-venda-contorno", "lotes-venda-borda"];
function marcarLotesAVenda(map: MLMap, features: GeoJSON.Feature[]) {
  const ids = [...new Set(features
    .filter((f) => (f.properties as { status?: string } | null)?.status !== "vendido")
    .map((f) => (f.properties as { lote_id?: string } | null)?.lote_id)
    .filter((id): id is string => !!id))];
  const filtro = ["in", ["get", "id"], ["literal", ids]];
  for (const id of CAMADAS_LOTE_VENDA) if (map.getLayer(id)) map.setFilter(id, filtro as never);
}

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
  STATUS_MAPA.publicado,
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

// Na primeira pintura o HTML pode chegar antes dos controles interativos.
const assinarHidratacao = () => () => {};
// Áudio do Carlos (18/11/2026, 17h01 e 17h03): o município buscado ganha o contorno da base
// do IBGE (tracejado vermelho e branco, como no Google Maps), só como ponto de referência;
// ao aproximar (nível 14+) o contorno some e não fica por cima de lotes e áreas.
function marcarMunicipio(map: MLMap, geometria: GeoJSON.Geometry | null) {
  const dado: GeoJSON.FeatureCollection = { type: "FeatureCollection",
    features: geometria ? [{ type: "Feature", geometry: geometria, properties: {} }] : [] };
  const fonte = map.getSource("municipio-buscado") as GeoJSONSource | undefined;
  if (fonte) { fonte.setData(dado); return; }
  map.addSource("municipio-buscado", { type: "geojson", data: dado });
  map.addLayer({ id: "municipio-buscado-base", type: "line", source: "municipio-buscado", maxzoom: 14,
    paint: { "line-color": "#FFFFFF", "line-width": 4.5, "line-opacity": 0.9 } });
  map.addLayer({ id: "municipio-buscado-tracejado", type: "line", source: "municipio-buscado", maxzoom: 14,
    paint: { "line-color": "#D80B0B", "line-width": 4.5, "line-dasharray": [1.2, 1.2] } });
}

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
  const interativo = useSyncExternalStore(assinarHidratacao, () => true, () => false);
  const router = useRouter();
  const liberado = (r: string) => !recursos || recursos.includes(r);
  // 18/11/2026: sem `dados_terceiros`, área do CAR e lote sem anúncio não mostram dado nenhum
  const podeTerceiros = liberado("dados_terceiros");
  const podeTerceirosRef = useRef(podeTerceiros);
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
  const [mosaicoAnual, setMosaicoAnual] = useState(false);
  const [base, setBase] = useState<"ruas" | "satelite">("satelite");
  const [selecionado, setSelecionado] = useState<ImovelProps | null>(null);
  // prédio com apartamentos à venda: o clique abre a lista por andar (Carlos, 18/11 16h57)
  const [predio, setPredio] = useState<Predio | null>(null);
  const imovelAberto = selecionado?.id;
  useEffect(() => {
    if (imovelAberto) {
      void fetch("/api/vitrine/visualizacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imovel: imovelAberto }),
        keepalive: true,
      }).catch(() => {});
    }
  }, [imovelAberto]);
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "urbano" | "rural" | "leilao">("todos");
  const [faixaPreco, setFaixaPreco] = useState(0);
  const [busca, setBusca] = useState("");
  // busca limpa depois de ir até uma coordenada: o anel dourado fica no mapa
  const manterPontoBuscaRef = useRef(false);
  const [painelAberto, setPainelAberto] = useState(false);
  const [raio, setRaio] = useState(5000);
  const [painelMapa, setPainelMapa] = useState<"camadas" | "mais" | "ano" | "imagem" | null>(null);
  const camadasAbertas = painelMapa === "camadas";
  const [grupoCamadas, setGrupoCamadas] = useState<GrupoCamadas | null>(null);
  const [pronto, setPronto] = useState(false);
  const [avisoCarga, setAvisoCarga] = useState("");
  const [lista, setLista] = useState<ImovelProps[]>([]);
  const [mapaPronto, setMapaPronto] = useState<MLMap | null>(null);
  const [carAtivo, setCarAtivo] = useState(true);
  const carEscolhido = useRef(false);
  // Áudio do Carlos (23/11/2026, 13h42): em qualquer plano, alternar entre a
  // cartografia geral e "só à venda", que esconde a cartografia RURAL (CAR,
  // camadas oficiais, relevo e água) e deixa só os imóveis anunciados. A
  // planta urbana continua completa ("no urbano, por enquanto, deixa tudo").
  const [soVenda, setSoVenda] = useState(false);
  const soVendaRef = useRef(false);
  // Subfiltro do CAR pela situação no SICAR (filtros rápidos, 17/11/2026)
  const [situacoesCar, setSituacoesCar] = useState<ReadonlySet<SituacaoCar>>(() => new Set(SITUACOES_CAR.map((c) => c.id)));
  // 5.10: base do mapa e camada do CAR vêm das preferências da conta (ou do navegador)
  // e cada troca fica lembrada. Aplicadas uma vez, quando chegam do servidor.
  const { prefs, carregado: prefsCarregadas, salvar: salvarPrefs } = usePreferencias();
  const prefsAplicadasRef = useRef(false);
  useEffect(() => {
    if (!prefsCarregadas || prefsAplicadasRef.current) return;
    prefsAplicadasRef.current = true;
    setBase(prefs.mapa_base === "mapa" ? "ruas" : "satelite");
    if (!carEscolhido.current) setCarAtivo(prefs.camada_car);
  }, [prefsCarregadas, prefs.mapa_base, prefs.camada_car]);
  const [carSel, setCarSel] = useState<CarProps | null>(null);
  // Áudio do Carlos (27/11/2026, 13h14): no campo, pelo celular, fechar a
  // ficha no X apagava o contorno e a área sumia no meio das vizinhas verdes.
  // Agora o X fecha só a ficha: a área continua marcada até tocar em outra
  // (ou num ponto fora do CAR, ou desligar a camada).
  const [carFechado, setCarFechado] = useState<string | null>(null);
  const fecharCartaoCar = () => {
    setCarFechado(carSel?.cod ?? null); setCarSel(null);
    setNoPonto([]); setExtrasPonto(null);
  };
  const codigoSelecionado = carSel?.cod ?? carFechado;
  useEffect(() => {
    if (!codigoSelecionado || !pronto || !mapaPronto?.getSource("car")) return;
    const alvo = { source: "car", sourceLayer: "car", id: codigoSelecionado };
    mapaPronto.setFeatureState(alvo, { selecionado: true });
    return () => { if (mapaPronto.getSource("car")) mapaPronto.removeFeatureState(alvo, "selecionado"); };
  }, [codigoSelecionado, pronto, mapaPronto]);
  // camadas oficiais (SIGEF, embargos, ANM…): ligadas no painel, pedidas por janela
  const camadasRef = useRef<GerenciadorCamadasOficiais | null>(null);
  const [camadasAtivas, setCamadasAtivas] = useState<Set<CamadaOficialId>>(new Set());
  const camadasAtivasRef = useRef(camadasAtivas);
  const [areasCamadas, setAreasCamadas] = useState<AreaCamadas[]>([]);
  const [areaId, setAreaId] = useState("");
  const areaEscolhida = areasCamadas.find(a => a.id === areaId);
  const [pedidoRecorte, setPedidoRecorte] = useState(0);
  const sequenciaArea = useRef(0);
  const salvarArea = useCallback((geometria: GeoJSON.Polygon) => {
    const numero = ++sequenciaArea.current;
    const id = String(numero);
    setAreasCamadas(antes => [...antes, { id, nome: `Área ${numero}`, geometria, camadas: new Set(), car: false, relevo: new Set() }]);
    setAreaId(id);
    setGrupoCamadas("Fundiário");
    setPainelMapa("camadas");
  }, []);
  const areasCamadasRef = useRef(areasCamadas);
  useEffect(() => { areasCamadasRef.current = areasCamadas; }, [areasCamadas]);
  const camadasVisiveis = useMemo(() => new Set([...camadasAtivas, ...areasCamadas.flatMap(a => [...a.camadas])]), [camadasAtivas, areasCamadas]);
  const areasComCar = areasCamadas.filter(a => a.car).map(a => a.id).join(",");
  const geometriasCar = useEffectEvent(() => areasCamadas.filter(a => a.car).map(a => a.geometria));
  const carVisivel = carAtivo || !!areasComCar;
  const [estadoCamadas, setEstadoCamadas] = useState<Partial<Record<CamadaOficialId, EstadoCamada>>>({});
  const [noPonto, setNoPonto] = useState<FeicaoNoPonto[]>([]);
  // onde foi o último clique: o cartão "Neste ponto" oferece compartilhar esse ponto
  const [pontoClicado, setPontoClicado] = useState<{ lng: number; lat: number; zoom: number } | null>(null);
  const [extrasPonto, setExtrasPonto] = useState<ExtrasNoPonto | null>(null);
  const alternarSoVenda = useCallback((ligar: boolean) => {
    soVendaRef.current = ligar;
    setSoVenda(ligar);
    // cartões da cartografia rural fecham junto com ela
    if (ligar) { setCarSel(null); setCarFechado(null); setNoPonto([]); setExtrasPonto(null); }
    try { localStorage.setItem("arini:mapa-so-venda", ligar ? "1" : "0"); } catch { /* sem armazenamento */ }
  }, []);
  // pressão longa / botão direito em qualquer ponto: cartão mínimo "Neste ponto" (QA 09/11)
  const [pontoLivre, setPontoLivre] = useState<PontoLivre | null>(null);
  const alternarCamada = useCallback((id: CamadaOficialId) => {
    const nova = new Set(camadasAtivasRef.current);
    if (nova.has(id)) nova.delete(id); else nova.add(id);
    camadasAtivasRef.current = nova;
    setCamadasAtivas(nova);
  }, []);
  const alternarNaArea = (id: CamadaOficialId) => {
    if (!areaId) { alternarCamada(id); return; }
    setAreasCamadas(antes => antes.map(a => {
      if (a.id !== areaId) return a;
      const camadas = new Set(a.camadas);
      if (camadas.has(id)) camadas.delete(id); else camadas.add(id);
      return { ...a, camadas };
    }));
  };
  useEffect(() => {
    if (!pronto) return;
    camadasRef.current?.atualizarSelecao(camadasAtivas, areasCamadas);
  }, [pronto, camadasAtivas, areasCamadas]);
  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map) return;
    const dados: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: areasCamadas.map(a => ({ type: "Feature", geometry: a.geometria, properties: { selecionada: a.id === areaId } })),
    };
    const fonte = map.getSource("areas-camadas") as GeoJSONSource | undefined;
    if (fonte) { fonte.setData(dados); return; }
    if (!areasCamadas.length) return;
    map.addSource("areas-camadas", { type: "geojson", data: dados });
    map.addLayer({ id: "areas-camadas-divisas", source: "areas-camadas", type: "line",
      paint: { "line-color": ["case", ["get", "selecionada"], "#D9BD6F", "#F2F2EC"], "line-dasharray": [3, 2], "line-width": 2 } });
  }, [pronto, areasCamadas, areaId]);
  // relevo e água (itens 3 e 21 da segunda etapa): dados abertos, para qualquer plano
  const relevoRef = useRef<GerenciadorRelevo | null>(null);
  const [gerenteRelevo, setGerenteRelevo] = useState<GerenciadorRelevo | null>(null);
  const [relevoAtivas, setRelevoAtivas] = useState<Set<RelevoId>>(new Set());
  const relevoAtivasRef = useRef(relevoAtivas);
  const [estadoRelevo, setEstadoRelevo] = useState<EstadoRelevo>({});
  const [avisosRelevoLocal, setAvisosRelevoLocal] = useState<EstadoRelevo>({});
  const avisarRelevoLocal = useCallback((id: RelevoId, aviso: string) => {
    setAvisosRelevoLocal(antes => antes[id]?.aviso === aviso ? antes : { ...antes, [id]: { aviso } });
  }, []);
  const alternarRelevo = useCallback((id: RelevoId) => {
    const nova = new Set(relevoAtivasRef.current);
    if (nova.has(id)) nova.delete(id); else nova.add(id);
    relevoAtivasRef.current = nova;
    relevoRef.current?.alternar(id, nova.has(id));
    setRelevoAtivas(nova);
  }, []);
  const alternarRelevoNaArea = (id: RelevoId) => {
    if (!areaId) { alternarRelevo(id); return; }
    avisarRelevoLocal(id, "");
    setAreasCamadas(antes => antes.map(a => {
      if (a.id !== areaId) return a;
      const relevo = new Set(a.relevo);
      if (relevo.has(id)) relevo.delete(id); else relevo.add(id);
      return { ...a, relevo };
    }));
  };
  const recortesRelevo = useMemo(() => CAMADAS_RELEVO.map(c => ({
    id: c.id, areas: areasCamadas.filter(a => a.relevo.has(c.id)),
  })).filter(c => c.areas.length > 0 && !relevoAtivas.has(c.id)), [areasCamadas, relevoAtivas]);
  // camadas da base CARTO (as do tema): o resto é nosso e atravessa a troca de tema
  const baseEstiloRef = useRef<{ fontes: Set<string>; camadas: Set<string> } | null>(null);
  const estiloDeRuasRef = useRef<string | null>(null);
  const [carAviso, setCarAviso] = useState("");
  // barra de chips: menu "Mais" (celular) e a altura medida, para os painéis abrirem logo abaixo
  const maisAberto = painelMapa === "mais";
  const botaoMaisRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!painelMapa) return;
    const ancora = botaoMaisRef.current, area = areaMapaRef.current;
    const alinhar = () => {
      if (!maisAberto || !ancora || !area) return;
      const espaco = area.getBoundingClientRect().right - ancora.getBoundingClientRect().left - 188;
      ancora.style.setProperty("--menu-mais-x", Math.min(0, espaco) + "px");
    };
    alinhar();
    const obs = new ResizeObserver(alinhar);
    if (area) obs.observe(area);
    const fecharFora = (e: PointerEvent) => {
      if (maisAberto && !botaoMaisRef.current?.contains(e.target as Node)) setPainelMapa(null);
    };
    const escapar = (e: KeyboardEvent) => { if (e.key === "Escape") setPainelMapa(null); };
    document.addEventListener("pointerdown", fecharFora);
    document.addEventListener("keydown", escapar);
    return () => {
      obs.disconnect();
      document.removeEventListener("pointerdown", fecharFora);
      document.removeEventListener("keydown", escapar);
    };
  }, [painelMapa, maisAberto]);
  const chipsRef = useRef<HTMLFieldSetElement>(null);
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
  const camadaPedida = useSearchParams().get("camada");
  useEffect(() => {
    if (!camadaPedida) return;
    const oficial = camadaOficialPorId(camadaPedida);
    const relevo = CAMADAS_RELEVO.find(c => c.id === camadaPedida);
    if (oficial) {
      setGrupoCamadas(oficial.grupo);
      if (!camadasAtivasRef.current.has(oficial.id)) alternarCamada(oficial.id);
    } else if (relevo) {
      setGrupoCamadas("Relevo e água");
      if (!relevoAtivasRef.current.has(relevo.id)) alternarRelevo(relevo.id);
    } else if (camadaPedida === "car") {
      carEscolhido.current = true;
      setGrupoCamadas("Fundiário");
      setCarAtivo(true);
    } else if (camadaPedida === "planta") {
      setGrupoCamadas("Infraestrutura");
      setPlantaAtiva(true);
    } else return;
    setAreaId("");
    setPainelMapa("camadas");
  }, [camadaPedida, alternarCamada, alternarRelevo]);
  // desenho em curso (medir / consultar área): o clique é vértice, não abre cartão
  const desenhandoRef = useRef(false);
  // auditoria mobile 18/11: no celular, enquanto a pessoa desenha, a barra de chips,
  // o aviso do CAR e a aba da lista saem da frente (sobrava ~110 px de mapa para tocar)
  const [desenhando, setDesenhando] = useState(false);
  const aoDesenhar = useCallback((ativo: boolean) => { desenhandoRef.current = ativo; setDesenhando(ativo); }, []);
  // Imagem do ano (roadmap 3.8): satélite histórico no lugar do atual, ou lado a lado
  const [imagemAno, setImagemAno] = useState<string | null>(null);
  const [comparar, setComparar] = useState(false);
  const seletorAno = painelMapa === "ano";
  // busca por imagem (Revisão do Carlos, 29/10)
  const buscaImagem = painelMapa === "imagem";
  const buscaInputRef = useRef<HTMLInputElement>(null);
  const buscaNomeRuralRef = useRef<HTMLButtonElement>(null);
  const buscaUrbanaRef = useRef<HTMLButtonElement>(null);
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
    // Google: a imagem do ano SUBSTITUI o satélite, nunca fica por cima dele (termos do Google)
    if (SATELITE_GOOGLE) {
      map.setLayoutProperty("satelite", "visibility",
        !(img && !compararRef.current) && baseRef.current === "satelite" ? "visible" : "none");
    }
    if (!img || compararRef.current) return;
    const camadas = map.getStyle().layers;
    // acima também da camada de perto, senão ela cobriria a imagem do ano no zoom do lote
    const topo = DETALHES_SATELITE.filter(d=>map.getLayer(d.id)).at(-1)?.id ?? "satelite";
    const depois = camadas[camadas.findIndex((l) => l.id === topo) + 1]?.id;
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
      marcarLotesAVenda(map, features);
    }
    setLista(
      features
        .map((f) => f.properties as ImovelProps)
        .sort((a, b) => (a.status === "vendido" ? 1 : 0) - (b.status === "vendido" ? 1 : 0))
    );
  }, [filtrar]);

  const voarPara = useCallback((p: ImovelProps) => {
    setPainelMapa(null);
    setPainelAberto(false);
    setPredio(null);
    setSelecionado(p);
    mapRef.current?.flyTo({
      center: [p.lng, p.lat],
      zoom: p.tipo === "urbano" ? 16.5 : 13.8,
      pitch: 0,
      duration: 1400,
      essential: true,
    });
  }, []);

  /**
   * Prédio do anúncio clicado: as unidades (apartamento/sala) do mesmo imóvel
   * pai, mais as que estão no mesmo ponto do mapa (`vizinhos`), para o caso de
   * o anunciante não ter ligado a unidade ao prédio. Só vira "prédio" com duas
   * unidades ou mais, ou quando o próprio prédio foi clicado. Lotes de
   * loteamento não têm andar nem subtipo, então seguem abrindo o lote.
   */
  const predioDe = useCallback((id: string, vizinhos: string[]): Predio | null => {
    const todos = (dadosRef.current?.features ?? []).map((f) => f.properties as ImovelProps);
    const porId = new Map(todos.map((p) => [p.id, p]));
    const clicado = porId.get(id);
    if (!clicado) return null;
    const ehUnidade = (p: ImovelProps) => p.andar != null || !!p.subtipo;
    const chave = clicado.pai ?? (todos.some((p) => p.pai === clicado.id && ehUnidade(p)) ? clicado.id : null);
    const grupo = new Map<string, ImovelProps>();
    if (chave) for (const p of todos) if (p.pai === chave && ehUnidade(p)) grupo.set(p.id, p);
    if (ehUnidade(clicado)) {
      grupo.set(clicado.id, clicado);
      for (const v of vizinhos) {
        const p = porId.get(v);
        if (p && ehUnidade(p)) grupo.set(p.id, p);
      }
    }
    const unidades = [...grupo.values()];
    const clicouNoPredio = chave === clicado.id;
    if (unidades.length < 2 && !(clicouNoPredio && unidades.length)) return null;
    const comPai = unidades.find((u) => u.pai_codigo);
    return {
      codigo: clicouNoPredio ? clicado.codigo : comPai?.pai_codigo ?? null,
      titulo: clicouNoPredio ? clicado.titulo : comPai?.pai_titulo ?? "Prédio",
      unidades: unidades.map((u) => ({
        id: u.id, codigo: u.codigo, titulo: u.titulo, status: u.status, valor: u.valor, area_m2: u.area_m2,
        capa: u.capa, andar: u.andar ?? null, unidade: u.unidade ?? null, subtipo: u.subtipo ?? null,
      })),
    };
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
        style: FUNDO_SATELITE,
        center: CENTRO_REGIAO,
        zoom: ZOOM_INICIAL_REGIONAL,
        // abaixo do zoom 4 o satélite pede dezenas de tiles do mundo inteiro e
        // o mapa parece "quebrado" enquanto carrega; o produto é o Brasil
        minZoom: 4,
        maxBounds: LIMITES_MAPA_REGIONAL,
        hash: "pos", // posição na URL → link compartilhável, estilo Google Maps
        fadeDuration: 150,
        // 17/11/2026: tiles do CAR saem com max-age=30 (recortes urbanos) e os de
        // reserva do satélite com 300 s; com o padrão (true) o MapLibre baixava
        // de novo, a cada 30 s, todos os tiles do CAR na tela. Vencido, o tile
        // é renovado quando volta a ser pedido, sem recarga contínua.
        refreshExpiredTiles: false,
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
      // auditoria mobile 18/11: o crédito das fontes nascia aberto e cobria uma faixa
      // de ~70 px logo acima das ferramentas; no celular ele começa fechado (o "i" abre)
      if (window.matchMedia("(max-width: 639px)").matches) {
        const fecharCredito = () => map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
        map.once("load", fecharCredito);
        map.once("idle", fecharCredito);
      }

      const popup = new maplibregl.Popup({
        closeButton: false, closeOnClick: false, offset: 14, maxWidth: "260px",
      });
      popupRef.current = popup;

      map.once("style.load", async () => {
        baseEstiloRef.current = { fontes: new Set(), camadas: new Set(["fundo-satelite"]) };
        estiloDeRuasRef.current = null;
        // satélite fica acima da base vetorial e abaixo das camadas de dados
        map.addSource("satelite", SATELITE);
        // 17/11/2026 (item 14 do Carlos): satélite um pouco mais saturado e contrastado, menos "lavado"
        map.addLayer({ id: "satelite", type: "raster", source: "satelite", layout: { visibility: baseRef.current === "satelite" ? "visible" : "none" },
          // com o Google, a foto vai como ele entrega (sem retoque de cor)
          paint: SATELITE_GOOGLE ? {} : { "raster-saturation": 0.18, "raster-contrast": 0.08 } });
        map.addSource("mosaico-anual", MOSAICO_MENOS_NUVENS);
        // por cima do satélite normal e só até o z13: de perto, a foto de detalhe assume
        map.addLayer({ id: "mosaico-anual", type: "raster", source: "mosaico-anual", maxzoom: ZOOM_MOSAICO_ATE,
          layout: { visibility: "none" }, paint: { "raster-saturation": 0.2, "raster-contrast": 0.12, "raster-brightness-min": 0.02 } });
        for (const detalhe of DETALHES_SATELITE) {
          map.addSource(detalhe.id, detalhe.fonte);
          map.addLayer(camadaDeDetalhe(detalhe, baseRef.current==="satelite"));
        }
        aplicarHistorico();

        const falhas: string[] = [];
        const semFeicoes: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        async function carregar<T>(rota: string, nome: string, reserva: T): Promise<T> {
          try {
            const r = await fetch(rota);
            if (!r.ok) throw Error(String(r.status));
            return await r.json() as T;
          } catch {
            falhas.push(nome);
            return reserva;
          }
        }
        const [municipios, imoveis, cartografia] = await Promise.all([
          carregar("/api/geo/municipios", "municípios", semFeicoes),
          carregar("/api/geo/imoveis", "imóveis à venda", semFeicoes),
          carregar<Camada[]>("/api/geo/cartografia", "plantas urbanas", []),
        ]);
        if (cancelado) return;
        if (falhas.length) setAvisoCarga(`Falha ao carregar ${falhas.join(", ")}. Atualize a página para tentar novamente.`);
        dadosRef.current = imoveis;
        municipiosRef.current = municipios;

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
            visibility: podeTerceirosRef.current ? "visible" : "none",
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
            visibility: podeTerceirosRef.current ? "visible" : "none",
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

        // lote da planta à venda: dourado, como a fazenda à venda (filtro em marcarLotesAVenda)
        const nenhum = ["in", ["get", "id"], ["literal", [] as string[]]] as never;
        map.addLayer({
          id: "lotes-venda-fill", type: "fill", source: "lotes", "source-layer": "lotes", minzoom: LOTE_ZOOM_MIN,
          filter: nenhum, paint: { "fill-color": "#D9BD6F", "fill-opacity": 0.38 },
        });
        map.addLayer({
          id: "lotes-venda-contorno", type: "line", source: "lotes", "source-layer": "lotes", minzoom: LOTE_ZOOM_MIN,
          filter: nenhum, layout: { "line-join": "round" },
          paint: { "line-color": "#1A1405", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 4, 17, 6, 19, 8] as never, "line-opacity": 0.85 },
        });
        map.addLayer({
          id: "lotes-venda-borda", type: "line", source: "lotes", "source-layer": "lotes", minzoom: LOTE_ZOOM_MIN,
          filter: nenhum, layout: { "line-join": "round" },
          paint: { "line-color": "#F2C94C", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 2.2, 17, 3.5, 19, 5] as never },
        });
        marcarLotesAVenda(map, imoveis.features ?? []);

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
            // 17/11 (áudio do Carlos, 11h08): a área clicada fica limpa por dentro,
            // só com o contorno da cor de seleção (camada car-selecao)
            "fill-opacity": ["case", ["boolean", ["feature-state", "selecionado"], false], 0, ["boolean", ["feature-state", "hover"], false], 0.2, 0.07] as never,
          },
        });
        // o traço afina conforme afasta: de longe a malha vira textura, de perto vira divisa
        map.addLayer({
          id: "car-linha", type: "line", source: "car", "source-layer": "car", minzoom: CAR_ZOOM_MIN,
          paint: {
            "line-color": COR_RURAL,
            // 17/11: mais grosso e opaco (pedido do Carlos: linhas visíveis como no Geomart)
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 10, 1, 12, 1.6, 15, 2.6] as never,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.7, 10, 0.9, 12, 1] as never,
          },
        });
        // contorno da área selecionada: amarelo de seleção, grosso, com o interior limpo
        map.addLayer({
          id: "car-selecao", type: "line", source: "car", "source-layer": "car", minzoom: CAR_ZOOM_MIN,
          paint: {
            "line-color": COR_SELECAO_CAR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 2, 12, 3, 15, 4] as never,
            "line-opacity": ["case", ["boolean", ["feature-state", "selecionado"], false], 1, 0] as never,
          },
        });

        map.addSource("imoveis", { type: "geojson", data: imoveis, promoteId: "id" });
        map.addLayer({
          id: "imoveis-fill", type: "fill", source: "imoveis",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": CORES_MATCH as never,
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.5, 0.24] as never,
          },
        });
        // 23/11 (Carlos): a divisa do imóvel à venda precisa ter presença sobre a
        // malha verde. Traço cheio e grosso, com um contorno escuro por baixo
        // (como na planta urbana), que segura o contraste em qualquer fundo.
        map.addLayer({
          id: "imoveis-contorno", type: "line", source: "imoveis",
          filter: ["==", ["geometry-type"], "Polygon"],
          layout: { "line-join": "round" },
          paint: {
            "line-color": "#1A1405",
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5.5, 14, 7.5, 17, 9.5] as never,
            "line-opacity": 0.9,
            "line-blur": 0.3,
          },
        });
        map.addLayer({
          id: "imoveis-linha", type: "line", source: "imoveis",
          filter: ["==", ["geometry-type"], "Polygon"],
          layout: { "line-join": "round" },
          paint: {
            "line-color": CORES_MATCH as never,
            "line-width": ["interpolate", ["linear"], ["zoom"],
              10, ["case", ["boolean", ["feature-state", "hover"], false], 4, 2.6],
              14, ["case", ["boolean", ["feature-state", "hover"], false], 5.5, 3.6],
              17, ["case", ["boolean", ["feature-state", "hover"], false], 6.5, 4.6]] as never,
            "line-opacity": 1,
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
        // quadra e número do lote à venda, para qualquer visitante (25/11/2026, Stenio):
        // vêm do anúncio (informados no cadastro ou lidos da planta)
        map.addLayer({
          id: "lotes-venda-rotulo", type: "symbol", source: "imoveis-centros", minzoom: 16,
          filter: ["any", ["has", "lote_numero"], ["has", "lote_quadra"]],
          layout: {
            "text-field": ["case",
              ["all", ["has", "lote_numero"], ["has", "lote_quadra"]],
              ["format", "Lote ", {}, ["get", "lote_numero"], {}, "\nQuadra ", { "font-scale": 0.8 }, ["get", "lote_quadra"], { "font-scale": 0.8 }],
              ["has", "lote_numero"], ["concat", "Lote ", ["get", "lote_numero"]],
              ["concat", "Quadra ", ["get", "lote_quadra"]]] as never,
            "text-font": ["Open Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 16, 11, 19, 15],
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#FFE299", "text-halo-color": "rgba(10,19,16,0.95)", "text-halo-width": 1.8 },
        });
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

        // Respeita a câmera recebida por URL. Sem ela, enquadra a região uma
        // vez, inclusive quando uma geometria municipal tem muitos vértices.
        if (!entrada.includes("pos=")) {
          const limites = new maplibregl.LngLatBounds();
          function incluir(coordenadas: GeoJSON.Position[][]) {
            for (const anel of coordenadas) {
              for (const [lng, lat] of anel) limites.extend([lng, lat]);
            }
          }
          for (const { geometry } of municipios.features) {
            if (geometry?.type === "Polygon") incluir(geometry.coordinates);
            if (geometry?.type === "MultiPolygon") geometry.coordinates.forEach(incluir);
          }
          if (!limites.isEmpty()) map.fitBounds(limites,
            { padding: { top: 40, bottom: 40, left: 380, right: 40 }, duration: 0 }
          );
        }

        // interações
        const aoClicar = (e: MapLayerMouseEvent) => {
          if (desenhandoRef.current) return;
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as unknown as ImovelProps;
          // tudo o que está sob o dedo (folga de 10 px: no celular o toque é largo)
          const { x, y } = e.point;
          const camadas = ["imoveis-fill", "imoveis-ponto", "imoveis-marcador"].filter((l) => map.getLayer(l));
          const vizinhos = map.queryRenderedFeatures([[x - 10, y - 10], [x + 10, y + 10]], { layers: camadas })
            .map((v) => String((v.properties as { id?: string })?.id ?? ""));
          const pr = predioDe(p.id, vizinhos);
          if (pr) {
            setPainelMapa(null);
            setPainelAberto(false);
            setSelecionado(null);
            setPredio(pr);
            return;
          }
          voarPara(p);
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
          if (f) { setCarFechado(null); setCarSel(f.properties as unknown as CarProps); }
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
        // a escolha "só à venda" fica lembrada neste navegador
        try { if (localStorage.getItem("arini:mapa-so-venda") === "1") setSoVenda(true); } catch { /* sem armazenamento */ }
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
        // relevo e água: nada é baixado até alguém ligar uma camada no painel
        relevoRef.current = new GerenciadorRelevo(map, setEstadoRelevo, tema);
        setGerenteRelevo(relevoRef.current);
        relevoRef.current.mudarBase(baseRef.current);
        relevoAtivasRef.current.forEach((id) => relevoRef.current?.alternar(id, true));
        // clique: reúne no cartão tudo o que as camadas ligadas têm no ponto;
        // fora do CAR, o cartão do imóvel rural fecha (não fica um de outro lugar)
        map.on("click", (e) => {
          if (desenhandoRef.current) return;
          const oficiais = camadasRef.current?.noPonto(e.point) ?? [];
          setNoPonto(oficiais);
          setExtrasPonto({
            lng: e.lngLat.lng, lat: e.lngLat.lat,
            relevo: [...relevoAtivasRef.current].some((id) => id !== "hidrografia"),
            ambiente: ambienteNoPonto(map, e.lngLat.lng, e.lngLat.lat),
          });
          setPontoClicado({ lng: e.lngLat.lng, lat: e.lngLat.lat, zoom: map.getZoom() });
          const carLocal = map.getLayer("car-areas-fill") && map.queryRenderedFeatures(e.point, { layers: ["car-areas-fill"] })[0];
          const noCar = carLocal || (!!map.getLayer("car-fill") && map.getLayoutProperty("car-fill", "visibility") !== "none"
            && map.queryRenderedFeatures(e.point, { layers: ["car-fill"] }).length > 0);
          if (carLocal && !map.queryRenderedFeatures(e.point, { layers: ["imoveis-fill", "imoveis-ponto"] }).length) {
            setCarFechado(null); setCarSel(carLocal.properties as unknown as CarProps);
          }
          if (!noCar) { setCarSel(null); setCarFechado(null); }
          // o cartão do clique abre no mesmo canto do painel de camadas: o painel cede a vez
          setPainelMapa(null);
          setAvisoPlano("");
        });

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
    if (!map || !pronto || !baseEstiloRef.current) return;
    relevoRef.current?.mudarTema(tema);
    const alvo = base === "ruas" ? ESTILO_RUAS[tema] : null;
    if (estiloDeRuasRef.current === alvo) return;
    const pedido = new AbortController();
    async function trocar() {
      let novo: StyleSpecification = FUNDO_SATELITE;
      if (alvo) {
        const resposta = await fetch(alvo, { signal: pedido.signal });
        if (!resposta.ok) throw new Error("Base cartográfica indisponível");
        novo = await resposta.json();
      }
      if (pedido.signal.aborted || !map) return;
      map.setStyle(novo, {
        transformStyle: (anterior, nova) => {
          const anteriorBase = baseEstiloRef.current;
          if (!anterior || !anteriorBase) return nova;
          baseEstiloRef.current = { fontes: new Set(Object.keys(nova.sources)), camadas: new Set(nova.layers.map(l => l.id)) };
          const fontes = Object.fromEntries(Object.entries(anterior.sources).filter(([id]) => !anteriorBase.fontes.has(id)));
          const camadas = anterior.layers.filter(l => !anteriorBase.camadas.has(l.id));
          return { ...nova, sources: { ...nova.sources, ...fontes }, layers: [...nova.layers, ...camadas] };
        },
      });
      estiloDeRuasRef.current = alvo;
    }
    void trocar().catch(() => {
      if (!pedido.signal.aborted) {
        setBase("satelite");
        setAvisoCarga("A base de ruas está indisponível. Tente novamente em instantes.");
      }
    });
    return () => pedido.abort();
  }, [base, tema, pronto]);

  // base ruas/satélite (a planta da cidade muda de cor para continuar legível)
  useEffect(() => {
    baseRef.current = base; // planta que chegar depois já nasce na cor certa
    const map = mapRef.current;
    if (!map || !pronto || !map.getLayer("satelite")) return;
    // com o mosaico ligado o detalhe continua por baixo: é ele que aparece do z14 para perto
    const mostrarDetalhe = base === "satelite";
    const historicoNoLugar = SATELITE_GOOGLE && !!imagemHistoricaPorId(imagemAnoRef.current) && !compararRef.current;
    map.setLayoutProperty("satelite", "visibility", mostrarDetalhe && !historicoNoLugar ? "visible" : "none");
    if (map.getLayer("mosaico-anual")) {
      map.setLayoutProperty("mosaico-anual", "visibility", base === "satelite" && mosaicoAnual ? "visible" : "none");
    }
    for (const {id} of DETALHES_SATELITE) {
      if (map.getLayer(id)) map.setLayoutProperty(id,"visibility",mostrarDetalhe ? "visible" : "none");
    }
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
  }, [base, pronto, mosaicoAnual]);

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
    const map = mapRef.current;
    if (!map || !pronto || !map.getLayer("car-fill")) return;
    // Sem filtro quando todas estão ligadas. Feição sem situação (tiles enxutos
    // de longe) continua sempre visível.
    const filtro = situacoesCar.size === SITUACOES_CAR.length ? null
      : ["in", CATEGORIA_CAR, ["literal", [...situacoesCar, "outros"]]];
    for (const id of ["car-fill", "car-linha", "car-selecao"]) map.setFilter(id, filtro as never);
  }, [pronto, situacoesCar]);
  useEffect(() => {
    carAtivoRef.current = carVisivel;
    const map = mapRef.current;
    if (!map || !pronto || !map.getLayer("car-fill")) return;
    for (const id of ["car-fill", "car-linha", "car-selecao"]) map.setLayoutProperty(id, "visibility", carAtivo && !soVenda ? "visible" : "none");
    if (carVisivel && !soVenda) { conferirZoomCar(); garantirCarSobDemanda(); }
    else { setCarSel(null); setCarFechado(null); setCarAviso(""); }
  }, [carAtivo, carVisivel, soVenda, pronto, conferirZoomCar, garantirCarSobDemanda]);

  // "Só à venda": esconde toda camada rural, inclusive as que forem ligadas
  // depois (o gerenciador de camadas e o de relevo criam as deles sob demanda),
  // e devolve ao voltar para a cartografia geral.
  useEffect(() => {
    soVendaRef.current = soVenda;
    const map = mapRef.current;
    if (!map || !pronto) return;
    const escondidas = new Set<string>();
    const ocultar = () => {
      for (const l of map.getStyle()?.layers ?? []) {
        // as camadas "-leitura" são transparentes: só servem para ler os tiles
        if (l.id.endsWith("-leitura") || !PREFIXOS_CARTO_RURAL.some((p) => l.id.startsWith(p))) continue;
        if (map.getLayoutProperty(l.id, "visibility") === "none") continue;
        map.setLayoutProperty(l.id, "visibility", "none");
        escondidas.add(l.id);
      }
    };
    if (!soVenda) return;
    ocultar();
    map.on("styledata", ocultar);
    return () => {
      map.off("styledata", ocultar);
      // Volta só o que continua ligado: quem foi desligado no painel durante o
      // "só à venda" fica desligado. A malha do CAR volta pelo efeito dela.
      const oficiais = new Set([...camadasAtivasRef.current, ...areasCamadasRef.current.flatMap((a) => [...a.camadas])]);
      const relevoLigado = new Set([...relevoAtivasRef.current].flatMap(camadasDeRelevo));
      for (const id of escondidas) {
        if (!map.getLayer(id) || id === "car-fill" || id === "car-linha" || id === "car-selecao") continue;
        const oficial = /^of-(.+)-(fill|linha|ponto|traco)$/.exec(id)?.[1];
        if (oficial && !oficiais.has(oficial as CamadaOficialId)) continue;
        if (id.startsWith("relevo-") && !id.endsWith("-local") && !relevoLigado.has(id)) continue;
        map.setLayoutProperty(id, "visibility", "visible");
      }
    };
  }, [soVenda, pronto]);

  useEffect(() => {
    if (pronto && mapRef.current && !carAtivo && areasComCar) return exibirCarNasAreas(mapRef.current, geometriasCar(), setCarAviso);
  }, [pronto, carAtivo, areasComCar]);

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
    const j = await fetch(`/api/geo/municipio-busca?cod=${cod}&malha=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as
      { bbox?: [number, number, number, number]; geometria?: GeoJSON.Geometry | null } | null;
    if (!j?.bbox) { setBuscaAviso("O IBGE não respondeu agora. Tente de novo em instantes."); return; }
    const [w, s, e, n] = j.bbox;
    const map = mapRef.current;
    if (!map) return;
    marcarMunicipio(map, j.geometria ?? null);
    map.fitBounds([[w, s], [e, n]], { padding: 60, duration: 1200 });
  }, []);

  // Busca do topo do site (áudio do Carlos, 18/11/2026, 16h20): "/mapa?municipio=<IBGE>&nome=…"
  // abre o mapa já enquadrado no município, com o nome na caixa de busca.
  const parametros = useSearchParams();
  const municipioPedido = Number(parametros.get("municipio")) || 0;
  const nomePedido = parametros.get("nome") ?? "";
  const municipioAplicado = useRef(0);
  useEffect(() => {
    if (!pronto || !municipioPedido || municipioAplicado.current === municipioPedido) return;
    municipioAplicado.current = municipioPedido;
    if (nomePedido) setBusca(nomePedido);
    void irParaMunicipioIbge(municipioPedido);
  }, [pronto, municipioPedido, nomePedido, irParaMunicipioIbge]);

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

  /** A API usa o perímetro local ou busca o imóvel por código no SICAR. */
  const abrirCar = useCallback(async (cod: string) => {
    setBuscaAviso("Procurando o imóvel no CAR…");
    const resposta = await fetch(`/api/geo/car/${encodeURIComponent(cod)}`).catch(() => null);
    const f = resposta?.ok ? await resposta.json().catch(() => null) as
      { geometry?: GeoJSON.Geometry; properties?: Partial<CarProps> } | null : null;
    if (!f?.geometry) {
      setBuscaAviso(resposta?.status === 404 ? "Código não encontrado no CAR." : "Não foi possível consultar o CAR. Tente novamente.");
      setPainelAberto(true);
      return;
    }
    setBuscaAviso("");
    const [oeste, sul, leste, norte] = bbox(f.geometry);
    mapRef.current?.fitBounds([[oeste, sul], [leste, norte]], { padding: 80, duration: 1200 });
    setCarAtivo(true);
    setCarFechado(null);
    setCarSel({
      cod, area_ha: f.properties?.area_ha ?? null, condicao: f.properties?.condicao ?? null,
      status: f.properties?.status ?? null, tipo: f.properties?.tipo ?? null, municipio: f.properties?.municipio ?? null,
    });
  }, []);

  /**
   * Parcela do SIGEF por código da certificação, CCIR ou matrícula (ideia do
   * Geomart, 11/11): procura nas UFs da tela, desenha as parcelas achadas em
   * azul (a cor da camada SIGEF) e enquadra.
   */
  const abrirSigef = useCallback(async (campo: "parcela" | "ccir" | "matricula", valor: string) => {
    const map = mapRef.current;
    if (!map) return;
    setBuscaAviso("Procurando no SIGEF do INCRA…");
    const b = map.getBounds();
    const qs = new URLSearchParams({ tipo: campo, valor, bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(",") });
    const r = await fetch(`/api/geo/sigef/busca?${qs}`).catch(() => null);
    const j = r ? await r.json().catch(() => null) as {
      parcelas?: { nome: string; matricula: string; codigoIncra: string; parcela: string; geometria: GeoJSON.MultiPolygon }[];
      ufs?: string[]; error?: string;
    } | null : null;
    if (!r?.ok || !j?.parcelas) { setBuscaAviso(j?.error ?? "O SIGEF do INCRA não respondeu agora. Tente de novo em instantes."); return; }
    if (!j.parcelas.length) {
      setBuscaAviso(`Nada encontrado no SIGEF em ${j.ufs?.join(", ") || "nenhum estado"}. A busca olha os estados da tela: leve o mapa até o estado do imóvel e tente de novo.`);
      return;
    }
    const dado: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: j.parcelas.map((p) => ({ type: "Feature", geometry: p.geometria, properties: { nome: p.nome, matricula: p.matricula } })),
    };
    const fonte = map.getSource("busca-sigef") as GeoJSONSource | undefined;
    if (fonte) fonte.setData(dado);
    else {
      map.addSource("busca-sigef", { type: "geojson", data: dado });
      map.addLayer({ id: "busca-sigef-fill", type: "fill", source: "busca-sigef", paint: { "fill-color": CORES_RURAIS.sigef, "fill-opacity": 0.18 } });
      map.addLayer({ id: "busca-sigef-linha", type: "line", source: "busca-sigef", paint: { "line-color": CORES_RURAIS.sigef, "line-width": 3 } });
    }
    const coords: number[][] = j.parcelas.flatMap((p) => p.geometria.coordinates.flat(2));
    const lngs = coords.map((c) => c[0]), lats = coords.map((c) => c[1]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, duration: 1200 });
    setBuscaAviso(j.parcelas.map((p) =>
      `${p.nome}${p.matricula ? ` · matrícula ${p.matricula}` : ""}${p.codigoIncra ? ` · INCRA ${p.codigoIncra}` : ""}`).join(" | ") + " (fonte: INCRA/SIGEF)");
  }, []);

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
    else if (b.tipo === "sigef") escolherSugestao(() => void abrirSigef(b.campo, b.valor));
    else if (municipioSugerido) escolherSugestao(irParaMunicipio);
    else if (municipiosBrasil[0] && norm(municipiosBrasil[0].nome).includes(norm(busca.trim()))) { const cod = municipiosBrasil[0].cod; escolherSugestao(() => void irParaMunicipioIbge(cod)); }
    else if (/^(?:fazenda|sitio|chacara|gleba|estancia|rancho)\b/.test(norm(busca))) buscaNomeRuralRef.current?.click();
    else buscaUrbanaRef.current?.click();
  };

  const irParaMunicipio = useCallback(() => {
    if (!municipioSugerido) return;
    const coords: [number, number][] = [];
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    walk((municipioSugerido.geometry as GeoJSON.Polygon).coordinates);
    if (mapRef.current) marcarMunicipio(mapRef.current, municipioSugerido.geometry as GeoJSON.Geometry);
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
      setCarSel(null); setCarFechado(null); setNoPonto([]); setPainelMapa(null);
      if (loteSel) { setLoteSel(null); mapRef.current?.removeFeatureState({ source: "lotes", sourceLayer: "lotes" }); }
      setPontoLivre(p);
    },
    aoClicar: () => setPontoLivre(null),
  });

  /** Escolheu uma sugestão da busca: o voo já aconteceu, o texto não filtra mais a lista. */
  const escolherSugestao = (acao: () => void, manterPonto = false) => {
    acao();
    setPainelAberto(false);
    setPainelMapa(null);
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
  // Com "só à venda", os controles mostram a cartografia rural desligada. Ligar
  // qualquer item dela volta para a cartografia geral (sem desligar o que já
  // estava ligado por baixo).
  const SEM_OFICIAIS = useMemo(() => new Set<CamadaOficialId>(), []);
  const SEM_RELEVO = useMemo(() => new Set<RelevoId>(), []);
  const ligarCarNoSoVenda = () => { alternarSoVenda(false); if (!carAtivo) { carEscolhido.current = true; setCarAtivo(true); void salvarPrefs({ camada_car: true }); } };
  function naCartografia<T>(id: T, ligada: boolean, alternar: (id: T) => void) {
    if (!soVenda) return alternar(id);
    alternarSoVenda(false);
    if (!ligada) alternar(id);
  }
  const chipBase = "chip inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-medium whitespace-nowrap shadow-[0_8px_24px_-12px_rgb(0_0_0/0.7)] backdrop-blur-md";

  const mosaicoAtivo = base === "satelite" && mosaicoAnual;
  // 18/11/2026 (Stenio: "não consigo ativar ou desativar"): o chip agora liga E desliga.
  // Antes o segundo clique repetia o "ligar" e nada mudava; e, de perto (z14+), o mosaico
  // não aparece por desenho, então ligar ali parecia não fazer nada. Agora avisa.
  const AVISO_MOSAICO_PERTO = "O mosaico com menos nuvens aparece na visão regional. Afaste o zoom para vê-lo.";
  const alternarMosaico = () => {
    if (mosaicoAtivo) {
      setMosaicoAnual(false);
      setAvisoCarga((a) => (a === AVISO_MOSAICO_PERTO ? "" : a));
      return;
    }
    setBase("satelite"); setMosaicoAnual(true); setImagemAno(null); setComparar(false);
    if ((mapRef.current?.getZoom() ?? 0) >= ZOOM_MOSAICO_ATE) {
      setAvisoCarga(AVISO_MOSAICO_PERTO);
      setTimeout(() => setAvisoCarga((a) => (a === AVISO_MOSAICO_PERTO ? "" : a)), 6000);
    }
  };
  const chipsSecundarios = (
    <>
      {/* no celular o mosaico sai da barra (eram 4 linhas de chips) e vem para o Mais */}
      {/* com o Google não há nuvem a contornar, e o mosaico por cima misturaria fontes */}
      {!SATELITE_GOOGLE && <button type="button" className={`${chipBase} sm:hidden`} data-ativo={mosaicoAtivo} aria-pressed={mosaicoAtivo}
        onClick={() => { alternarMosaico(); setPainelMapa(null); }}>
        Mosaico com menos nuvens
      </button>}
      <button onClick={() => setPainelMapa("imagem")} data-ativo={buscaImagem} className={chipBase}
        title="Encontre o local por uma foto com GPS, um print de mapa, um croqui ou um documento">
        <ImageUp className="size-3.5" /> Buscar por imagem
      </button>
      <button
        onClick={() => {
          if (!liberado("camadas_oficiais")) {
            setPainelMapa(null);
            setAvisoPlano(logado
              ? "As imagens históricas fazem parte da consulta profissional e não estão no seu plano."
              : "Entre na sua conta para ver as imagens históricas.");
            return;
          }
          setPainelMapa("ano");
        }}
        data-ativo={!!imagemAno || seletorAno} className={chipBase}
        title="Imagens de satélite de anos anteriores (Esri Wayback e Sentinel-2)">
        {liberado("camadas_oficiais") ? <History className="size-3.5" /> : <Lock className="size-3.5" />} {imagemAno ? `Imagem de ${imagemHistoricaPorId(imagemAno)?.ano}` : "Imagem do ano"}
      </button>
      <button onClick={() => { setPlantaAtiva(!plantaAtiva); setPainelMapa(null); }} data-ativo={plantaAtiva} className={chipBase}
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
        <div className="max-h-[78dvh] overflow-y-auto p-4 space-y-3 border-b border-linha">
          <form role="search" className="relative" onSubmit={(e) => { e.preventDefault(); confirmarBusca(); }}>
            <input ref={buscaInputRef} data-tour="busca" value={busca} onChange={(e) => { setBusca(e.target.value); setBuscaAviso(""); }}
              aria-label="Buscar imóvel, rua, bairro, quadra, lote, município, CAR ou coordenada"
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
          {buscaLida.tipo === "sigef" && (
            <button onClick={() => escolherSugestao(() => void abrirSigef(buscaLida.campo, buscaLida.valor))}
              className="flex w-full items-center justify-between gap-2 text-left text-sm rounded-full border border-verde/25 bg-verde/12 text-verde px-3.5 py-2.5 hover:bg-verde/20 transition">
              <span className="min-w-0">Procurar no SIGEF ({buscaLida.rotulo})
                <strong className="block truncate font-mono text-[11px]">{buscaLida.valor}</strong>
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
          {buscaLida.tipo === "texto" && busca.trim().length >= 3 && (
            <BuscaUrbana botao={buscaUrbanaRef} key={busca.trim()} termo={busca.trim()} centro={() => mapRef.current?.getCenter()}
              abrir={(lng,lat) => escolherSugestao(() => irParaPonto(lat,lng), true)} />
          )}
          <CompararParcelasRurais mapa={mapaPronto} botao={buscaNomeRuralRef} verMapa={() => setPainelAberto(false)}
            termo={buscaLida.tipo === "texto" ? busca.trim() : ""}
            municipios={buscaLida.tipo === "texto" && busca.trim().length >= 3 ?
              municipiosBrasil.filter(m=>norm(m.nome).includes(norm(busca.trim()))).slice(0,3) : []} />
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
        onClick={() => { setPainelMapa(null); setPainelAberto(!painelAberto); }}
        title={painelAberto ? "Recolher lista" : "Mostrar lista"}
        className={
          (painelAberto ? "z-30 " : "z-30 max-sm:z-[5] ") + (desenhando ? "max-sm:hidden " : "") +
          "absolute top-1/2 -translate-y-1/2 bg-superficie border border-l-0 border-linha-forte shadow-lg rounded-r-[10px] w-7 h-14 flex items-center justify-center text-texto-2 hover:text-verde transition-all duration-300 " +
          (painelAberto ? "left-[85%] sm:left-[320px]" : "left-0")
        }>
        {painelAberto ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      {/* ---------- mapa ---------- */}
      <div ref={areaMapaRef} className={`area-mapa relative flex-1 min-w-0 ${CAMADAS_OFICIAIS.some((c) => camadasAtivas.has(c.id)) ? ALTURA_FAIXA : ""}`}>
        {/* inline: o CSS do maplibre força position:relative na classe e colapsaria a altura */}
        <div ref={containerRef} style={{ position: "absolute", inset: "0 0 var(--faixa, 0px) 0" }} />
        <ResumoCamadas ativas={camadasAtivas} estado={estadoCamadas} />

        {/* Barra do mapa (QA 09/11): antes era uma fila só com rolagem lateral e, em
            1366 px ou no celular, "Não encontrei meu imóvel", Satélite/Mapa e Camadas
            sumiam para fora da tela. Agora os de prioridade vêm primeiro e a barra
            QUEBRA em linhas; no celular o resto vai para o menu "Mais". A altura real
            da barra vira --abaixo-chips, e os painéis abrem logo abaixo dela. */}
        <fieldset ref={chipsRef} aria-label="Controles do mapa" disabled={!interativo} aria-busy={!interativo}
          className={`absolute top-3 left-3 right-14 z-20 flex min-w-0 flex-wrap items-start gap-2 disabled:opacity-60 ${desenhando || painelAberto ? "max-sm:hidden" : ""}`}>
          {/* requisitos cartográficos §2.1 + Revisão do Carlos (29/10): "Não encontrei
              meu imóvel" precisa ser fácil de achar — fica em dourado, logo no começo */}
          <button
            onClick={irParaSolicitacao}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#D9BD6F] px-4 py-2 text-xs font-bold text-[#124431] shadow-[0_8px_24px_-12px_rgb(0_0_0/0.7)] ring-1 ring-[#124431]/20 transition hover:brightness-105"
            title="Informar um imóvel ausente ou uma divergência do mapa à equipe de cartografia">
            <Flag className="size-3.5" /> Não encontrei meu imóvel
          </button>
          {(["satelite", "ruas"] as const).map((b) => (
            <button key={b} onClick={() => { setMosaicoAnual(false); setBase(b); void salvarPrefs({ mapa_base: b === "ruas" ? "mapa" : "satelite" }); }} data-ativo={base === b && (b === "ruas" || !mosaicoAnual)} className={`${chipBase} max-sm:hidden`}>
              {b === "ruas" ? "Mapa" : "Satélite"}
            </button>
          ))}
          {/* celular: um chip só, que troca entre satélite e mapa de ruas */}
          <button type="button" className={`${chipBase} sm:hidden`}
            aria-label={base === "ruas" ? "Trocar para satélite" : "Trocar para mapa de ruas"}
            onClick={() => { const b = base === "ruas" ? "satelite" : "ruas"; setMosaicoAnual(false); setBase(b); void salvarPrefs({ mapa_base: b === "ruas" ? "mapa" : "satelite" }); }}>
            {base === "ruas" ? <><Satellite className="size-3.5" /> Satélite</> : <><MapaIcone className="size-3.5" /> Mapa</>}
          </button>
          {/* 23/11 (Carlos): alternar cartografia geral × só imóveis à venda, em qualquer plano */}
          <div role="group" aria-label="O que mostrar no mapa" className="inline-flex overflow-hidden rounded-full shadow-[0_8px_24px_-12px_rgb(0_0_0/0.7)]">
            <button type="button" onClick={() => alternarSoVenda(false)} data-ativo={!soVenda} aria-pressed={!soVenda}
              className={`${chipBase} rounded-r-none! shadow-none!`} title="Mostrar toda a cartografia: CAR, camadas oficiais, relevo e a planta urbana">
              <Layers className="size-3.5 max-sm:hidden" /> Cartografia<span className="max-sm:hidden"> geral</span>
            </button>
            <button type="button" onClick={() => alternarSoVenda(true)} data-ativo={soVenda} aria-pressed={soVenda}
              className={`${chipBase} rounded-l-none! shadow-none!`} title="Esconder a cartografia rural e deixar só os imóveis à venda (a planta urbana continua)">
              <Tag className="size-3.5" /> Só à venda
            </button>
          </div>
          {!SATELITE_GOOGLE && <button type="button" className={`${chipBase} max-sm:hidden`} data-ativo={mosaicoAtivo}
            aria-pressed={mosaicoAtivo}
            title="Mosaico Sentinel-2 sem nuvens (2016, 10 m) na visão regional. Do zoom de bairro para perto, a fotografia de detalhe normal."
            onClick={alternarMosaico}>
            Mosaico com menos nuvens
          </button>}
          <button onClick={() => { setPainelMapa(camadasAbertas ? null : "camadas"); setAvisoPlano(""); }}
            aria-controls="catalogo-camadas" aria-expanded={camadasAbertas} data-ativo={camadasAbertas}
            className={`${chipBase} sm:hidden`} data-tour="camadas">
            <Layers className="size-3.5" /> Camadas
          </button>
          <button onClick={() => { setPainelMapa(null); setPainelAberto(true); setTimeout(() => buscaInputRef.current?.focus(), 320); }}
        className={chipBase} title="Abrir a lista com a busca e os filtros de imóveis">
        <Search className="size-3.5" /> Buscar<span className="max-sm:hidden"> imóveis</span>
      </button>
          <div ref={botaoMaisRef} className="relative">
          <button onClick={() => { setPainelMapa(maisAberto ? null : "mais"); setAvisoPlano(""); }} data-ativo={maisAberto} aria-expanded={maisAberto} aria-controls="mais-do-mapa" className={chipBase} data-tour="mais">
            <Ellipsis className="size-3.5" /> Mais
          </button>
          {maisAberto && (
            <div id="mais-do-mapa" className={`absolute top-full left-[var(--menu-mais-x,0px)] z-30 mt-2 flex w-44 flex-col items-stretch gap-1.5 p-2 ${VIDRO}`}>
              {chipsSecundarios}
            </div>
          )}
          </div>
        </fieldset>

        {carAtivo && !soVenda && carAviso && !carSel && !camadasAbertas && (
          <p className={`${desenhando || painelAberto ? "max-sm:hidden " : ""}absolute top-[var(--abaixo-chips,4rem)] left-3 right-14 sm:right-auto px-3 py-1.5 sm:px-3.5 sm:py-2 text-[11px] sm:text-xs text-texto-3 ${VIDRO} rounded-[10px]!`}>
            {carAviso}
          </p>
        )}

        {avisoCarga && (
          <div role="status" className={`absolute bottom-[calc(3rem+var(--faixa,0px))] left-3 right-14 sm:right-auto z-20 flex items-center gap-3 px-3 py-2 text-sm ${VIDRO}`}>
            {avisoCarga}
            <BotaoFechar onClick={() => setAvisoCarga("")} />
          </div>
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
            onFechar={() => setPainelMapa(null)}
            onIr={(lng, lat, zoom) => mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1400 })}
            onBuscarTexto={(termo) => { setBusca(termo); setPainelMapa(null); setPainelAberto(true); }}
          />
        )}

        {seletorAno && (
          <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-20 w-80 max-w-[calc(100%-1.5rem)] p-5 space-y-3.5 max-h-[70%] overflow-y-auto ${VIDRO}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-full bg-verde/12 text-verde"><History className="size-[18px]" /></span>
                <p className="lp-display text-2xl text-verde">Imagem do ano</p>
              </div>
              <BotaoFechar onClick={() => setPainelMapa(null)} />
            </div>
            <select value={imagemAno ?? ""} aria-label="Ano da imagem de satélite"
              onChange={(e) => {
                const v = e.target.value || null;
                setImagemAno(v);
                if (v) { setMosaicoAnual(false); setBase("satelite"); }
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
              aoEscolher={(id) => { setImagemAno(id); if (id) { setMosaicoAnual(false); setBase("satelite"); } else setComparar(false); }} />
            <p className="text-xs text-texto-2 leading-relaxed border-t border-linha pt-3">
              Wayback mostra o mosaico da Esri como estava publicado no fim de cada ano — a foto de um lugar
              pode ser anterior. O mosaico com menos nuvens é o Sentinel-2 de 2016 (10 m), bom para a visão
              regional; de perto o mapa volta à fotografia de detalhe. A fonte aparece no canto do mapa.
            </p>
          </div>
        )}

        {comparar && imagemAno && mapaPronto && imagemHistoricaPorId(imagemAno) && (
          <ComparaImagens mapa={mapaPronto} imagem={imagemHistoricaPorId(imagemAno)!} onFechar={() => setComparar(false)} />
        )}

        {!painelMapa && !avisoPlano && !selecionado && <>
        {carSel && !podeTerceiros && <CartaoCarBloqueado key={carSel.cod} car={carSel} logado={logado} onFechar={fecharCartaoCar} />}
        {carSel && podeTerceiros && <CartaoCar key={carSel.cod} car={carSel} mapa={mapaPronto} podeAmbiente={liberado("camadas_oficiais")} oficiais={noPonto} extras={extrasPonto} onFechar={fecharCartaoCar} />}
        {!carSel && (noPonto.length > 0 || temExtras(extrasPonto)) && !loteSel && <CartaoOficiais itens={noPonto} extras={extrasPonto} ponto={pontoClicado} onFechar={() => { setNoPonto([]); setExtrasPonto(null); }} />}
        {pontoLivre && !carSel && !loteSel && !varios && noPonto.length === 0 && (
          <CartaoPonto ponto={pontoLivre} onFechar={() => setPontoLivre(null)} />
        )}
        {loteSel && !carSel && !varios && (
          <CartaoLote lote={loteSel} logado={logado} onFechar={() => {
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

        </>}
        <MarcadorDaUrl map={mapaPronto} />
        {pronto && !camadasAbertas && (
          <FiltrosRapidos onDelimitar={() => { setPainelMapa(null); setPedidoRecorte(n => n + 1); }}
            areas={areasCamadas.length} onAreas={() => { if (!areaId) setAreaId(areasCamadas[0].id); setPainelMapa("camadas"); setAvisoPlano(""); }}
            car={carAtivo && !soVenda} avisoCar={carAviso} alternarCar={() => {
              if (soVenda) return ligarCarNoSoVenda();
              carEscolhido.current = true;
              setCarAtivo(!carAtivo);
              void salvarPrefs({ camada_car: !carAtivo });
            }}
            situacoes={situacoesCar} alternarSituacao={(id) => setSituacoesCar((antes) => {
              const nova = new Set(antes);
              if (nova.has(id)) nova.delete(id); else nova.add(id);
              return nova;
            })}
            ativas={soVenda ? SEM_OFICIAIS : camadasAtivas} estado={estadoCamadas}
            onAlternar={(id: CamadaOficialId) => naCartografia(id, camadasAtivas.has(id), alternarCamada)}
            planta={plantaAtiva} corUrbana={CARTO_CORES[base].linha} alternarPlanta={() => setPlantaAtiva(!plantaAtiva)}
            relevoAtivas={soVenda ? SEM_RELEVO : relevoAtivas} estadoRelevo={estadoRelevo}
            onAlternarRelevo={(id: RelevoId) => naCartografia(id, relevoAtivas.has(id), alternarRelevo)} />
        )}
        {camadasAbertas && (
          <PainelCamadas onFechar={() => setPainelMapa(null)}
            globais={soVenda ? { car: false, oficiais: SEM_OFICIAIS, relevo: SEM_RELEVO } : { car: carAtivo, oficiais: camadasAtivas, relevo: relevoAtivas }}
            grupo={grupoCamadas} selecionarGrupo={setGrupoCamadas}
            areas={areasCamadas} areaId={areaId} escolherArea={setAreaId}
            pronto={pronto} desenharArea={() => { setPainelMapa(null); setPedidoRecorte(n => n + 1); }}
            excluirArea={() => { setAreasCamadas(antes => antes.filter(a => a.id !== areaId)); setAreaId(""); }}
            car={!soVenda && (areaEscolhida?.car ?? carAtivo)} avisoCar={carAviso} alternarCar={() => {
              if (soVenda && !areaId) return ligarCarNoSoVenda();
              if (soVenda) { alternarSoVenda(false); if (areaEscolhida?.car) return; }
              if (areaId) { setAreasCamadas(antes => antes.map(a => a.id === areaId ? { ...a, car: !a.car } : a)); return; }
              carEscolhido.current = true;
              setCarAtivo(!carAtivo);
              void salvarPrefs({ camada_car: !carAtivo });
            }}
            planta={plantaAtiva} corUrbana={CARTO_CORES[base].linha} alternarPlanta={() => setPlantaAtiva(!plantaAtiva)}
            ativas={soVenda ? SEM_OFICIAIS : areaEscolhida?.camadas ?? camadasAtivas} estado={estadoCamadas}
            onAlternar={(id: CamadaOficialId) => naCartografia(id, (areaEscolhida?.camadas ?? camadasAtivas).has(id), alternarNaArea)}
            relevoAtivas={soVenda ? SEM_RELEVO : areaEscolhida?.relevo ?? relevoAtivas} estadoRelevo={areaEscolhida ? avisosRelevoLocal : estadoRelevo}
            onAlternarRelevo={(id: RelevoId) => naCartografia(id, (areaEscolhida?.relevo ?? relevoAtivas).has(id), alternarRelevoNaArea)} />
        )}
        {mapaPronto && gerenteRelevo && recortesRelevo.map(({id, areas}) => <RelevoNasAreas
          key={id + "-" + areas.map(a => a.id).join(",")} id={id} areas={areas.map(a => a.geometria)}
          mapa={mapaPronto} gerente={gerenteRelevo} aoErro={avisarRelevoLocal} />)}
        {!painelMapa && !carSel && !loteSel && !varios && !pontoLivre && !noPonto.length && !temExtras(extrasPonto) && !selecionado && <Legenda car={carVisivel && !soVenda} corUrbana={CARTO_CORES[base].linha} relevo={soVenda ? [] : [...relevoAtivas, ...recortesRelevo.map(c => c.id)]} extras={CAMADAS_OFICIAIS.filter((c) => !soVenda && camadasVisiveis.has(c.id))
          // camada com cor por valor (biomas): uma linha por valor na legenda
          .flatMap((c) => (c.cores ? Object.entries(c.cores).map(([nome, cor]) => ({ nome, cor })) : [c]))} />}

        <Ferramentas
          // 18/11/2026 (áudio do Carlos): no celular, tocar numa área sumia com as
          // ferramentas e "só dava para visualizar". Agora só os painéis grandes as recolhem.
          recolhida={!!(painelMapa || selecionado)}
          mapa={mapaPronto}
          pedidoRecorte={pedidoRecorte} onDelimitar={salvarArea}
          recursos={recursos}
          logado={logado}
          onDesenhando={aoDesenhar}
          onImportarKml={async (arquivo) => {
            const map = mapRef.current;
            if (!map) return;
            try {
              // KML/KMZ, GeoJSON e Shapefile em zip (ideia do Geomart, 11/11): tudo lido no navegador
              const nome = arquivo.name.toLowerCase();
              let dados: GeoJSON.FeatureCollection;
              if (nome.endsWith(".geojson") || nome.endsWith(".json")) {
                const j = JSON.parse(await arquivo.text()) as GeoJSON.GeoJSON;
                dados = j.type === "FeatureCollection" ? j
                  : j.type === "Feature" ? { type: "FeatureCollection", features: [j] }
                  : { type: "FeatureCollection", features: [{ type: "Feature", geometry: j as GeoJSON.Geometry, properties: {} }] };
              } else if (nome.endsWith(".zip")) {
                // shapefile de polígono, reprojetado pelo .prj (o mesmo leitor da importação do CAR)
                const { lerArquivoSicar } = await import("@/lib/geo/shapefileCar");
                const lido = await lerArquivoSicar([arquivo]);
                dados = { type: "FeatureCollection", features: lido.camadas.flatMap((c) => c.feicoes) };
                if (!dados.features.length) throw new Error("zip sem shapefile de polígono");
              } else {
                let kmlTexto: string;
                if (nome.endsWith(".kmz")) {
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
                dados = kml(doc) as GeoJSON.FeatureCollection;
              }

              if (map.getSource("kml-importado")) {
                (map.getSource("kml-importado") as GeoJSONSource).setData(dados);
              } else {
                map.addSource("kml-importado", { type: "geojson", data: dados });
                map.addLayer({
                  id: "kml-fill", type: "fill", source: "kml-importado",
                  filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
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
              console.error("falha ao importar arquivo:", e);
              window.alert("Não consegui ler esse arquivo. Envie um KML, KMZ, GeoJSON ou Shapefile de polígono em zip (com .shp, .dbf e .prj).");
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

      {/* ---------- unidades do prédio, por andar ---------- */}
      {predio && !selecionado && <PainelPredio predio={predio} onFechar={() => setPredio(null)} />}

      {/* ---------- inteligência territorial do imóvel ---------- */}
      {selecionado && (
        <PainelImovel
          imovel={selecionado}
          mapa={mapaPronto}
          raio={raio}
          onRaio={setRaio}
          onFechar={() => setSelecionado(null)}
        />
      )}
    </div>
  );
}

