"use client";

/**
 * Peças de interface do mapa (tema escuro dos mockups), separadas do
 * MapaRegional para o componente do mapa cuidar só de mapa.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight, ChevronDown, List as ListIcon, Fuel, GraduationCap, Hospital, Landmark, Layers, LoaderCircle, Lock, MapPin, Pill, Route, ShoppingCart, X,
  type LucideIcon,
} from "lucide-react";
import { STATUS_LABEL } from "@/lib/format";
import { CAMADAS_OFICIAIS, type CamadaOficialId } from "@/lib/map/camadasOficiais";
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

/**
 * Cores que ficam FORA da paleta, de propósito: o laranja cartográfico do CAR
 * separa o rural do urbano à primeira vista sobre o satélite (pedido do
 * cliente) e o Amarelo Claro marca o lote urbano.
 */
const COR_CAR = "#FF9D3D";
const COR_LOTE_LEGENDA = "#FFE299";

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

/**
 * Painel "Camadas e Dados": as camadas oficiais ligam e desligam aqui (as do
 * CAR e das plantas têm botão próprio na barra do mapa). Cada uma mostra se
 * está carregando, quantas feições há na tela ou por que não aparece.
 */
/** Interruptor das linhas do painel de camadas. */
function Interruptor({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={"relative h-5 w-9 rounded-full transition " + (on ? "bg-verde" : "bg-superficie-2 ring-1 ring-linha-forte")}>
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

export function PainelCamadas({
  onFechar, bloqueado = false, logado = false, ativas, estado, onAlternar,
  relevoAtivas, estadoRelevo = {}, onAlternarRelevo,
}: {
  onFechar: () => void;
  /** sem o recurso `camadas_oficiais` no plano */
  bloqueado?: boolean;
  logado?: boolean;
  ativas: Set<CamadaOficialId>;
  estado: Partial<Record<CamadaOficialId, EstadoCamada>>;
  onAlternar: (id: CamadaOficialId) => void;
  /** relevo e água: dados abertos, ligam para qualquer plano */
  relevoAtivas?: Set<RelevoId>;
  estadoRelevo?: EstadoRelevo;
  onAlternarRelevo?: (id: RelevoId) => void;
}) {
  const grupos = ["Fundiário", "Ambiental", "Infraestrutura"] as const;
  return (
    <div className={`absolute top-[var(--abaixo-chips,4rem)] left-3 z-20 w-[22rem] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-var(--abaixo-chips,4rem)-7.5rem)] sm:max-h-[calc(100%-var(--abaixo-chips,4rem)-9.5rem)] overflow-y-auto p-5 space-y-5 ${VIDRO}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-verde/12 text-verde">
            <Layers className="size-[18px]" />
          </span>
          <p className="lp-display text-2xl text-verde">Camadas e Dados</p>
        </div>
        <BotaoFechar onClick={onFechar} rotulo="Fechar camadas" />
      </div>

      {bloqueado && (
        <div className="rounded-2xl border border-ouro/40 bg-ouro/10 p-3.5 text-sm text-texto space-y-1.5">
          <p className="flex items-center gap-2 font-semibold">
            <Lock className="size-4 shrink-0 text-ouro" /> Camadas oficiais na consulta profissional
          </p>
          <p className="text-xs text-texto-2 leading-relaxed">
            As divisas do CAR e os lotes urbanos continuam abertos. As demais fontes entram com o plano profissional.
          </p>
          <Link href={logado ? "/planos" : "/entrar"} className="inline-flex items-center gap-1 text-sm font-semibold text-verde hover:underline">
            {logado ? "Ver planos" : "Entrar"} <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      {grupos.map((g) => (
        <div key={g} className="space-y-1">
          <p className="lp-eyebrow !text-[10px] !tracking-[0.2em] !text-ouro mb-1">{g}</p>
          {g === "Fundiário" && (
            <p className="flex items-center justify-between gap-3 border-t border-linha py-2 text-sm">
              <span className="flex items-center gap-2.5 text-texto-3">
                <span className="inline-block size-3 rounded-sm" style={{ background: COR_CAR }} /> Imóveis rurais (CAR)
              </span>
              <span className="text-[11px] font-semibold text-texto-2">botão na barra</span>
            </p>
          )}
          {CAMADAS_OFICIAIS.filter((c) => c.grupo === g).map((c) => {
            const on = ativas.has(c.id);
            const e = estado[c.id];
            return (
              <div key={c.id} className={"border-t border-linha py-2" + (bloqueado ? " opacity-60" : "")}>
                <label className={"flex items-center justify-between gap-3 text-sm " + (bloqueado ? "cursor-not-allowed" : "cursor-pointer")}>
                  <span className="flex min-w-0 items-center gap-2.5 text-texto-3">
                    <span className={"inline-block size-3 shrink-0 " + (c.ponto ? "rounded-full" : "rounded-sm")} style={{ background: c.cor }} />
                    <span className="min-w-0">
                      <span className="block truncate">{c.nome}</span>
                      <span className="block text-[11px] text-texto-2">{c.orgao}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {on && e?.carregando && <LoaderCircle className="size-3.5 animate-spin text-texto-2" aria-label="Carregando" />}
                    {on && !e?.carregando && !e?.aviso && e?.total != null && (
                      <span className="text-[11px] tabular-nums text-texto-2">{e.total.toLocaleString("pt-BR")}</span>
                    )}
                    <input type="checkbox" role="switch" checked={on} disabled={bloqueado}
                      onChange={() => onAlternar(c.id)} aria-label={`Mostrar ${c.nome}`}
                      className="peer sr-only" />
                    <Interruptor on={on} />
                  </span>
                </label>
                {on && e?.aviso && <p className="mt-1 pl-[22px] text-[11px] leading-snug text-alerta">{e.aviso}</p>}
              </div>
            );
          })}
        </div>
      ))}

      {relevoAtivas && onAlternarRelevo && (
        <div className="space-y-1">
          <p className="lp-eyebrow !text-[10px] !tracking-[0.2em] !text-ouro mb-1">Relevo e água</p>
          {CAMADAS_RELEVO.map((c) => {
            const on = relevoAtivas.has(c.id);
            const aviso = on ? estadoRelevo[c.id]?.aviso : "";
            return (
              <div key={c.id} className="border-t border-linha py-2">
                <label className="flex cursor-pointer items-center justify-between gap-3 text-sm" title={c.dica}>
                  <span className="flex min-w-0 items-center gap-2.5 text-texto-3">
                    <AmostraRelevo id={c.id} />
                    <span className="min-w-0">
                      <span className="block truncate">{c.nome}</span>
                      <span className="block text-[11px] text-texto-2">{c.fonte}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <input type="checkbox" role="switch" checked={on} onChange={() => onAlternarRelevo(c.id)}
                      aria-label={`Mostrar ${c.nome}`} className="peer sr-only" />
                    <Interruptor on={on} />
                  </span>
                </label>
                {aviso && <p className="mt-1 pl-[22px] text-[11px] leading-snug text-alerta">{aviso}</p>}
              </div>
            );
          })}
          <p className="pt-1 text-[11px] leading-relaxed text-texto-2">
            Relevo do SRTM (~30 m): bom para separar terreno plano de ondulado, não para projeto de terraplenagem.
          </p>
        </div>
      )}

      <p className="text-xs text-texto-2 border-t border-linha pt-4 leading-relaxed">
        Clique numa área para ver tudo o que incide sobre ela. Dados dos órgãos oficiais, guardados e atualizados
        periodicamente; a consulta completa do imóvel cruza todas as fontes com a data de cada uma.
      </p>
    </div>
  );
}

export function Legenda({ extras = [], relevo = [] }: { extras?: { cor: string; nome: string; ponto?: boolean }[]; relevo?: RelevoId[] }) {
  const tem = (id: RelevoId) => relevo.includes(id);
  // recolhível; no celular começa fechada (tampava ~40 % do mapa junto com as Ferramentas)
  // left-10, não left-3: a aba "‹" de recolher a lista (28 px, na altura do meio)
  // cobria o "L" de LEGENDA quando a legenda crescia até ela (QA 09/11)
  const [aberta, setAberta] = useState(true);
  useEffect(() => {
    if (window.innerWidth < 640) setAberta(false);
  }, []);
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
      <p className="flex items-center gap-2 text-texto-3 pt-1.5 border-t border-linha">
        <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: COR_CAR }} />
        Imóvel rural (CAR)
      </p>
      <p className="flex items-center gap-2 text-texto-3">
        <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: COR_LOTE_LEGENDA }} />
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
