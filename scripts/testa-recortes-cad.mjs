// node scripts/testa-recortes-cad.mjs
import assert from "node:assert/strict";
import vtpbf from "vt-pbf";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { createJiti } from "jiti";
import { pontoNaArea as pertenceNoWorker } from "../worker/jobs/ajustes.mjs";

const jiti = createJiti(import.meta.url);
const { cortarTileCar } = jiti("../src/lib/map/cortarTileCar.ts");
const { recortesNoTile } = jiti("../src/lib/map/recortesUrbanos.ts");
const { detectarBlocosCad, termosDescricaoCad } = jiti("../src/lib/geo/blocosCad.ts");
const { centroArea, partesDasLinhas, ajustarPorPontos, aplicarMatrizPonto, afim, TRANSFORM_ZERO } = jiti("../src/lib/geo/deslocar.ts");

const z = 12, x = 1475, y = 2275, n = 2 ** z;
const lnglat = ([i, j]) => [(x + i / 4096) / n * 360 - 180,
  Math.atan(Math.sinh(Math.PI * (1 - (y + j / 4096) * 2 / n))) * 180 / Math.PI];
const ret = (x1, y1, x2, y2) => [[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]];
const entrada = vtpbf.fromGeojsonVt({ car: { features: [
  { type: 3, id: 19, tags: { cod: "teste", area_ha: 543 }, geometry: [ret(200,200,3900,3900)] },
] }, etiquetas: { features: [{ type: 1, tags: { nome: "teste" }, geometry: [[500,500]] }] } }, { version: 2 });
function recorte(ring) {
  const anel = ring.map(lnglat);
  return { geometry: { type: "Polygon", coordinates: [anel] }, bbox: [
    Math.min(...anel.map(p=>p[0])), Math.min(...anel.map(p=>p[1])),
    Math.max(...anel.map(p=>p[0])), Math.max(...anel.map(p=>p[1])),
  ] };
}
const mascara = recorte(ret(1400,1000,2600,3300));
assert.equal(recortesNoTile([mascara], z, x, y).length, 1);
assert.equal(recortesNoTile([mascara], z, x + 1, y).length, 0);
assert.equal(cortarTileCar(entrada,z,x,y,[]), entrada);
const cortado = new VectorTile(new Pbf(cortarTileCar(entrada,z,x,y,[mascara])));
const car = cortado.layers.car.feature(0), geog = car.toGeoJSON(x,y,z);
assert.equal(car.id, 19); assert.equal(car.properties.area_ha, 543);
assert.equal(cortado.layers.etiquetas.length, 1);
assert.equal(booleanPointInPolygon(lnglat([2000,2000]), geog), false);
assert.equal(booleanPointInPolygon(lnglat([400,2000]), geog), true);
const total = new VectorTile(new Pbf(cortarTileCar(entrada,z,x,y,[recorte(ret(0,0,4096,4096))])));
assert.equal(total.layers.car?.length ?? 0, 0);
assert.equal(new VectorTile(new Pbf(entrada)).layers.car.feature(0).loadGeometry().length, 1);

const a = ret(0,0,100,100).map(lnglat), b = ret(150,0,250,100).map(lnglat);
const trechos = a.slice(0,-1).map((p,i) => [p,a[i+1]]);
const f = (layer, coordinates) => ({ type: "Feature", properties: { layer }, geometry: { type:"MultiLineString", coordinates } });
const fc = { type: "FeatureCollection", features: [f("QUADRAS", [b]), f("LOTES", trechos), f("ÁREA VERDE", [a])] };
const blocos = detectarBlocosCad(fc, new Set(), new Set(), () => true);
assert.deepEqual(blocos.map(b => b.nomeCad), ["QUADRAS", "LOTES"]);
assert.deepEqual(Array.from(partesDasLinhas(fc.features[1], [blocos[1].area])), [0,0,0,0]);
for (const [p, q] of trechos) assert(pertenceNoWorker([(p[0]+q[0])/2,(p[1]+q[1])/2],blocos[1].area));
const centro = centroArea(blocos[1].area), base = { ...TRANSFORM_ZERO, escala:1.04, rotacaoGraus:3 };
const ponto = aplicarMatrizPonto(afim(centro, base), a[1]);
const um = ajustarPorPontos([{planta:ponto,satelite:[ponto[0]+0.0001,ponto[1]]}],centro,base);
assert.equal(um.escala, base.escala); assert.equal(um.rotacaoGraus, base.rotacaoGraus);
const destino = {...base, offsetLesteM:18, offsetNorteM:-6};
const pares = a.slice(0,3).map(p => ({planta:aplicarMatrizPonto(afim(centro,base),p),satelite:aplicarMatrizPonto(afim(centro,destino),p)}));
const tres = ajustarPorPontos(pares,centro,base);
assert(Math.abs(tres.offsetLesteM-18)<0.001 && Math.abs(tres.offsetNorteM+6)<0.001 && tres.residuoM<0.001);
assert.deepEqual(termosDescricaoCad("apagar linhas de área verde"), ["area","verde"]);
assert.deepEqual(termosDescricaoCad("apagar arruamentos"), ["arruamento"]);
assert.deepEqual(termosDescricaoCad("apagar todas as linhas"), []);
console.log("Recorte nacional parcial/total, atributos, quadras, perímetros, pontos de controle e comandos CAD conferidos.");
