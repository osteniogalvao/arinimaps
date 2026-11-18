"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CAMADAS_OFICIAIS, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import type { CamadasTour } from "@/lib/map/acesso-tour";
import { GerenciadorCamadasOficiais, type EstadoCamada } from "@/components/map/camadasOficiaisMapa";
import { CAMADAS_RELEVO, GerenciadorRelevo, type RelevoId } from "@/components/map/camadasRelevo";
import RelevoNasAreas from "@/components/map/RelevoNasAreas";
import Link from "next/link";
import { Lock } from "lucide-react";

function alternar<T>(atual: Set<T>, id: T) {
  const proximo = new Set(atual);
  if (proximo.has(id)) proximo.delete(id);
  else proximo.add(id);
  return proximo;
}

export default function CamadasDoTour({ mapa, geometria, permitidas, aoGerente, aoRelevo, claro = false }: {
  mapa: MLMap; geometria: GeoJSON.Polygon | GeoJSON.MultiPolygon; permitidas: CamadasTour;
  /** o cartão "Neste ponto" pergunta a este gerente o que as camadas ligadas têm no clique */
  aoGerente?: (g: GerenciadorCamadasOficiais | null) => void;
  /** camadas de relevo ligadas (para a altitude no clique) */
  aoRelevo?: (ativas: ReadonlySet<RelevoId>) => void;
  /** no mapa da consulta (fundo claro), sem o dourado do painel escuro do tour */
  claro?: boolean;
}) {
  const [oficiais, setOficiais] = useState(new Set<CamadaOficialId>());
  const [relevo, setRelevo] = useState(new Set<RelevoId>());
  const [estado, setEstado] = useState<Partial<Record<CamadaOficialId, EstadoCamada>>>({});
  const [avisos, setAvisos] = useState<Partial<Record<RelevoId, string>>>({});
  const [gerenteRelevo, setGerenteRelevo] = useState<GerenciadorRelevo | null>(null);
  const gerente = useRef<GerenciadorCamadasOficiais | null>(null);
  const areas = useMemo<GeoJSON.Polygon[]>(() => geometria.type === "Polygon" ? [geometria]
    : geometria.coordinates.map(coordinates => ({type: "Polygon", coordinates})), [geometria]);
  const aoErro = useCallback((id: RelevoId, aviso: string) => setAvisos(anterior => anterior[id] === aviso ? anterior : { ...anterior, [id]: aviso }), []);
  useEffect(() => {
    const oficiais = new GerenciadorCamadasOficiais(mapa, setEstado, true);
    gerente.current = oficiais;
    aoGerente?.(oficiais);
    return () => { gerente.current = null; aoGerente?.(null); oficiais.destruir(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa]);
  useEffect(() => { aoRelevo?.(relevo); }, [relevo, aoRelevo]);
  useEffect(() => () => gerenteRelevo?.destruir(), [gerenteRelevo]);
  useEffect(() => {
    gerente.current?.atualizarSelecao(new Set(), areas.map((geometria, i) => ({
      id: String(i), nome: "Área do tour", geometria, camadas: oficiais, car: false, relevo: new Set(),
    })));
  }, [areas, oficiais]);
  const bloqueadas = [
    ...CAMADAS_RELEVO.filter(c => !permitidas.relevo.includes(c.id)).map(c => c.nome),
    ...CAMADAS_OFICIAIS.filter(c => !permitidas.oficiais.includes(c.id)).map(c => c.nome),
  ];
  return <>
    <details className="mt-3 text-sm" open>
      <summary className={"cursor-pointer font-semibold " + (claro ? "text-verde" : "text-[#FFE299]")}>Camadas nesta área</summary>
      <div className={"mt-2 space-y-1 overflow-auto " + (claro ? "grid gap-x-4 sm:grid-cols-2" : "max-h-[30vh]")}>
        {CAMADAS_RELEVO.filter(c => permitidas.relevo.includes(c.id)).map(c =>
          <label key={c.id} className="block"><input type="checkbox" checked={relevo.has(c.id)} onChange={() => {
            if (!gerenteRelevo) setGerenteRelevo(new GerenciadorRelevo(mapa, () => {}, "escuro"));
            setAvisos(v => ({...v, [c.id]: ""})); setRelevo(v => alternar(v, c.id));
          }} /> {c.nome}{relevo.has(c.id) && avisos[c.id] && <small className="block">{avisos[c.id]}</small>}</label>)}
        {CAMADAS_OFICIAIS.filter(c => permitidas.oficiais.includes(c.id)).map(c =>
          <label key={c.id} className="block"><input type="checkbox" checked={oficiais.has(c.id)} onChange={() => setOficiais(v => alternar(v, c.id))} /> {c.nome}
            {oficiais.has(c.id) && <small aria-live="polite" className="block">{estado[c.id]?.carregando ? "Carregando…" : estado[c.id]?.aviso || (estado[c.id] ? estado[c.id]?.total === 1 ? "1 feição na área" : estado[c.id]?.total + " feições na área" : "")}</small>}
          </label>)}
        {/* áudio do Carlos (17/11, 22h14): o que o plano não inclui fica à vista, bloqueado, com o caminho para aumentar o plano */}
        {bloqueadas.map(nome => <span key={nome} className="flex items-center gap-1.5 opacity-60" title="Não incluída no seu plano">
          <Lock className="size-3.5 shrink-0" /> {nome}
        </span>)}
      </div>
      {bloqueadas.length > 0 && <p className="mt-2 text-xs opacity-80">
        {bloqueadas.length === 1 ? "1 camada bloqueada" : `${bloqueadas.length} camadas bloqueadas`} no seu plano. <Link href="/planos" className="font-semibold underline">Aumentar o plano</Link>
      </p>}
    </details>
    {gerenteRelevo && [...relevo].map(id => <RelevoNasAreas key={id} mapa={mapa} gerente={gerenteRelevo} id={id} areas={areas} aoErro={aoErro} />)}
  </>;
}
