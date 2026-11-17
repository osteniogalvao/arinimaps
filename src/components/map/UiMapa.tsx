"use client";

/**
 * Peças de interface do mapa (tema escuro dos mockups), separadas do
 * MapaRegional para o componente do mapa cuidar só de mapa.
 */

import { useState, type ReactNode } from "react";
import {
  ChevronDown, List as ListIcon, Fuel, GraduationCap, Hospital, Landmark, Layers, LoaderCircle, MapPin, Pill, Route, ShoppingCart, Trash2, X,
  type LucideIcon,
} from "lucide-react";
import { STATUS_LABEL } from "@/lib/format";
import { CAMADAS_OFICIAIS, CORES_RURAIS, type CamadaOficial, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import { STATUS_MAPA, RADAR_ANEL } from "./statusMapa";
import type { EstadoCamada } from "./camadasOficiaisMapa";
import { CAMADAS_RELEVO, COR_AGUA, LEGENDA_DECLIVE, RAMPA_ALTITUDE, type EstadoRelevo, type RelevoId } from "./camadasRelevo";

/**
 * Painel de vidro sobre o satélite: superfície do tema a 85 % com desfoque.
 * No tema escuro vira vidro fumê; no claro, vidro fosco branco — o texto usa
 * os tokens do tema e continua legível nos dois.
 */
export const VIDRO =
  "rounded-2xl border border-linha bg-superficie/95 backdrop-blur-md shadow-[0_1px_2px_var(--sombra-botao),0_14px_32px_-22px_var(--sombra-popup)]";

export { STATUS_MAPA, RADAR_ANEL };

/** Botão "fechar" dos painéis do mapa (ícone X, alvo de 32 px). */
export function BotaoFechar({ onClick, rotulo = "Fechar" }: { onClick: () => void; rotulo?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo}
      className="grid size-8 shrink-0 place-items-center rounded-[10px] text-texto-2 transition hover:bg-superficie-2 hover:text-texto">
      <X className="size-4" />
    </button>
  );
}

const ICONES_POI: Record<string, LucideIcon> = {
  combustivel: Fuel, farmacia: Pill, supermercado: ShoppingCart, hospital: Hospital,
  escola: GraduationCap, centro: Landmark, acesso_rodovia: Route,
};

/** Ícone do ponto de referência (substitui os emojis de CATEGORIA_POI_ICONE). */
export function IconePoi({ categoria, className = "size-4" }: { categoria: string; className?: string }) {
  const Icone = ICONES_POI[categoria] ?? MapPin;
  return <Icone aria-hidden className={className} />;
}

/** Interruptor das linhas do painel de camadas. */
function Interruptor({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={"relative h-5 w-9 shrink-0 rounded-full transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-verde " + (on ? "bg-verde" : "bg-superficie-2 ring-1 ring-linha-forte")}>
      <span className={"absolute top-0.5 size-4 rounded-full bg-white shadow transition-all " + (on ? "left-[18px]" : "left-0.5")} />
    </span>
  );
}

/** Amostra de cor de cada camada de relevo no painel. */
function AmostraRelevo({ id }: { id: RelevoId }) {
  const fundo =
    id === "altitude" ? `linear-gradient(90deg, ${RAMPA_ALTITUDE.map(([, c]) => c).join(", ")})`
      : id === "declividade" ? `linear-gradient(90deg, ${LEGENDA_DECLIVE.map((c) => c.cor).join(", ")})`
      : id === "sombra" ? "linear-gradient(135deg, #F2F2EC, #4A564F)"
      : id === "hidrografia" ? COR_AGUA
      : "repeating-linear-gradient(0deg, #C9A97A 0 1px, transparent 1px 4px)";
  return <span className="inline-block size-3 shrink-0 rounded-sm ring-1 ring-linha-forte" style={{ background: fundo }} />;
}

export type GrupoCamadas = CamadaOficial["grupo"] | "Relevo e água";

