"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CAMADAS_OFICIAIS, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import type { CamadasTour } from "@/lib/map/acesso-tour";
import { GerenciadorCamadasOficiais, type EstadoCamada } from "@/components/map/camadasOficiaisMapa";
import { CAMADAS_RELEVO, GerenciadorRelevo, type RelevoId } from "@/components/map/camadasRelevo";
import RelevoNasAreas from "@/components/map/RelevoNasAreas";

function alternar<T>(atual: Set<T>, id: T) {
  const proximo = new Set(atual);
  if (proximo.has(id)) proximo.delete(id);
  else proximo.add(id);
  return proximo;
}

export default function CamadasDoTour({ mapa, geometria, permitidas }: {
  mapa: MLMap; geometria: GeoJSON.Polygon | GeoJSON.MultiPolygon; permitidas: CamadasTour;
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
    return () => { gerente.current = null; oficiais.destruir(); };
  }, [mapa]);
  useEffect(() => () => gerenteRelevo?.destruir(), [gerenteRelevo]);
  useEffect(() => {
    gerente.current?.atualizarSelecao(new Set(), areas.map((geometria, i) => ({
      id: String(i), nome: "Área do tour", geometria, camadas: oficiais, car: false, relevo: new Set(),
    })));
  }, [areas, oficiais]);
  return <>
    <details className="mt-3 text-sm" open>
      <summary className="cursor-pointer font-semibold text-[#FFE299]">Camadas nesta área</summary>
      <div className="mt-2 max-h-[30vh] space-y-1 overflow-auto">
        {CAMADAS_RELEVO.filter(c => permitidas.relevo.includes(c.id)).map(c =>
          <label key={c.id} className="block"><input type="checkbox" checked={relevo.has(c.id)} onChange={() => {
            if (!gerenteRelevo) setGerenteRelevo(new GerenciadorRelevo(mapa, () => {}, "escuro"));
            setAvisos(v => ({...v, [c.id]: ""})); setRelevo(v => alternar(v, c.id));
          }} /> {c.nome}{relevo.has(c.id) && avisos[c.id] && <small className="block">{avisos[c.id]}</small>}</label>)}
        {CAMADAS_OFICIAIS.filter(c => permitidas.oficiais.includes(c.id)).map(c =>
          <label key={c.id} className="block"><input type="checkbox" checked={oficiais.has(c.id)} onChange={() => setOficiais(v => alternar(v, c.id))} /> {c.nome}
            {oficiais.has(c.id) && <small aria-live="polite" className="block">{estado[c.id]?.carregando ? "Carregando…" : estado[c.id]?.aviso || (estado[c.id] ? estado[c.id]?.total === 1 ? "1 feição na área" : estado[c.id]?.total + " feições na área" : "")}</small>}
          </label>)}
      </div>
    </details>
    {gerenteRelevo && [...relevo].map(id => <RelevoNasAreas key={id} mapa={mapa} gerente={gerenteRelevo} id={id} areas={areas} aoErro={aoErro} />)}
  </>;
}
