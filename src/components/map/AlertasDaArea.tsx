"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { LoaderCircle } from "lucide-react";
import { camadaOficialPorId, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import { GerenciadorCamadasOficiais, type EstadoCamada } from "./camadasOficiaisMapa";

/**
 * "Foi desmatado ou não?" na consulta da área (vídeo do Carlos, 17/11/2026
 * 16h31: "está faltando as opções de desmatamento"). Cada chip liga a camada
 * oficial recortada na divisa e diz quantos registros caem dentro dela.
 * Desmatamento junta o PRODES do Cerrado e o dos outros biomas.
 */
const GRUPOS: { id: string; nome: string; camadas: CamadaOficialId[]; ligado: boolean }[] = [
  { id: "desmatamento", nome: "Desmatamento (PRODES)", camadas: ["prodes_cerrado", "prodes_biomas"], ligado: true },
  { id: "embargos", nome: "Embargos IBAMA", camadas: ["ibama_embargos"], ligado: true },
  { id: "autos", nome: "Autos de infração", camadas: ["ibama_autos"], ligado: false },
  { id: "queimadas", nome: "Queimadas (12 meses)", camadas: ["inpe_queimadas"], ligado: false },
];

function poligonos(g: GeoJSON.Geometry): GeoJSON.Polygon[] {
  if (g.type === "Polygon") return [g];
  if (g.type === "MultiPolygon") return g.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  return [];
}

export default function AlertasDaArea({ mapa, geometria }: { mapa: MLMap; geometria: GeoJSON.Geometry }) {
  const [ligados, setLigados] = useState(() => new Set(GRUPOS.filter((g) => g.ligado).map((g) => g.id)));
  const [estado, setEstado] = useState<Partial<Record<CamadaOficialId, EstadoCamada>>>({});
  const gerente = useRef<GerenciadorCamadasOficiais | null>(null);
  const areas = useMemo(() => poligonos(geometria), [geometria]);

  useEffect(() => {
    const g = new GerenciadorCamadasOficiais(mapa, setEstado, true);
    gerente.current = g;
    return () => { gerente.current = null; g.destruir(); };
  }, [mapa]);

  useEffect(() => {
    const camadas = new Set(GRUPOS.filter((g) => ligados.has(g.id)).flatMap((g) => g.camadas));
    const aplicar = () => gerente.current?.atualizarSelecao(new Set(), areas.map((geometria, i) => ({
      id: String(i), nome: "Área consultada", geometria, camadas, car: false, relevo: new Set(),
    })));
    if (mapa.isStyleLoaded()) aplicar(); else mapa.once("load", aplicar);
    return () => { mapa.off("load", aplicar); };
  }, [mapa, areas, ligados]);

  if (!areas.length) return null;
  return (
    <fieldset>
      <legend className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">Desmatamento e alertas na área · toque para ligar ou desligar</legend>
      <div className="flex flex-wrap gap-2">
        {GRUPOS.map((g) => {
          const ligado = ligados.has(g.id);
          const cor = camadaOficialPorId(g.camadas[0])?.cor ?? "#C6FF00";
          const estados = g.camadas.map((c) => estado[c]).filter((e): e is EstadoCamada => !!e);
          const carregando = ligado && estados.some((e) => e.carregando);
          const total = estados.reduce((s, e) => s + (e.total || 0), 0);
          const falhou = ligado && !carregando && estados.length > 0 && estados.every((e) => !!e.aviso);
          const resultado = !ligado ? "" : carregando ? "" : falhou ? "sem resposta" : estados.length ? (total ? `${total.toLocaleString("pt-BR")} na área` : "nada na área") : "";
          return (
            <button key={g.id} type="button" role="checkbox" aria-checked={ligado}
              title={falhou ? estados.find((e) => e.aviso)?.aviso : undefined}
              onClick={() => setLigados((v) => { const n = new Set(v); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
              className={"inline-flex min-h-9 items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition " +
                (ligado ? "text-[#0a2119] shadow-sm" : "border-linha bg-transparent text-texto-2 opacity-70")}
              style={ligado ? { backgroundColor: cor, borderColor: cor } : undefined}>
              <span aria-hidden className="size-2.5 rounded-full border border-black/30" style={{ backgroundColor: ligado ? "#0a2119" : cor }} />
              {g.nome}
              {carregando && <LoaderCircle className="size-3.5 animate-spin" aria-label="Consultando" />}
              {resultado && <span className={total ? "font-black" : "font-semibold opacity-80"}>{resultado}</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-texto-2">Dados ao vivo do INPE (PRODES e focos de queimada) e do IBAMA, recortados na divisa. Um registro na área pede conferência da data e da regularização.</p>
    </fieldset>
  );
}
