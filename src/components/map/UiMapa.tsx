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
        className={`absolute bottom-24 sm:bottom-36 lg:bottom-32 left-10 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-texto-3 ${VIDRO}`}>
        <ListIcon className="size-3.5 text-ouro" /> Legenda
      </button>
    );
  }
  return (
    <div className={`absolute bottom-24 sm:bottom-36 lg:bottom-32 left-10 max-h-[45%] sm:max-h-[55%] overflow-y-auto px-4 py-3 text-xs space-y-1.5 ${VIDRO}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="lp-eyebrow !text-[10px] !tracking-[0.2em] !text-ouro">Legenda</p>
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
          <span className={"inline-block size-2.5 " + (c.ponto ? "rounded-full" : "rounded-sm")} style={{ background: c.cor }} />
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
