// node scripts/testa-recortes-cad.mjs
import assert from "node:assert/strict";
import vtpbf from "vt-pbf";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { createJiti } from "jiti";
import { pontoNaArea as pertenceNoWorker } from "../worker/jobs/ajustes.mjs";
import { seletorDeMatriz, assinaturaAjustes as assinaturaWorker } from "../worker/jobs/ajustes.mjs";

const jiti = createJiti(import.meta.url);
const { cortarTileCar } = jiti("../src/lib/map/cortarTileCar.ts");
const { recortesNoTile, coordenadasTileCar } = jiti("../src/lib/map/recortesUrbanos.ts");
const { detectarBlocosCad, termosDescricaoCad } = jiti("../src/lib/geo/blocosCad.ts");
const {
  centroArea, partesDasLinhas, ajustarPorPontos, aplicarMatrizPonto, afim, TRANSFORM_ZERO,
  pertenceParte, partesSobrepostas, reunirPecas, separarPecas, matrizParte, transformarGeoJSON, assinaturaAjustes,
} = jiti("../src/lib/geo/deslocar.ts");

const z = 12, x = 1475, y = 2275, n = 2 ** z;
const prefixo = "pmtiles://https://mapa.arini.test/car.pmtiles/";
for (const final of ["", ".mvt", ".pbf?versao=1"]) {
  assert.deepEqual(coordenadasTileCar(prefixo+`${z}/${x}/${y}${final}`,prefixo),[z,x,y]);
}
assert.equal(coordenadasTileCar("pmtiles://https://mapa.arini.test/urbano.pmtiles/12/1/2.mvt",prefixo), null);
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
// Três quadras alinhadas: uma seleção descontínua das duas pontas deixa o meio livre.
const quadra = i => ret(-50 + i * .002, -19.01, -49.999 + i * .002, -19.009);
const pecas = [
  { id:"extremos", area:quadra(0), areasExtras:[quadra(2)], t:{...base, rotacaoGraus:170} },
  { id:"meio", area:quadra(1), t:{...base, escala:.9, offsetNorteM:23} },
];
assert(!partesSobrepostas(pecas[0],pecas[1]));
assert(!pertenceParte(centroArea(quadra(1)),pecas[0]));
assert(pertenceParte(centroArea(quadra(2)),pecas[0]));
const reunidas = reunirPecas(pecas,pecas,"conjunto");
const ancoras = [quadra(2)[1],quadra(1)[2]];
const perto = (p,q) => assert(p.every((x,i)=>Math.abs(x-q[i])<1e-9));
for (let i=0;i<2;i++) perto(aplicarMatrizPonto(matrizParte(pecas[i]),ancoras[i]),aplicarMatrizPonto(matrizParte(reunidas[i]),ancoras[i]));
const zero = {dx:0,dy:0,rot:0,esc:1}, origem=centroArea(quadra(1));
for (const graus of [-360,87,360]) {
  const viradas = reunidas.map(p=>({...p,t:{...TRANSFORM_ZERO,escala:1.12,rotacaoGraus:graus,offsetLesteM:17}}));
  const separadas=separarPecas(viradas,viradas[0]), worker=seletorDeMatriz(origem,zero,separadas);
  assert(!separadas.some(p=>p.grupo));
  assert.equal(assinaturaWorker(separadas),assinaturaAjustes(separadas));
  const planta={type:"FeatureCollection",features:[f("lotes",[quadra(2),quadra(1)])]};
  const linhas=transformarGeoJSON(planta,origem,TRANSFORM_ZERO,[],separadas).features[0].geometry.coordinates;
  for (let i=0;i<2;i++) {
    const ponto=ancoras[i], camada=i===0?2:1, vertice=i===0?1:2;
    const movido=aplicarMatrizPonto(afim(viradas[i].pivo,viradas[i].t),aplicarMatrizPonto(matrizParte(pecas[i]),ponto));
    perto(aplicarMatrizPonto(matrizParte(separadas[i]),ponto),movido);
    perto(aplicarMatrizPonto(worker(centroArea(quadra(camada))),ponto),movido);
    perto(linhas[i][vertice],movido);
  }
}
const { sugerirParesVisuais }=jiti("../src/lib/geo/pontosVisuais.ts");
const imagem={width:224,height:224,data:new Uint8ClampedArray(224*224*4)};
const cantos=[[42,42],[142,42],[42,142],[142,142]];
assert.deepEqual(sugerirParesVisuais(imagem,cantos),[]);
for (const [x,y] of cantos) for (let j=0;j<32;j++) for (let i=0;i<32;i++) {
  const k=((y+j+7)*imagem.width+x+i+5)*4;
  imagem.data.fill(255,k,k+4);
}
const pontos=sugerirParesVisuais(imagem,cantos);
assert.equal(pontos.length,4);
for (const {planta,satelite} of pontos) {
  assert(Math.abs(satelite[0]-planta[0]-5)<3 && Math.abs(satelite[1]-planta[1]-7)<3);
}
// 23/11/2026: encaixe de "milésimos" entre peças vizinhas não conta como sobreposição
{
  const q = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const esquerda = { area: q(0, 0, 0.001, 0.001) };
  assert.equal(partesSobrepostas(esquerda, { area: q(0.000999999, 0, 0.002, 0.001) }), false, "encaixe fino não sobrepõe");
  assert.equal(partesSobrepostas(esquerda, { area: q(0.0007, 0, 0.002, 0.001) }), true, "30% por cima sobrepõe");
  assert.equal(partesSobrepostas(esquerda, { area: q(0.002, 0, 0.003, 0.001) }), false);
  // perímetro editado (pivô fixo, sem encaixe): o contorno entra na assinatura, igual no worker
  const base = { id: "peca-1", nome: "P", area: q(0, 0, 1, 1), t: { ...TRANSFORM_ZERO } };
  const editada = { ...base, pivo: [0.5, 0.5], area: [[0, 0], [1.2, 0], [1, 1], [0, 1]] };
  assert.equal(assinaturaAjustes([base]), assinaturaWorker([base]), "peça sem pivô mantém a assinatura antiga");
  assert.notEqual(assinaturaAjustes([editada]), assinaturaAjustes([{ ...editada, area: q(0, 0, 1, 1) }]));
  assert.equal(assinaturaAjustes([editada]), assinaturaWorker([editada]));
}
console.log("Recortes, quadras, seleção descontínua, agrupamento, separação, giro de 360°, escala, sugestão de pontos e paridade com o worker conferidos.");