function LinhaCamada({ nome, fonte, amostra, ligada, alternar, aviso, carregando, total, ajuda, geral }: {
  nome: string; fonte: string; amostra: ReactNode; ligada: boolean; alternar: () => void;
  aviso?: string; carregando?: boolean; total?: number; ajuda?: string; geral?: boolean;
}) {
  return (
    <div className="border-t border-linha py-2">
      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm" title={ajuda}>
        <span className="flex min-w-0 items-center gap-2.5 text-texto-3">
          {amostra}
          <span>
            <span className="block">{nome}</span>
            <span className="block text-[11px] text-texto-2">{fonte}{geral && " · Ligada no mapa inteiro"}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {ligada && carregando && <LoaderCircle className="size-3.5 animate-spin text-texto-2" aria-label="Carregando" />}
          {ligada && !carregando && !aviso && total != null && (
            <span className="text-[11px] tabular-nums text-texto-2">{total.toLocaleString("pt-BR")}</span>
          )}
          <input type="checkbox" role="switch" checked={ligada} onChange={alternar}
            aria-label={`Mostrar ${nome}`} className="peer sr-only" />
          <Interruptor on={ligada} />
        </span>
      </label>
      {ligada && aviso && <p role="status" className="mt-1 pl-[22px] text-[11px] leading-snug text-alerta">{aviso}</p>}
    </div>
  );
}

function amostraCor(cor: string, ponto = false) {
  return <span aria-hidden className={"inline-block size-3 shrink-0 ring-1 ring-linha-forte " + (ponto ? "rounded-full" : "rounded-sm")} style={{ background: cor }} />;
}

const GRUPOS: GrupoCamadas[] = ["Fundiário", "Ambiental", "Infraestrutura", "Relevo e água"];

