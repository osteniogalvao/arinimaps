"use client";

import { useEffect, useMemo, useState } from "react";
import type { Map as Mapa, GeoJSONSource } from "maplibre-gl";
import { TEMAS_CAR, type TemaCar } from "@/lib/geo/temasCar";

const TEMAS = { ...TEMAS_CAR, nascente: "Nascentes e minas d’água mapeadas" };
type Tema = TemaCar | "nascente";
const CORES: Record<Tema, string> = {
  area_imovel: "#FFE299", app: "#59D4AE", reserva_legal: "#54A864", vegetacao_nativa: "#8BBE52",
  area_consolidada: "#DBAB78", uso_restrito: "#B39DDB", servidao_administrativa: "#ED8B72",
  hidrografia: "#4EAAD8", area_pousio: "#C1AB8A", nascente: "#67DDF1",
};
type Dados = GeoJSON.FeatureCollection<GeoJSON.Geometry, { tema: Tema; fonte: string; data: string | null }>;
const IDS = ["car-ambiental-poligono", "car-ambiental-linha", "car-ambiental-ponto"];
const FONTE = "car-ambiental-imovel";

export default function AmbienteCar({ cod, mapa }: { cod: string; mapa: Mapa | null }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const [ocultos, setOcultos] = useState<Tema[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/geo/car/" + encodeURIComponent(cod) + "/ambiente", { signal: ctrl.signal })
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Falha ao consultar a área.");
        if (!ctrl.signal.aborted) setDados(j as Dados);
      })
      .catch(e => { if (!ctrl.signal.aborted) setErro(e.message || "Falha ao consultar a área."); });
    return () => ctrl.abort();
  }, [cod, tentativa]);
  const visiveis = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection", features: (dados?.features ?? []).filter(f => !ocultos.includes(f.properties.tema))
      .map(f => ({ ...f, properties: { ...f.properties, cor: CORES[f.properties.tema] } })),
  }), [dados, ocultos]);
  useEffect(() => {
    if (!mapa) return;
    const instalar = () => {
      if (mapa.getSource(FONTE)) return;
      mapa.addSource(FONTE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      mapa.addLayer({ id: IDS[0], source: FONTE, type: "fill", filter: ["all", ["==", ["geometry-type"], "Polygon"], ["!=", ["get", "tema"], "area_imovel"]], paint: { "fill-color": ["get", "cor"], "fill-opacity": 0.46 } });
      mapa.addLayer({ id: IDS[1], source: FONTE, type: "line", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": ["get", "cor"], "line-width": ["case", ["==", ["get", "tema"], "area_imovel"], 3, 1.5] } });
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
  if (erro) return <p role="status" className="text-sm">{erro} <button type="button" className="underline" onClick={() => { setErro(""); setTentativa(t => t + 1); }}>Tentar novamente</button></p>;
  if (!dados) return <p role="status" className="text-sm">Consultando as feições desta área…</p>;
  const temas = new Set(dados.features.map(f => f.properties.tema));
  return <fieldset className="space-y-1 text-sm"><legend className="mb-1 font-semibold">Camadas deste imóvel</legend>
    {(Object.keys(TEMAS) as Tema[]).filter(t => temas.has(t)).map(t => <label key={t} className="flex min-h-9 cursor-pointer items-center gap-2">
      <input type="checkbox" checked={!ocultos.includes(t)} onChange={() => setOcultos(atual => atual.includes(t) ? atual.filter(x => x !== t) : [...atual, t])} className="accent-verde"/>
      <span aria-hidden className="size-3 rounded-sm" style={{ backgroundColor: CORES[t] }} />{TEMAS[t]}
    </label>)}
    <p className="pt-1 text-xs text-texto-2">Divisa e temas declarados no SICAR. Nascentes da FBDS têm localização aproximada. A cobertura depende do município e da data da base.</p>
  </fieldset>;
}
