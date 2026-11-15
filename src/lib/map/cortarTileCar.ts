import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { difference, type Geom } from "polyclip-ts";
import codificar from "vt-pbf";
import type { RecorteUrbano } from "./recortesUrbanos";

/** Opera na grade inteira do tile, preservando os atributos e as outras camadas. */
export function cortarTileCar(bytes: Uint8Array, z: number, x: number, y: number, recortes: RecorteUrbano[]) {
  if (!bytes.length || !recortes.length) return bytes;
  const tile = new VectorTile(new Pbf(bytes)), car = tile.layers.car;
  if (!car) return bytes;
  const n = 2 ** z;
  const projetar = ([lng, lat]: number[]): [number, number] => {
    const sen = Math.sin(lat * Math.PI / 180);
    return [Math.round((((lng + 180) / 360) * n - x) * car.extent),
      Math.round(((0.5 - Math.log((1 + sen) / (1 - sen)) / (4 * Math.PI)) * n - y) * car.extent)];
  };
  const mascaras = recortes.map(r => ({ geom: r.geometry.coordinates.map(anel => anel.map(projetar)) as Geom,
    nw: projetar([r.bbox[0], r.bbox[3]]), se: projetar([r.bbox[2], r.bbox[1]]) }));
  const features: { id?: number; type: number; properties: Record<string, unknown>; loadGeometry(): { x: number; y: number }[][] }[] = [];
  for (let i = 0; i < car.length; i++) {
    const f = car.feature(i);
    if (f.type !== 3) { features.push(f); continue; }
    const [xmin, ymin, xmax, ymax] = f.bbox();
    const aplicaveis = mascaras.filter(m => xmax >= m.nw[0] && xmin <= m.se[0] && ymax >= m.nw[1] && ymin <= m.se[1]);
    if (!aplicaveis.length) { features.push(f); continue; }
    const poligonos = classifyRings(f.loadGeometry()).map(poly =>
      poly.map(anel => anel.map(p => [p.x, p.y] as [number, number])));
    if (!poligonos.length) continue;
    const restante = difference(poligonos, ...aplicaveis.map(m => m.geom));
    if (!restante.length) continue;
    // polyclip devolve os exteriores anti-horários em coordenadas cartesianas,
    // que correspondem a exteriores horários na grade MVT (Y cresce para baixo).
    const aneis = restante.flatMap(poly => poly.map(anel => anel.map(([px, py]) => ({ x: Math.round(px), y: Math.round(py) }))));
    features.push({ id: f.id, type: 3, properties: f.properties, loadGeometry: () => aneis });
  }
  return codificar({ layers: { ...tile.layers, car: {
    name: car.name, version: car.version, extent: car.extent, length: features.length,
    feature: (i: number) => features[i],
  } } });
}