export function PainelCamadas({
  onFechar, grupo, selecionarGrupo, ativas, estado, onAlternar,
  car, avisoCar, alternarCar, planta, corUrbana, alternarPlanta,
  relevoAtivas, estadoRelevo, onAlternarRelevo,
  areas, areaId, escolherArea, desenharArea, excluirArea, pronto, globais,
}: {
  onFechar: () => void;
  grupo: GrupoCamadas | null;
  selecionarGrupo: (grupo: GrupoCamadas | null) => void;
  ativas: ReadonlySet<CamadaOficialId>;
  estado: Partial<Record<CamadaOficialId, EstadoCamada>>;
  onAlternar: (id: CamadaOficialId) => void;
  car: boolean; avisoCar: string; alternarCar: () => void;
  planta: boolean; corUrbana: string; alternarPlanta: () => void;
  relevoAtivas: Set<RelevoId>; estadoRelevo: EstadoRelevo; onAlternarRelevo: (id: RelevoId) => void;
  areas: { id: string; nome: string }[]; areaId: string; escolherArea: (id: string) => void;
  desenharArea: () => void; excluirArea: () => void; pronto: boolean;
  globais: { car: boolean; oficiais: ReadonlySet<CamadaOficialId>; relevo: ReadonlySet<RelevoId> };
}) {
  return (
    <section id="catalogo-camadas" aria-label="Camadas e Dados"
      className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-[35] w-[20rem] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-var(--abaixo-chips,4rem)-5rem)] overflow-y-auto overscroll-contain p-4 ${VIDRO}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 lp-display text-xl text-verde"><Layers className="size-4" /> Camadas e Dados</h2>
        <BotaoFechar onClick={onFechar} rotulo="Fechar camadas" />
      </div>
      <div className="my-2 flex flex-wrap items-center gap-2 text-xs">
        {areas.length > 0 && (
          <select aria-label="Aplicar camadas em" value={areaId} onChange={e => escolherArea(e.target.value)}
            className="max-w-full rounded-lg border border-linha bg-superficie px-2 py-1.5 text-texto">
            <option value="">Mapa inteiro</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
        )}
        <button type="button" disabled={!pronto} onClick={desenharArea}
          className="rounded-lg border border-linha px-2.5 py-1.5 font-semibold text-verde disabled:opacity-50">Delimitar área</button>
        {areaId && <button type="button" onClick={excluirArea} aria-label="Remover área selecionada" title="Remover área selecionada" className="rounded-lg p-2 text-texto-2 hover:text-alerta"><Trash2 className="size-3.5" /></button>}
      </div>
      {areaId && <p className="mb-2 text-xs text-texto-2">Escolha as camadas para esta área. As camadas do mapa inteiro continuam visíveis.</p>}
      {GRUPOS.map((g, i) => {
        const oficiais = CAMADAS_OFICIAIS.filter(c => c.grupo === g);
        const abertas = oficiais.filter(c => ativas.has(c.id)).length
          + (g === "Fundiário" && car ? 1 : 0)
          + (!areaId && g === "Infraestrutura" && planta ? 1 : 0)
          + (g === "Relevo e água" ? relevoAtivas.size : 0);
        const aberta = grupo === g;
        return (
          <div key={g} className="border-t border-linha">
            <button type="button" aria-expanded={aberta} aria-controls={`camadas-grupo-${i}`}
              onClick={() => selecionarGrupo(aberta ? null : g)}
              className="flex min-h-10 w-full items-center justify-between gap-2 text-left text-sm font-semibold text-texto hover:text-verde">
              {g}
              <span aria-hidden className="ml-auto flex items-center gap-2">
                {abertas > 0 && <span className="rounded-full bg-verde/12 px-2 text-xs tabular-nums text-verde">{abertas}</span>}
                <ChevronDown className={"size-4 text-texto-2 transition " + (aberta ? "rotate-180" : "")} />
              </span>
            </button>
            <div id={`camadas-grupo-${i}`} hidden={!aberta}>
              {g === "Fundiário" && <LinhaCamada nome="Imóveis rurais (CAR)" fonte="Cadastro Ambiental Rural"
                amostra={amostraCor(CORES_RURAIS.car)} ligada={car} alternar={alternarCar} aviso={avisoCar} geral={!!areaId && globais.car} />}
              {g === "Infraestrutura" && !areaId && <LinhaCamada nome="Planta completa" fonte="Cartografia urbana ARINI"
                amostra={amostraCor(corUrbana)} ligada={planta} alternar={alternarPlanta} />}
              {oficiais.map(c => <LinhaCamada key={c.id} nome={c.nome} fonte={c.orgao} amostra={amostraCor(c.cor, c.ponto)}
                ligada={ativas.has(c.id)} alternar={() => onAlternar(c.id)} ajuda={c.ajuda} geral={!!areaId && globais.oficiais.has(c.id)}
                aviso={estado[c.id]?.aviso} carregando={estado[c.id]?.carregando} total={areaId ? undefined : estado[c.id]?.total} />)}
              {g === "Relevo e água" && CAMADAS_RELEVO.map(c => <LinhaCamada key={c.id} nome={c.nome} fonte={c.fonte}
                amostra={<AmostraRelevo id={c.id} />} ligada={relevoAtivas.has(c.id)} alternar={() => onAlternarRelevo(c.id)}
                aviso={estadoRelevo[c.id]?.aviso} ajuda={c.dica} geral={!!areaId && globais.relevo.has(c.id)} />)}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function Legenda({ car, corUrbana, extras = [], relevo = [] }: {
  car: boolean; corUrbana: string; extras?: { cor: string; nome: string; ponto?: boolean }[]; relevo?: RelevoId[];
}) {
  const tem = (id: RelevoId) => relevo.includes(id);
  // recolhível; no celular começa fechada (tampava ~40 % do mapa junto com as Ferramentas)
  // left-10, não left-3: a aba "‹" de recolher a lista (28 px, na altura do meio)
  // cobria o "L" de LEGENDA quando a legenda crescia até ela (QA 09/11)
  const [aberta, setAberta] = useState(false);
  if (!aberta) {
    return (
      <button type="button" onClick={() => setAberta(true)} aria-expanded={false}
        className="absolute bottom-24 sm:bottom-[calc(9rem+var(--faixa,0px))] lg:bottom-[calc(8rem+var(--faixa,0px))] left-10 inline-flex items-center gap-1.5 rounded-full border border-linha bg-superficie/85 px-3 py-1.5 text-[11px] font-semibold text-texto-2 shadow-[0_6px_18px_-12px_rgb(0_0_0/0.8)] backdrop-blur-md transition hover:text-texto">
        <ListIcon className="size-3 text-ouro" /> Legenda
      </button>
    );
  }
  return (
    // 17/11/2026 (item 16 do Carlos): legenda discreta, vidro mais leve, letra menor
    <div className="absolute bottom-24 sm:bottom-[calc(9rem+var(--faixa,0px))] lg:bottom-[calc(8rem+var(--faixa,0px))] left-10 max-h-[45%] sm:max-h-[55%] w-52 overflow-y-auto rounded-xl border border-linha bg-superficie/85 px-3 py-2 text-[11px] leading-tight space-y-1 shadow-[0_10px_24px_-16px_rgb(0_0_0/0.8)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-texto-2">Legenda</p>
        <button type="button" onClick={() => setAberta(false)} aria-expanded aria-label="Recolher legenda" title="Recolher legenda"
          className="grid size-6 place-items-center rounded-md text-texto-2 transition hover:bg-superficie-2 hover:text-texto">
          <ChevronDown className="size-3.5" />
        </button>
      </div>
      {Object.entries(STATUS_MAPA).map(([status, cor]) => (
        <p key={status} className="flex items-center gap-2 text-texto-3">
          <span className="inline-block size-2.5 rounded-full ring-1 ring-linha-forte" style={{ background: cor }} />
          {STATUS_LABEL[status]}
        </p>
      ))}
      {car && <p className="flex items-center gap-2 text-texto-3 pt-1.5 border-t border-linha">
        <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: CORES_RURAIS.car }} />
        Imóvel rural (CAR)
      </p>}
      <p className="flex items-center gap-2 text-texto-3">
        <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: corUrbana }} />
        Lote urbano
      </p>
      {extras.map((c) => (
        <p key={c.nome} className="flex items-center gap-2 text-texto-3">
          {/* polígono vira contorno, como aparece no mapa; ponto continua cheio */}
          <span className={"inline-block size-2.5 shrink-0 " + (c.ponto ? "rounded-full" : "rounded-[3px] border-2")}
            style={c.ponto ? { background: c.cor } : { borderColor: c.cor, background: c.cor + "33" }} />
          {c.nome}
        </p>
      ))}
      {tem("altitude") && (
        <div className="pt-1.5 border-t border-linha text-texto-3">
          <p>Altitude</p>
          <span className="mt-1 block h-2 w-40 rounded-sm"
            style={{ background: `linear-gradient(90deg, ${RAMPA_ALTITUDE.map(([, c]) => c).join(", ")})` }} />
          {/* paradas em espaço igual: os rótulos caem na 1ª, 4ª, 7ª e última */}
          <span className="mt-0.5 flex w-40 justify-between text-[10px] text-texto-2 tabular-nums">
            {[0, 3, 6, RAMPA_ALTITUDE.length - 1].map((i, n) => (
              <span key={i}>{RAMPA_ALTITUDE[i][0].toLocaleString("pt-BR")}{n === 0 ? " m" : n === 3 ? "+" : ""}</span>
            ))}
          </span>
        </div>
      )}
      {tem("declividade") && (
        <div className="pt-1.5 border-t border-linha space-y-1">
          <p className="text-texto-3">Declividade (Embrapa)</p>
          {LEGENDA_DECLIVE.map((c) => (
            <p key={c.nome} className="flex items-center gap-2 text-texto-3">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: c.cor }} /> {c.nome}
            </p>
          ))}
        </div>
      )}
      {tem("curvas") && (
        <p className="flex items-center gap-2 text-texto-3 pt-1.5 border-t border-linha">
          <span className="inline-block w-3.5 h-px bg-current opacity-80" /> Curva de nível (mestra com a cota)
        </p>
      )}
      {tem("sombra") && (
        <p className="flex items-center gap-2 text-texto-3">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: "linear-gradient(135deg, #F2F2EC, #4A564F)" }} /> Relevo sombreado
        </p>
      )}
      {tem("hidrografia") && (
        <p className="flex items-center gap-2 text-texto-3">
          <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: COR_AGUA }} /> Rios e massas d&apos;água (OSM)
        </p>
      )}
    </div>
  );
}

