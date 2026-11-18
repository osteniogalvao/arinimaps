"use client";

/**
 * O que há no ponto clicado, para todas as camadas ligadas (vídeos do Carlos,
 * 17/11/2026, 22h00 e 22h02: "eu clico na fazenda e quero saber do solo, do
 * clima, da altitude, do valor do crédito rural; as funções têm que me
 * entregar o que eu procuro").
 *
 *  - ListaNoPonto: as feições das camadas oficiais, cada uma com "Ver tudo";
 *  - LinhaRelevo: altitude e declive do SRTM no ponto;
 *  - LinhaAmbiente: o tema ambiental do CAR no ponto (reserva, APP...) e quanto
 *    ele soma no imóvel. As camadas ambientais se registram aqui por mapa
 *    (registrarAmbiente), quem estiver aberto: cartão do CAR, tour, consulta;
 *  - CartaoNoPonto: o cartão flutuante do Tour 3D e do mapa da consulta.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { ChevronDown, Mountain, Trees } from "lucide-react";
import { camadaOficialPorId, descreverFeicao } from "@/lib/map/camadasOficiais";
import type { FeicaoNoPonto } from "@/components/map/camadasOficiaisMapa";
import { BotaoFechar, VIDRO } from "@/components/map/UiMapa";

// ---------------------------------------------------------------- ambiente do CAR
export type AmbienteNoPonto = { tema: string; nome: string; cor: string; ha: number; totalHa: number; pct: number | null };
/** null: nenhuma camada ambiental aberta neste mapa; []: aberta, e nada declarado no ponto (dentro do imóvel). */
type ConsultaAmbiente = (lng: number, lat: number) => AmbienteNoPonto[] | "fora";
const ambientes = new WeakMap<MLMap, ConsultaAmbiente>();
export function registrarAmbiente(mapa: MLMap, f: ConsultaAmbiente) {
  ambientes.set(mapa, f);
  return () => { if (ambientes.get(mapa) === f) ambientes.delete(mapa); };
}
export function ambienteNoPonto(mapa: MLMap | null, lng: number, lat: number): AmbienteNoPonto[] | null {
  const f = mapa && ambientes.get(mapa);
  if (!f) return null;
  const r = f(lng, lat);
  return r === "fora" ? null : r;
}

// ---------------------------------------------------------------- medição em curso
/** Mapa com régua aberta: o clique é ponto da medição, não pergunta "o que há aqui". */
const medindo = new WeakSet<MLMap>();
export function marcarMedicao(mapa: MLMap, ativo: boolean) {
  if (ativo) medindo.add(mapa); else medindo.delete(mapa);
}
export const estaMedindo = (mapa: MLMap) => medindo.has(mapa);

// ---------------------------------------------------------------- linhas
const fmtHa = (ha: number) => ha.toLocaleString("pt-BR", { maximumFractionDigits: ha < 10 ? 2 : 1 }) + " ha";

function ItemOficial({ f }: { f: FeicaoNoPonto }) {
  const c = camadaOficialPorId(f.camada);
  const [aberto, setAberto] = useState(false);
  if (!c) return null;
  const { titulo, detalhe, linhas } = descreverFeicao(f.camada, f.props);
  return (
    <li className="rounded-xl border border-linha bg-superficie-2/60 px-3 py-2">
      <div className="flex gap-2.5">
        <span className={"mt-1 inline-block size-2.5 shrink-0 " + (c.ponto ? "rounded-full" : "rounded-sm")} style={{ background: c.cor }} />
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-2">{c.orgao} · {c.nome}</span>
          <span className="block font-semibold text-texto">{titulo}</span>
          {detalhe && <span className="block text-xs text-texto-2">{detalhe}</span>}
        </span>
      </div>
      {!!linhas?.length && <>
        <button type="button" aria-expanded={aberto} onClick={() => setAberto(!aberto)}
          className="mt-1 ml-5 inline-flex items-center gap-1 text-xs font-semibold text-verde hover:underline">
          {aberto ? "Menos" : "Ver tudo"} <ChevronDown className={"size-3.5 transition " + (aberto ? "rotate-180" : "")} />
        </button>
        {aberto && <dl className="mt-1.5 ml-5 divide-y divide-linha text-xs">
          {linhas.map(([r, v]) => <div key={r} className="flex items-baseline justify-between gap-3 py-1">
            <dt className="shrink-0 text-texto-2">{r}</dt><dd className="text-right font-medium text-texto">{v}</dd>
          </div>)}
        </dl>}
      </>}
    </li>
  );
}

/** As feições das camadas oficiais no ponto, cada uma com o detalhe à mostra e "Ver tudo". */
export function ListaNoPonto({ itens, max = 12 }: { itens: FeicaoNoPonto[]; max?: number }) {
  return (
    <ul className="space-y-2">
      {itens.slice(0, max).map((f, i) => <ItemOficial key={`${f.camada}-${String(f.props.id ?? i)}`} f={f} />)}
      {itens.length > max && <li className="text-xs text-texto-2">e mais {itens.length - max} no ponto clicado.</li>}
    </ul>
  );
}

