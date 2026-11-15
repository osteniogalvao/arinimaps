import { recortarCamada } from "@/lib/map/recorteCamadas";
import { union } from "@turf/turf";
import { feature, featureCollection } from "@turf/helpers";

function reunirPartesCAR(dados: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const partes = new Map<string, GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[]>();
  for (const f of dados.features) {
    if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") continue;
    const cod = String(f.properties?.cod || "");
    if (!cod) continue;
    const lista = partes.get(cod) ?? [];
    lista.push(feature(f.geometry, f.properties));
    partes.set(cod, lista);
  }
  const features: GeoJSON.Feature[] = [];
  for (const lista of partes.values()) {
    const f =
      lista.length === 1
        ? lista[0]
        : union(featureCollection(lista), { properties: lista[0].properties ?? {} });
    if (f) features.push(f);
  }
  return { type: "FeatureCollection", features };
}

self.onmessage = (
  e: MessageEvent<{
    dados: GeoJSON.FeatureCollection;
    areas: GeoJSON.Polygon[];
    contorno: boolean;
    car: boolean;
  }>,
) => {
  try {
    const dados = e.data.car ? reunirPartesCAR(e.data.dados) : e.data.dados;
    self.postMessage({ dados: recortarCamada(dados, e.data.areas, e.data.contorno) });
  } catch {
    self.postMessage({ erro: "Não foi possível recortar a geometria desta camada." });
  }
};