/**
 * Filtros rápidos (17/11/2026, pedido do Carlos com o Geomart como referência):
 * as camadas mais usadas viram pílulas coloridas no canto superior direito,
 * a um clique, sem abrir o painel "Camadas e Dados". A pílula ligada fica
 * preenchida com a cor da camada; desligada, só a bolinha mostra a cor.
 * CAR e Ambiental abrem uma lista com subfiltros (situação do CAR e cada
 * camada ambiental), cada um com sua cor e seu interruptor.
 */
export const SITUACOES_CAR = [
  { id: "aguardando", nome: "Aguardando análise", cor: "#FFC400" },
  { id: "em_analise", nome: "Em análise", cor: "#29B6F6" },
  { id: "analisado", nome: "Analisado", cor: "#00E676" },
  { id: "cancelado", nome: "Cancelado / suspenso", cor: "#FF5252" },
] as const;
export type SituacaoCar = (typeof SITUACOES_CAR)[number]["id"];

const AMBIENTAL: CamadaOficialId[] = ["ucs", "ucs_brasil", "prodes_cerrado", "prodes_biomas", "ibama_embargos", "ibama_autos", "inpe_queimadas",
  "outorgas_federais", "ana_rios", "quilombolas", "assentamentos", "florestas_publicas", "iphan_sitios", "anm", "ibge_biomas"];
