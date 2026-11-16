import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { bboxPolygon } from "@turf/turf";

const jiti = createJiti(import.meta.url, {
  fsCache: false,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)), "server-only": fileURLToPath(new URL("../node_modules/server-only/empty.js", import.meta.url)) },
});
const { consultarAnm, linhaParaGravar } = await jiti.import("../src/lib/rural/adaptadores.ts");
const { raioConsulta } = await jiti.import("../src/lib/rural/raios.ts");
const { respostaConsultaWhatsapp } = await jiti.import("../src/lib/rural/pedido-whatsapp.ts");
const car = "MG-3134400-F0B5DB13248140BBAE3B90AD7E6F4A53";
assert.ok(respostaConsultaWhatsapp("CONSULTAR CAR " + car).endsWith("/consulta/car/" + car));
assert.ok(respostaConsultaWhatsapp("relatório do CAR").endsWith("/mapa"));
assert.equal(respostaConsultaWhatsapp("Quero agendar uma visita"), null);
assert.equal(respostaConsultaWhatsapp("CONSULTAR CAR " + car + " https://exemplo.com"), null);
const poligono = (box) => bboxPolygon(box).geometry.coordinates[0];
const triangulo = [[0, 0], [10, 0], [0, 10], [0, 0]];
const area = { type: "MultiPolygon", coordinates: [
  [triangulo, poligono([1, 1, 2, 2])],
  [poligono([12, 0, 14, 2])],
] };
const consulta = { xmin: 0, ymin: 0, xmax: 14, ymax: 10, lng: 7, lat: 5, geometria: area };
const feicoes = [
  [7, 7, 8, 8],        // dentro do envelope, fora do triângulo
  [1.2, 1.2, 1.8, 1.8], // dentro do furo
  [4, 1, 5, 2],        // dentro do primeiro polígono
  [12.1, 0.1, 13, 1],   // dentro do segundo
  [9, 0.8, 10, 1.8],    // atravessa a borda do primeiro
].map((box, k) => ({ type: "Feature", properties: { OBJECTID: k + 1, PROCESSO: String(k + 1) }, geometry: bboxPolygon(box).geometry }));
let ids = feicoes.map(f => f.properties.OBJECTID);
let incompleta = false;
const getOriginal = https.get;
https.get = (url, _opcoes, responder) => {
  const p = url.searchParams;
  let data;
  if (p.get("returnIdsOnly") === "true") {
    assert.equal(p.get("geometryType"), "esriGeometryEnvelope");
    data = { objectIds: ids };
  } else {
    assert.equal(p.get("returnGeometry"), "true");
    assert.equal(p.get("geometry"), null); // a divisa não sai da ARINI
    const parte = p.get("objectIds").split(",").map(Number);
    data = { type: "FeatureCollection", features: incompleta ? [] : feicoes.filter(f => parte.includes(f.properties.OBJECTID)) };
  }
  const corpo = Readable.from([Buffer.from(JSON.stringify(data))]);
  Object.assign(corpo, { statusCode: 200, statusMessage: "OK", headers: {} });
  queueMicrotask(() => responder(corpo));
  return new EventEmitter();
};
syncBuiltinESMExports();
try {
  const real = await consultarAnm(consulta);
  assert.equal(real.erro, undefined);
  assert.equal(real.quantidade, 3);
  assert.deepEqual(real.itens.map(i => i.extra.processo), ["3", "4", "5"]);
  assert.equal(linhaParaGravar(real, null).incide, true);
  assert.equal(linhaParaGravar(real, null).resultado.recorte, "geometria");

  ids = [1, 2];
  const exterior = await consultarAnm(consulta);
  assert.equal(exterior.erro, undefined);
  assert.equal(exterior.incide, false);
  assert.equal(exterior.quantidade, 0);

  incompleta = true;
  const ausentes = await consultarAnm(consulta);
  assert.match(ausentes.erro, /incompleto/);
  assert.match((await consultarAnm({ ...consulta, geometria: undefined })).erro, /geometria/);
  ids = [];
  assert.equal((await consultarAnm(consulta)).quantidade, 0);

  for (const metros of [0, 500, 1000, 2000, 5000, 10000, 25000, 50000]) {
    assert.equal(raioConsulta(String(metros), 2000), metros);
  }
  for (const invalido of ["-1", "", "1e3", "100000", "3.5", ["500"]]) {
    assert.equal(raioConsulta(invalido, 2000), null);
  }
  assert.equal(raioConsulta(null, 2000), 2000);
  console.log("ANM: interseção exata, furo, multipolígono, resposta incompleta e raios conferidos.");
} finally {
  https.get = getOriginal;
  syncBuiltinESMExports();
}
