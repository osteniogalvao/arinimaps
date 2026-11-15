import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import test from "node:test";
import { area } from "@turf/area";
import { featureCollection, point, polygon } from "@turf/helpers";

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } });
const { recortarCamada } = jiti("../src/lib/map/recorteCamadas.ts");
const retangulo = (x, y, lado) => polygon([[[x, y], [x + lado, y], [x + lado, y + lado], [x, y + lado], [x, y]]]);
const parcela = retangulo(0, 0, 4);
const dados = featureCollection([parcela, point([1, 1]), point([9, 9])]);

test("o recorte parcial preserva a divisa verdadeira e não cria uma divisa sobre o limite da seleção", () => {
  const a = retangulo(-1, 1, 2), b = retangulo(0, 1, 2);
  const recortadas = recortarCamada(dados, [a.geometry, b.geometry], true);
  assert.equal(recortadas.features.filter(f => f.geometry.type === "Polygon").length, 1);
  assert.deepEqual(recortadas.features.find(f => f.geometry.type === "Point").geometry.coordinates, [1, 1]);
  assert.equal(area(recortadas), area(retangulo(0, 1, 2)));
  const contorno = recortadas.features.find(f => f.geometry.type === "MultiLineString");
  assert.ok(contorno.geometry.coordinates.flat().every(([x]) => x === 0));
});

test("uma área menor inteiramente dentro da parcela não inventa divisas", () => {
  const a = retangulo(1, 1, 1);
  const resultado = recortarCamada(featureCollection([parcela]), [a.geometry], true);
  assert.equal(resultado.features.length, 1);
  assert.equal(area(resultado), area(a));
});

test("duas áreas disjuntas deixam o trecho intermediário e os pontos de fora sem sobreposição", () => {
  const a = retangulo(0, 0, 1), b = retangulo(3, 3, 1);
  const selecao = recortarCamada(featureCollection([parcela, point([2, 2])]), [a.geometry, b.geometry]);
  assert.equal(selecao.features.length, 1);
  assert.equal(selecao.features[0].geometry.type, "MultiPolygon");
  assert.equal(area(selecao), area(a) + area(b));
});

test("áreas disjuntas podem ter seleções independentes e compartilhar a mesma camada", async t => {
  const { GerenciadorCamadasOficiais } = jiti("../src/components/map/camadasOficiaisMapa.ts");
  const fontes = new Map(), layers = new Map();
  const mapa = {
    on() {}, off() {}, getZoom: () => 14,
    getBounds: () => ({ getWest: () => 0, getSouth: () => 0, getEast: () => 4, getNorth: () => 4 }),
    addSource(id) { fontes.set(id, { setData(dados) { this.dados = dados; } }); },
    getSource: id => fontes.get(id), getLayer: id => layers.get(id),
    addLayer(c) { layers.set(c.id, c); }, setFilter() {}, setLayoutProperty() {},
  };
  t.mock.method(globalThis, "fetch", async () => Response.json(featureCollection([parcela])));
  const workerAnterior = globalThis.Worker;
  globalThis.Worker = class {
    terminate() {}
    postMessage(m) { queueMicrotask(() => this.onmessage({ data: { dados: recortarCamada(m.dados, m.areas, m.contorno) } })); }
  };
  t.after(() => { if (workerAnterior) globalThis.Worker = workerAnterior; else delete globalThis.Worker; });
  const gerente = new GerenciadorCamadasOficiais(mapa, () => {});
  const a = retangulo(0, 0, 1), b = retangulo(3, 3, 1);
  const areas = [{ geometria: a.geometry, camadas: new Set(["sigef", "ucs"]) }, { geometria: b.geometry, camadas: new Set(["funai", "ucs"]) }];
  gerente.atualizarSelecao(new Set(), areas);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(area(fontes.get("of-sigef").dados), area(a));
  assert.equal(area(fontes.get("of-funai").dados), area(b));
  assert.equal(area(fontes.get("of-ucs").dados), area(a) + area(b));
  gerente.atualizarSelecao(new Set(["ucs"]), areas);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(area(fontes.get("of-ucs").dados), area(parcela));
  gerente.destruir();
});

test("uma linha que atravessa duas áreas preserva os dois trechos e seus atributos", () => {
  const a = retangulo(0, 0, 1), b = retangulo(2, 0, 1);
  const rio = { type: "Feature", properties: { name: "Rio de teste" },
    geometry: { type: "LineString", coordinates: [[-1, 0.5], [4, 0.5]] } };
  const [f] = recortarCamada(featureCollection([rio]), [a.geometry, b.geometry]).features;
  assert.deepEqual(f.geometry.coordinates, [[[0, 0.5], [1, 0.5]], [[2, 0.5], [3, 0.5]]]);
  assert.equal(f.properties.name, rio.properties.name);
});