// 17/11: energia (ANEEL) ganha pílula própria, como no Dados Fazenda
const ENERGIA: CamadaOficialId[] = ["aneel_transmissao", "aneel_hidreletricas", "aneel_termeletricas", "aneel_solar", "barragens", "ana_pivos", "aerodromos"];
const COR_ENERGIA = "#FFD54F";
const AMBIENTAL_PADRAO: CamadaOficialId[] = ["ucs", "prodes_cerrado", "ibama_embargos"];
const COR_AMBIENTAL = "#E91E63";

function Pilula({ cor, ligada, rotulo, titulo, carregando, aviso, onClick, aberto, onAbrir }: {
  cor: string; ligada: boolean; rotulo: string; titulo: string; carregando?: boolean; aviso?: boolean;
  onClick: () => void; aberto?: boolean; onAbrir?: () => void;
}) {
  return (
    <span style={ligada ? { background: cor, borderColor: cor } : { borderColor: cor }}
      className={"inline-flex min-w-[9rem] items-stretch overflow-hidden rounded-full border-2 text-xs font-semibold shadow-[0_6px_18px_-10px_rgb(0_0_0/0.8)] transition "
        + (ligada ? "text-[#111]" : "bg-superficie/95 text-texto backdrop-blur-md")}>
      <button type="button" aria-pressed={ligada} title={titulo} onClick={onClick}
        className="flex flex-1 items-center gap-2 py-1.5 pl-3 pr-2 text-left transition hover:brightness-110">
        <span aria-hidden className={"inline-block size-2.5 shrink-0 rounded-full " + (ligada ? "bg-white ring-2 ring-black/25" : "")}
          style={ligada ? undefined : { background: cor }} />
        <span className="flex-1">{rotulo}</span>
        {ligada && carregando && <LoaderCircle className="size-3.5 animate-spin" aria-label="Carregando" />}
        {ligada && !carregando && aviso && <span aria-hidden className="text-[10px] font-bold">!</span>}
      </button>
      {onAbrir && (
        <button type="button" onClick={onAbrir} aria-expanded={aberto} aria-label={`Filtros de ${rotulo}`} title={`Filtros de ${rotulo}`}
          className={"grid w-7 place-items-center border-l transition " + (ligada ? "border-black/20 hover:bg-black/10" : "border-linha hover:bg-superficie-2")}>
          <ChevronDown className={"size-3.5 transition " + (aberto ? "rotate-180" : "")} />
        </button>
      )}
    </span>
  );
}

function ItemFiltro({ cor, nome, ligada, alternar, ponto, detalhe }: { cor: string; nome: string; ligada: boolean; alternar: () => void; ponto?: boolean; detalhe?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-[13px] text-texto">
      <span className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className={"inline-block size-3 shrink-0 ring-2 ring-white/70 " + (ponto ? "rounded-full" : "rounded-full")} style={{ background: cor }} />
        <span className="truncate">{nome}</span>
        {detalhe}
      </span>
      <input type="checkbox" role="switch" checked={ligada} onChange={alternar} aria-label={`Mostrar ${nome}`} className="peer sr-only" />
      <Interruptor on={ligada} />
    </label>
  );
}

