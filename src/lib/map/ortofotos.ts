import type { RasterSourceSpecification, StyleSpecification, RasterLayerSpecification } from "maplibre-gl";
import { SATELITE, SATELITE_ALTO } from "./config";

type Detalhe = { id: string; fonte: RasterSourceSpecification; ateZoom?: number };
type Limites = [number, number, number, number];

function fonteConfigurada(): Detalhe | null {
  const raw = process.env.NEXT_PUBLIC_ORTOFOTO_JSON;
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d.tiles !== "string" || !d.tiles.startsWith("https://") ||
        !["{x}","{y}","{z}"].every(t=>d.tiles.includes(t)) ||
        typeof d.atribuicao !== "string" || !d.atribuicao.trim() ||
        !Number.isInteger(d.zoomMin) || !Number.isInteger(d.zoomMax) ||
        d.zoomMin<0 || d.zoomMax>24 || d.zoomMin>d.zoomMax ||
        !Array.isArray(d.limites) || d.limites.length!==4 || !d.limites.every(Number.isFinite)) return null;
    const [w,s,e,n] = d.limites as Limites;
    if (w < -180 || e > 180 || s < -85.051129 || n > 85.051129 || w>=e || s>=n) return null;
    const url = new URL(d.tiles);
    if (url.username || url.password) return null;
    const atribuicao = d.atribuicao.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
    return { id:"ortofoto-arini", fonte:{type:"raster",tiles:[d.tiles],bounds:[w,s,e,n],
      minzoom:d.zoomMin,maxzoom:d.zoomMax,tileSize:256,attribution:atribuicao} };
  } catch {
    return null;
  }
}

// OAM informa 10 cm/pixel e CC BY 4.0. A fonte entrega transparência na borda do levantamento.
// https://api.openaerialmap.org/meta/6857f106e621473750c0efd6
const fazendaLaranja: Detalhe = {
  id:"ortofoto-iturama-laranja",
  fonte:{
    type:"raster",tileSize:256,minzoom:16,maxzoom:21,
    bounds:[-50.069668,-19.750108,-50.059501,-19.743568],
    tiles:["https://tiles.openaerialmap.org/6857efe0e621473750c0ec3a/0/6857efe0e621473750c0ec3b/{z}/{x}/{y}"],
    attribution:'Ortofoto Fazenda Laranja · GJS Consultoria e Projetos (04/04/2025; 10 cm), ' +
      '<a href="https://api.openaerialmap.org/meta/6857f106e621473750c0efd6">OpenAerialMap</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
  },
};

const configurada = fonteConfigurada();
export const DETALHES_SATELITE: Detalhe[] = [
  {id:"mosaico-regional-sentinel",ateZoom:13,fonte:{
    type:"raster",minzoom:6,maxzoom:13,tileSize:256,
    tiles:["https://titiler.terrascope.be/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=esa-worldcover-s2rgbnir-10m-2021-v2_tcc&STYLES=&TIME=2021-01-01&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg"],
    attribution:"Mosaico Sentinel-2 de 2021 · © ESA WorldCover / Copernicus · CC BY 4.0",
  }},
  ...(SATELITE_ALTO ? [{id:"satelite-alto",fonte:SATELITE_ALTO}] : []),
  fazendaLaranja, ...(configurada ? [configurada] : []),
];
export const camadaDeDetalhe = ({id,fonte,ateZoom}: Detalhe, visivel=true): RasterLayerSpecification => ({
  id,type:"raster",source:id,minzoom:fonte.minzoom,...(ateZoom ? {maxzoom:ateZoom} : {}),layout:{visibility:visivel ? "visible" : "none"},
});
export function estiloSatelite(): StyleSpecification {
  return {
    version:8,
    sources:{ satelite:SATELITE,...Object.fromEntries(DETALHES_SATELITE.map(d=>[d.id,d.fonte])) },
    layers:[{id:"satelite",type:"raster",source:"satelite"},...DETALHES_SATELITE.map(d=>camadaDeDetalhe(d))],
  };
}
