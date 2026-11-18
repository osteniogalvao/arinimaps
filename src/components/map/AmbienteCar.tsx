"use client";

import { useEffect, useMemo, useState } from "react";
import type { Map as Mapa, GeoJSONSource } from "maplibre-gl";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import area from "@turf/area";
import { CORES_AMBIENTE as CORES, NOME_CURTO, TEMAS_AMBIENTE as TEMAS, formatarHa, quadroAmbiental, type TemaAmbiente as Tema } from "@/lib/geo/ambienteCar";
import { registrarAmbiente } from "./InfoNoPonto";
type Dados = GeoJSON.FeatureCollection<GeoJSON.Geometry, { tema: Tema; fonte: string; data: string | null }>;
const IDS = ["car-ambiental-poligono", "car-ambiental-linha", "car-ambiental-ponto"];
const FONTE = "car-ambiental-imovel";

/**
 * Camadas ambientais do imóvel do CAR sobre o mapa.
 * 17/11/2026 (áudio do Carlos, 11h49): cores vibrantes, seletores em chips
 * coloridos com os hectares de cada tema e, na consulta (`quadro`), o quadro
 * ambiental com APP, reserva e o resto em hectares e % do imóvel.
 */
export default function AmbienteCar({ cod, mapa, tour = false, quadro = false, areaHa }: { cod: string; mapa: Mapa | null; tour?: boolean; quadro?: boolean; areaHa?: number | null }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const [ocultos, setOcultos] = useState<Tema[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/geo/car/" + encodeURIComponent(cod) + "/ambiente" + (tour ? "?tour=1" : ""), { signal: ctrl.signal })
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Falha ao consultar a área.");
        if (!ctrl.signal.aborted) setDados(j as Dados);
      })
      .catch(e => { if (!ctrl.signal.aborted) setErro(e.message || "Falha ao consultar a área."); });
    return () => ctrl.abort();
  }, [cod, tentativa, tour]);
  const visiveis = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection", features: (dados?.features ?? []).filter(f => !ocultos.includes(f.properties.tema))
      .map(f => ({ ...f, properties: { ...f.properties, cor: CORES[f.properties.tema] } })),
  }), [dados, ocultos]);
  useEffect(() => {
    if (!mapa) return;
    const instalar = () => {
      if (mapa.getSource(FONTE)) return;
      mapa.addSource(FONTE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      mapa.addLayer({ id: IDS[0], source: FONTE, type: "fill", filter: ["all", ["==", ["geometry-type"], "Polygon"], ["!=", ["get", "tema"], "area_imovel"]], paint: { "fill-color": ["get", "cor"], "fill-opacity": 0.55 } });
      mapa.addLayer({ id: IDS[1], source: FONTE, type: "line", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": ["get", "cor"], "line-width": ["case", ["==", ["get", "tema"], "area_imovel"], 3, 2.2] } });
      mapa.addLayer({ id: IDS[2], source: FONTE, type: "circle", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": CORES.nascente, "circle-radius": 5, "circle-stroke-color": "#124431", "circle-stroke-width": 1.5 } });
    };
    if (mapa.getSource("imovel") || mapa.getSource("car") || mapa.isStyleLoaded()) instalar(); else mapa.once("load", instalar);
    return () => {
      mapa.off("load", instalar);
      if (!mapa.getStyle()) return;
      for (const id of IDS) if (mapa.getLayer(id)) mapa.removeLayer(id);
      if (mapa.getSource(FONTE)) mapa.removeSource(FONTE);
    };
  }, [mapa]);
  useEffect(() => {
    if (!mapa) return;
    const aplicar = () => (mapa.getSource(FONTE) as GeoJSONSource | undefined)?.setData(visiveis);
    if (mapa.getSource(FONTE)) aplicar(); else mapa.once("load", aplicar);
    return () => { mapa.off("load", aplicar); };
  }, [mapa, visiveis]);
  // vídeo do Carlos (17/11, 22h00): "aqui é uma reserva; eu cliquei, tem que aparecer quanto da reserva"
  useEffect(() => {
    if (!mapa || !dados) return;
    const poligonos = dados.features.filter(f => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"));
    const linhas = quadroAmbiental(dados.features, areaHa);
    return registrarAmbiente(mapa, (lng, lat) => {
      const pt: [number, number] = [lng, lat];
      const aqui = poligonos.filter(f => booleanPointInPolygon(pt, f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>));
      const temImovel = poligonos.some(f => f.properties.tema === "area_imovel");
      if (temImovel ? !aqui.some(f => f.properties.tema === "area_imovel") : !aqui.length) return "fora";
      const vistos = new Set<Tema>();
      return aqui.filter(f => f.properties.tema !== "area_imovel" && !ocultos.includes(f.properties.tema)).flatMap(f => {
        const t = f.properties.tema;
        if (vistos.has(t)) return [];
        vistos.add(t);
        const l = linhas.find(x => x.tema === t);
        return [{ tema: t, nome: NOME_CURTO[t], cor: CORES[t], ha: area(f) / 10_000, totalHa: l?.ha ?? area(f) / 10_000, pct: l?.pct ?? null }];
      });
    });
  }, [mapa, dados, ocultos, areaHa]);
  if (erro) return <p role="status" className="text-sm">{erro} <button type="button" className="underline" onClick={() => { setErro(""); setTentativa(t => t + 1); }}>Tentar novamente</button></p>;
  if (!dados) return <p role="status" className="text-sm">Consultando as feições desta área…</p>;
  const linhas = quadroAmbiental(dados.features, areaHa);
  const alternar = (t: Tema) => setOcultos(atual => atual.includes(t) ? atual.filter(x => x !== t) : [...atual, t]);
  const ocupado = linhas.filter(l => l.pct !== null && l.tema !== "hidrografia").reduce((m, l) => Math.max(m, l.pct ?? 0), 0);
  return <div className="space-y-3">
    <fieldset>
      <legend className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">Camadas deste imóvel · toque para ligar ou desligar</legend>
      {!linhas.length && <p className="text-sm text-texto-2">O SICAR não traz APP, reserva ou outras camadas para este imóvel na base carregada.</p>}
      <div className="flex flex-wrap gap-2">
        {linhas.map(l => {
          const ligado = !ocultos.includes(l.tema);
          return <button key={l.tema} type="button" role="checkbox" aria-checked={ligado} onClick={() => alternar(l.tema)} title={TEMAS[l.tema]}
            className={"inline-flex min-h-9 items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition " + (ligado ? "text-[#0a2119] shadow-sm" : "border-linha bg-transparent text-texto-2 opacity-70")}
            style={ligado ? { backgroundColor: l.cor, borderColor: l.cor } : undefined}>
            <span aria-hidden className="size-2.5 rounded-full border border-black/30" style={{ backgroundColor: ligado ? "#0a2119" : l.cor }} />
            {l.nome}
            <span className={ligado ? "font-semibold opacity-80" : "font-normal"}>{l.tema === "nascente" ? l.feicoes.toLocaleString("pt-BR") : formatarHa(l.ha)}</span>
          </button>;
        })}
      </div>
    </fieldset>
    {quadro && linhas.length > 0 && <div className="overflow-hidden rounded-2xl border border-linha">
      <p className="flex items-baseline justify-between gap-3 border-b border-linha bg-superficie-2/60 px-4 py-2.5">
        <span className="text-sm font-bold text-texto">Quadro ambiental do imóvel</span>
        <span className="text-[11px] text-texto-2">declarado no SICAR{areaHa ? ` · imóvel com ${formatarHa(areaHa)}` : ""}</span>
      </p>
      <ul className="divide-y divide-linha">
        {linhas.map(l => <li key={l.tema} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[11rem_1fr_auto]">
          <span className="flex items-center gap-2 text-sm font-semibold text-texto"><span aria-hidden className="size-3 rounded-sm" style={{ backgroundColor: l.cor }} />{l.nome}</span>
          <span className="order-3 col-span-2 h-2.5 overflow-hidden rounded-full bg-linha/60 sm:order-none sm:col-span-1">
            {l.pct !== null && <span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, ocupado ? (l.pct / Math.max(ocupado, 1)) * 100 : 0)}%`, backgroundColor: l.cor }} />}
          </span>
          <span className="text-right text-sm tabular-nums">
            <strong className="text-texto">{l.tema === "nascente" ? `${l.feicoes.toLocaleString("pt-BR")} ${l.feicoes === 1 ? "ponto" : "pontos"}` : formatarHa(l.ha)}</strong>
            {l.pct !== null && <span className="ml-1.5 text-xs text-texto-2">{l.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>}
          </span>
        </li>)}
      </ul>
    </div>}
    <p className="text-xs text-texto-2">Áreas somadas das feições declaradas no SICAR dentro da divisa; temas podem se sobrepor (a APP pode estar dentro da reserva). Nascentes da FBDS têm localização aproximada. A cobertura depende do município e da data da base.</p>
  </div>;
}