export function FiltrosRapidos({ car, alternarCar, avisoCar, situacoes, alternarSituacao, ativas, estado, onAlternar }: {
  car: boolean; alternarCar: () => void; avisoCar?: string;
  situacoes: ReadonlySet<SituacaoCar>; alternarSituacao: (id: SituacaoCar) => void;
  ativas: ReadonlySet<CamadaOficialId>;
  estado: Partial<Record<CamadaOficialId, EstadoCamada>>;
  onAlternar: (id: CamadaOficialId) => void;
}) {
  const [aberto, setAberto] = useState(true);
  const [lista, setLista] = useState<"car" | "ambiental" | "energia" | null>(null);
  const def = (id: CamadaOficialId) => CAMADAS_OFICIAIS.find((c) => c.id === id)!;
  const simples = (id: CamadaOficialId, rotulo: string) => {
    const d = def(id); const e = estado[id];
    return <Pilula key={id} cor={d.cor} ligada={ativas.has(id)} rotulo={rotulo}
      titulo={[`${d.nome} · ${d.orgao}`, ativas.has(id) && e?.aviso].filter(Boolean).join(" — ")}
      carregando={e?.carregando} aviso={!!e?.aviso} onClick={() => onAlternar(id)} />;
  };
  const ambientaisLigadas = AMBIENTAL.filter((id) => ativas.has(id));
  const energiaLigadas = ENERGIA.filter((id) => ativas.has(id));
  const itemDaLista = (id: CamadaOficialId) => {
    const d = def(id); const e = estado[id];
    return <ItemFiltro key={id} cor={d.cores ? "linear-gradient(135deg,#2E9E5B,#C9B23B,#4FA3C7)" : d.cor} nome={d.nome.replace(/ \(.*\)$/, "")} ponto={d.ponto}
      ligada={ativas.has(id)} alternar={() => onAlternar(id)}
      detalhe={ativas.has(id) && e?.carregando ? <LoaderCircle className="size-3 animate-spin text-texto-2" aria-label="Carregando" /> : undefined} />;
  };
  const caixa = "w-64 rounded-2xl border border-linha bg-superficie/97 p-3 shadow-[0_14px_32px_-18px_rgb(0_0_0/0.8)] backdrop-blur-md";
  return (
    <div role="group" aria-label="Filtros rápidos de camadas"
      className="absolute top-[var(--abaixo-chips,4rem)] right-14 z-10 hidden max-h-[calc(100%-var(--abaixo-chips,4rem)-1rem)] overflow-y-auto sm:flex flex-col items-end gap-1.5 p-0.5">
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto}
        className="inline-flex items-center gap-1 rounded-full bg-superficie/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-texto-2 shadow-[0_6px_18px_-10px_rgb(0_0_0/0.8)] ring-1 ring-linha backdrop-blur-md transition hover:text-texto">
        <Layers className="size-3" /> Filtros
        <ChevronDown className={"size-3 transition " + (aberto ? "" : "-rotate-90")} />
      </button>
      {aberto && <>
        {simples("sigef", "SIGEF")}
        {simples("snci", "SNCI")}
        <Pilula cor={CORES_RURAIS.car} ligada={car} rotulo="CAR"
          titulo={["Imóveis rurais declarados (CAR)", car && avisoCar].filter(Boolean).join(" — ")}
          aviso={!!avisoCar} onClick={alternarCar} aberto={lista === "car"} onAbrir={() => setLista(lista === "car" ? null : "car")} />
        {lista === "car" && (
          <div className={caixa}>
            <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-texto-2">Situação do CAR</p>
            {SITUACOES_CAR.map((s) => (
              <ItemFiltro key={s.id} cor={s.cor} nome={s.nome} ligada={car && situacoes.has(s.id)}
                alternar={() => { if (!car) alternarCar(); alternarSituacao(s.id); }} />
            ))}
          </div>
        )}
        {simples("credito_rural", "Crédito rural")}
        {simples("funai", "Indígenas")}
        <Pilula cor={COR_AMBIENTAL} ligada={ambientaisLigadas.length > 0}
          rotulo={ambientaisLigadas.length ? `Ambiental · ${ambientaisLigadas.length}` : "Ambiental"}
          titulo="Unidades de conservação, desmatamento, embargos, queimadas, outorgas e mais"
          carregando={ambientaisLigadas.some((id) => estado[id]?.carregando)}
          onClick={() => (ambientaisLigadas.length ? ambientaisLigadas : AMBIENTAL_PADRAO).forEach(onAlternar)}
          aberto={lista === "ambiental"} onAbrir={() => setLista(lista === "ambiental" ? null : "ambiental")} />
        {lista === "ambiental" && (
          <div className={caixa}>
            <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-texto-2">Ambiental</p>
            {AMBIENTAL.map(itemDaLista)}
            {ambientaisLigadas.some((id) => estado[id]?.aviso) && (
              <p className="pt-1 text-[11px] leading-snug text-alerta">Algumas camadas só aparecem com o mapa mais aproximado.</p>
            )}
          </div>
        )}
        <Pilula cor={COR_ENERGIA} ligada={energiaLigadas.length > 0}
          rotulo={energiaLigadas.length ? `Energia · ${energiaLigadas.length}` : "Energia"}
          titulo="Linhas de transmissão, usinas, barragens, pivôs e aeródromos"
          carregando={energiaLigadas.some((id) => estado[id]?.carregando)}
          onClick={() => (energiaLigadas.length ? energiaLigadas : ENERGIA).forEach(onAlternar)}
          aberto={lista === "energia"} onAbrir={() => setLista(lista === "energia" ? null : "energia")} />
        {lista === "energia" && (
          <div className={caixa}>
            <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-texto-2">Energia e infraestrutura</p>
            {ENERGIA.map(itemDaLista)}
          </div>
        )}
      </>}
    </div>
  );
}

