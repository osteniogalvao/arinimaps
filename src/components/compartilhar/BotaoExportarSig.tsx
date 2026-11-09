"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileArchive, FileCode2, Globe2, LoaderCircle } from "lucide-react";
import type { Atributos, CamadaSig } from "@/lib/geo/exportarSig";

type Props = {
  /** começo do nome dos arquivos (ex.: AIB-000001) */
  nomeBase: string;
  /** divisa já carregada na página (a ficha e a consulta já a mostram no mapa) */
  divisa?: { geometry: GeoJSON.Geometry; atributos: Atributos; rotulo?: string } | null;
  /** código do CAR: a divisa do CAR é buscada no clique (/api/geo/car/…) */
  carCodigo?: string | null;
  className?: string;
};

type Formato = "kml" | "geojson" | "shp";

const BOTAO_PADRAO =
  "flex w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-linha-forte py-3 text-sm font-bold text-texto transition hover:border-verde hover:text-verde";
const ITEM = "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-texto transition hover:bg-superficie-2";

const nomeArquivo = (s: string) => s.normalize("NFD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

/**
 * Exportar para SIG (segunda etapa, item 8): KML, GeoJSON e Shapefile (zip)
 * da divisa e, quando houver, do CAR. A geração é toda no navegador e a lib
 * (src/lib/geo/exportarSig.ts) só carrega no clique.
 *
 * Quem vê o botão é quem já vê a geometria: a página só o mostra quando tem a
 * divisa (mesma regra da ficha, que desenha a divisa no mapa).
 */
export default function BotaoExportarSig({ nomeBase, divisa, carCodigo, className }: Props) {
  const [aberto, setAberto] = useState(false);
  const [gerando, setGerando] = useState<Formato | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const carCache = useRef<CamadaSig | null | undefined>(undefined);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  if (!divisa && !carCodigo) return null;

  async function camadaCar(): Promise<CamadaSig | null> {
    if (!carCodigo) return null;
    if (carCache.current !== undefined) return carCache.current;
    const r = await fetch(`/api/geo/car/${encodeURIComponent(carCodigo)}`);
    if (!r.ok) { carCache.current = null; return null; }
    const f = await r.json() as { geometry?: GeoJSON.Geometry; properties?: Record<string, unknown> };
    const p = f.properties ?? {};
    carCache.current = f.geometry ? {
      nome: "car", rotulo: `CAR ${carCodigo}`, geometry: f.geometry,
      atributos: {
        cod_car: carCodigo,
        area_ha: p.area_ha != null ? Number(p.area_ha) : null,
        municipio: (p.municipio as string | null) ?? null,
        situacao: (p.status as string | null) ?? null,
        fonte: "SICAR",
      },
    } : null;
    return carCache.current;
  }

  async function exportar(formato: Formato) {
    setGerando(formato); setErro(null);
    try {
      const lib = await import("@/lib/geo/exportarSig");
      const camadas: CamadaSig[] = [];
      if (divisa && lib.temPoligono(divisa.geometry)) {
        camadas.push({ nome: "divisa", rotulo: divisa.rotulo ?? `Divisa ${nomeBase}`, geometry: divisa.geometry, atributos: divisa.atributos });
      }
      const car = await camadaCar().catch(() => null);
      if (car && lib.temPoligono(car.geometry)) camadas.push(car);
      if (!camadas.length) { setErro("Não há divisa para exportar."); return; }

      const base = nomeArquivo(nomeBase);
      if (formato === "geojson") lib.baixar(lib.paraGeoJSON(camadas), `${base}.geojson`, "application/geo+json");
      else if (formato === "kml") lib.baixar(lib.paraKML(camadas, nomeBase), `${base}.kml`, "application/vnd.google-earth.kml+xml");
      else lib.baixar(await lib.paraShapefileZip(camadas), `${base}-shapefile.zip`, "application/zip");
      if (carCodigo && !car) setErro("A divisa do CAR não pôde ser carregada; o arquivo saiu só com a divisa.");
      else setAberto(false);
    } catch {
      setErro("Não foi possível gerar o arquivo. Tente de novo.");
    } finally {
      setGerando(null);
    }
  }

  const opcoes: { id: Formato; rotulo: string; ajuda: string; icone: typeof Globe2 }[] = [
    { id: "kml", rotulo: "KML", ajuda: "Google Earth e a maioria dos apps de mapa", icone: Globe2 },
    { id: "geojson", rotulo: "GeoJSON", ajuda: "QGIS, web e sistemas próprios", icone: FileCode2 },
    { id: "shp", rotulo: "Shapefile (zip)", ajuda: "ArcGIS, QGIS e órgãos públicos", icone: FileArchive },
  ];

  return (
    <div ref={caixa} className="relative print:hidden">
      <button type="button" aria-haspopup="menu" aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)} className={className ?? BOTAO_PADRAO}>
        <Download className="size-4" /> Exportar
        <ChevronDown className={`size-4 transition ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-2 w-full min-w-[17rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-linha-forte bg-fundo p-1.5 shadow-xl">
          <p className="px-3 pb-1 pt-2 text-xs text-texto-2">
            {divisa && carCodigo ? "Divisa do imóvel e divisa do CAR, em graus (WGS 84)."
              : carCodigo ? "Divisa do CAR, em graus (WGS 84)." : "Divisa, em graus (WGS 84)."}
          </p>
          {opcoes.map((o) => (
            <button key={o.id} type="button" role="menuitem" className={ITEM} disabled={!!gerando} onClick={() => exportar(o.id)}>
              {gerando === o.id ? <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-verde" /> : <o.icone className="mt-0.5 size-4 shrink-0 text-verde" />}
              <span><span className="block font-semibold">{o.rotulo}</span>
                <span className="block text-xs text-texto-2">{o.ajuda}</span></span>
            </button>
          ))}
          {erro && <p className="px-3 pb-2 pt-1 text-xs text-alerta">{erro}</p>}
        </div>
      )}
    </div>
  );
}
