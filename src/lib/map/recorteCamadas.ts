import { bbox } from "@turf/bbox";
import { feature, featureCollection } from "@turf/helpers";
import { intersect } from "@turf/intersect";
import { booleanPointInPolygon, booleanPointOnLine, union } from "@turf/turf";
import { recortarLinha } from "./recorteLinha";

/** Recorta de fato os polígonos que atravessam a divisa. Unir as áreas antes
 * do recorte evita duplicar feições e contornos quando dois recortes se tocam. */
export function recortarCamada(
  dados: GeoJSON.FeatureCollection,
  areas: GeoJSON.Polygon[],
  separarContorno = false,
): GeoJSON.FeatureCollection {
  const mascara =
    areas.length === 1 ? feature(areas[0]) : union(featureCollection(areas.map((g) => feature(g))));
  if (!mascara) return { type: "FeatureCollection", features: [] };
  const [oeste, sul, leste, norte] = bbox(mascara);
  const aneis =
    mascara.geometry.type === "Polygon" ? mascara.geometry.coordinates : mascara.geometry.coordinates.flat();
  const divisas = aneis.map((coordinates) => ({ type: "LineString" as const, coordinates }));
  const features: GeoJSON.Feature[] = [];
  for (const f of dados.features) {
    if (!f.geometry) continue;
    const [x0, y0, x1, y1] = bbox(f);
    if (x1 < oeste || x0 > leste || y1 < sul || y0 > norte) continue;
    if (f.geometry.type === "Point") {
      if (booleanPointInPolygon(f.geometry, mascara)) features.push(f);
    } else if (f.geometry.type === "MultiPoint") {
      const coordinates = f.geometry.coordinates.filter((p) => booleanPointInPolygon(p, mascara));
      if (coordinates.length) features.push({ ...f, geometry: { type: "MultiPoint", coordinates } });
    } else if (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString") {
      const linhas = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const coordinates = linhas.flatMap((linha) =>
        recortarLinha(
          linha,
          areas.map((a) => a.coordinates),
        ),
      );
      if (coordinates.length) features.push({ ...f, geometry: { type: "MultiLineString", coordinates } });
    } else if (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") {
      const parte = intersect(featureCollection([feature(f.geometry), mascara]));
      if (!parte) continue;
      features.push({ ...f, geometry: parte.geometry });
      // As arestas geradas pelo recorte não são limites cadastrais. Só as
      // linhas originais vão à camada de contorno; o desenho da área tem cor própria.
      if (separarContorno) {
        const aneisOriginais =
          f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
        const originais = aneisOriginais.map((coordinates) => ({ type: "LineString" as const, coordinates }));
        const aneisParte =
          parte.geometry.type === "Polygon" ? parte.geometry.coordinates : parte.geometry.coordinates.flat();
        const linhas: GeoJSON.Position[][] = [];
        for (const anel of aneisParte) {
          let trecho: GeoJSON.Position[] = [];
          for (let i = 1; i < anel.length; i++) {
            const a = anel[i - 1],
              b = anel[i];
            const meio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const soRecorte =
              divisas.some((l) => booleanPointOnLine(meio, l, { epsilon: 1e-13 })) &&
              !originais.some((l) => booleanPointOnLine(meio, l, { epsilon: 1e-13 }));
            if (soRecorte) {
              if (trecho.length) linhas.push(trecho);
              trecho = [];
            } else {
              if (!trecho.length) trecho.push(a);
              trecho.push(b);
            }
          }
          if (trecho.length) linhas.push(trecho);
        }
        if (linhas.length)
          features.push({
            type: "Feature",
            properties: {},
            geometry: { type: "MultiLineString", coordinates: linhas },
          });
      }
    }
  }
  return { type: "FeatureCollection", features };
}