/** Altitude e declive no ponto (SRTM), lidos sob demanda. */
export function LinhaRelevo({ lng, lat }: { lng: number; lat: number }) {
  type Leitura = { altitude: number; declive: number; classe: string } | "erro";
  const chave = `${lng},${lat}`;
  const [lido, setLido] = useState<{ chave: string; valor: Leitura } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    import("@/lib/map/relevoDem")
      .then((m) => m.relevoNoPonto(lng, lat, ctrl.signal))
      .then((v) => { if (!ctrl.signal.aborted) setLido({ chave: `${lng},${lat}`, valor: v ?? "erro" }); })
      .catch(() => { if (!ctrl.signal.aborted) setLido({ chave: `${lng},${lat}`, valor: "erro" }); });
    return () => ctrl.abort();
  }, [lng, lat]);
  const r = lido?.chave === chave ? lido.valor : null;
  return (
    <div className="flex gap-2.5 rounded-xl border border-linha bg-superficie-2/60 px-3 py-2 text-sm leading-snug">
      <Mountain className="mt-0.5 size-4 shrink-0 text-ouro" />
      <span className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-2">SRTM · Relevo</span>
        {r === null ? <span className="block text-texto-2" role="status">Lendo a altitude…</span>
          : r === "erro" ? <span className="block text-texto-2">Altitude indisponível agora.</span>
            : <>
              <span className="block font-semibold text-texto">Altitude {Math.round(r.altitude).toLocaleString("pt-BR")} m</span>
              <span className="block text-xs text-texto-2">Declive {r.declive.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · {r.classe}</span>
            </>}
      </span>
    </div>
  );
}

/** O tema ambiental do CAR no ponto: reserva, APP... com a área da feição e o total no imóvel. */
export function LinhaAmbiente({ itens }: { itens: AmbienteNoPonto[] }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-linha bg-superficie-2/60 px-3 py-2 text-sm leading-snug">
      <Trees className="mt-0.5 size-4 shrink-0 text-verde" />
      <span className="min-w-0 space-y-1">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-2">SICAR · Ambiente do CAR</span>
        {!itens.length ? <span className="block text-texto-2">Neste ponto o SICAR não traz reserva legal, APP nem outro tema ambiental declarado.</span>
          : itens.map((a) => (
            <span key={a.tema} className="block">
              <span className="flex items-center gap-1.5 font-semibold text-texto">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: a.cor }} />{a.nome}: {fmtHa(a.ha)} neste trecho
              </span>
              <span className="block text-xs text-texto-2">
                {fmtHa(a.totalHa)} no imóvel{a.pct != null ? ` · ${a.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da área` : ""}
              </span>
            </span>
          ))}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- cartão flutuante
export type PontoClicado = { lng: number; lat: number; oficiais: FeicaoNoPonto[]; ambiente: AmbienteNoPonto[] | null };

/**
 * Cartão "Neste ponto" sobre o próprio mapa (Tour 3D e mapa da consulta).
 * `oficiais` diz o que as camadas oficiais ligadas têm no ponto; `relevo`,
 * se a linha da altitude entra (no tour sempre: o terreno é 3D).
 */
export function CartaoNoPonto({ mapa, oficiais, relevo, lado = "direita" }: {
  mapa: MLMap; oficiais: (e: MapMouseEvent) => FeicaoNoPonto[]; relevo: () => boolean; lado?: "direita" | "esquerda";
}) {
  const [ponto, setPonto] = useState<(PontoClicado & { relevo: boolean }) | null>(null);
  useEffect(() => {
    const clique = (e: MapMouseEvent) => {
      if (estaMedindo(mapa)) return;
      const { lng, lat } = e.lngLat;
      const p = { lng, lat, oficiais: oficiais(e), ambiente: ambienteNoPonto(mapa, lng, lat), relevo: relevo() };
      setPonto(p.oficiais.length || p.ambiente || p.relevo ? p : null);
    };
    mapa.on("click", clique);
    return () => { mapa.off("click", clique); };
  }, [mapa, oficiais, relevo]);
  if (!ponto) return null;
  return createPortal(
    <div role="dialog" aria-label="Neste ponto" onMouseDown={(e) => e.stopPropagation()}
      className={`absolute ${lado === "direita" ? "right-3 bottom-20 sm:bottom-auto sm:top-3" : "left-3 top-3"} z-20 w-80 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-6rem)] overflow-y-auto overscroll-contain space-y-2 p-4 text-texto ${VIDRO}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="lp-display text-xl text-verde">Neste ponto</p>
          <p className="font-mono text-[11px] text-texto-2">{ponto.lat.toFixed(5)}, {ponto.lng.toFixed(5)}</p>
        </div>
        <BotaoFechar onClick={() => setPonto(null)} />
      </div>
      {ponto.ambiente && <LinhaAmbiente itens={ponto.ambiente} />}
      {ponto.relevo && <LinhaRelevo lng={ponto.lng} lat={ponto.lat} />}
      {ponto.oficiais.length > 0 && <ListaNoPonto itens={ponto.oficiais} />}
    </div>,
    mapa.getContainer(),
  );
}