/** Unidade da contagem de cada camada na faixa de resumo. */
const UNIDADE: Partial<Record<CamadaOficialId, string>> = {
  sigef: "parcelas", snci: "imóveis", credito_rural: "glebas", outorgas_federais: "outorgas", funai: "terras",
  quilombolas: "territórios", ibama_embargos: "embargos", ucs: "unidades", prodes_cerrado: "polígonos",
  inpe_queimadas: "focos", ibge_biomas: "biomas", anm: "processos", aneel_transmissao: "trechos",
  aneel_hidreletricas: "usinas", aneel_termeletricas: "usinas", aneel_solar: "usinas", ana_rios: "trechos", iphan_sitios: "bens",
  prodes_biomas: "polígonos", assentamentos: "assentamentos", ucs_brasil: "unidades", ibama_autos: "autos", florestas_publicas: "florestas",
  aerodromos: "pistas", ana_pivos: "pivôs", barragens: "barragens",
};

/**
 * Faixa de resumo (17/11/2026, referência do Dados Fazenda): uma coluna por
 * camada oficial ligada, com a contagem do que está na tela. Só lê o estado
 * que as camadas já calculam; não faz pedido nenhum.
 * Desde 17/11 (pedido do Stenio) é uma faixa branca presa no rodapé, de ponta
 * a ponta, com a altura em --faixa: o mapa e os botões de baixo sobem por ela.
 */
export const ALTURA_FAIXA = "sm:[--faixa:3.5rem]";

export function ResumoCamadas({ ativas, estado }: {
  ativas: ReadonlySet<CamadaOficialId>; estado: Partial<Record<CamadaOficialId, EstadoCamada>>;
}) {
  const ligadas = CAMADAS_OFICIAIS.filter((c) => ativas.has(c.id));
  if (!ligadas.length) return null;
  return (
    <div role="status" aria-label="Resumo das camadas na tela"
      className="absolute inset-x-0 bottom-0 z-20 hidden h-[var(--faixa)] sm:flex items-stretch overflow-x-auto border-t border-neutral-200 bg-white text-neutral-800 shadow-[0_-6px_18px_-12px_rgb(0_0_0/0.5)]">
      {ligadas.map((c) => {
        const e = estado[c.id];
        return (
          <div key={c.id} title={`${c.nome} · ${c.orgao}`}
            className="flex min-w-[10rem] shrink-0 flex-col justify-center border-r border-neutral-200 px-4 last:border-r-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: c.cor }} />
              <span className="truncate">{c.nome.replace(/ \(.*\)$/, "")}</span>
            </p>
            <p className="mt-0.5 text-sm">
              {e?.carregando ? <LoaderCircle className="inline size-3.5 animate-spin text-neutral-400" aria-label="Carregando" />
                : e?.aviso ? <span className="text-[11px] text-neutral-500" title={e.aviso}>{e.aviso.startsWith("Aproxime") ? "Aproxime o mapa" : "Sem resposta"}</span>
                : <><strong className="tabular-nums">{(e?.total ?? 0).toLocaleString("pt-BR")}</strong> <span className="text-xs text-neutral-500">{UNIDADE[c.id] ?? "itens"} na tela</span></>}
            </p>
          </div>
        );
      })}
    </div>
  );
}
