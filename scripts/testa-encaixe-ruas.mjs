// Encaixe automático da planta pelas ruas (src/lib/geo/encaixeRuas.ts).
// Uso: node scripts/testa-encaixe-ruas.mjs — não precisa de servidor nem de rede.
//
// Cidade de mentira: grade de 12 × 10 quadras de 100 m × 80 m com ruas de 12 m.
// A planta (frentes das quadras) é tirada do lugar de propósito e o encaixe tem
// de devolvê-la para cima dos eixos das ruas.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { fsCache: false, alias: {
  "@": fileURLToPath(new URL("../src", import.meta.url)),
} });
const { encaixarPelasRuas, ehFalhaEncaixe, linhasParaEncaixe, caixaRobusta } = await jiti.import("../src/lib/geo/encaixeRuas.ts");
const { ruasDoXmlOsm } = await jiti.import("../src/lib/cartografia/ruasOsm.ts");

const C = [-50.19, -19.72], kx = 111320 * Math.cos(C[1] * Math.PI / 180), ky = 110540;
const g = ([x, y]) => [C[0] + x / kx, C[1] + y / ky];
const m = ([lng, lat]) => [(lng - C[0]) * kx, (lat - C[1]) * ky];
const RUA = 12, NX = 12, NY = 10;
// quadras de largura variada (80 a 130 m), como numa cidade de verdade: grade
// perfeitamente periódica teria encaixes falsos a cada quarteirão
let semente = 7;
const sorteio = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
const larguras = Array.from({ length: NX }, () => 80 + Math.round(sorteio() * 50));
const alturas = Array.from({ length: NY }, () => 70 + Math.round(sorteio() * 40));
const xs = [0], ys = [0];
larguras.forEach((w) => xs.push(xs.at(-1) + w + RUA));
alturas.forEach((h) => ys.push(ys.at(-1) + h + RUA));

const ruas = [];
for (const x of xs) ruas.push([[x, -RUA / 2], [x, ys.at(-1)]].map(g));
for (const y of ys) ruas.push([[-RUA / 2, y], [xs.at(-1), y]].map(g));
const quadras = [];
for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
  const x0 = xs[i] + RUA / 2, y0 = ys[j] + RUA / 2, QX = larguras[i], QY = alturas[j];
  quadras.push([[x0, y0], [x0 + QX, y0], [x0 + QX, y0 + QY], [x0, y0 + QY], [x0, y0]]);
  // divisas de lote (perpendiculares à rua): não podem atrapalhar
  for (let k = 1; k < 5; k++) quadras.push([[x0 + k * QX / 5, y0], [x0 + k * QX / 5, y0 + QY]]);
}
// árvores na calçada (copas de 3 m) e um eixo de rua desenhado no CAD
const arvores = [];
for (let i = 0; i < NX; i++) arvores.push([[xs[i] + 30, RUA / 2 + 2], [xs[i] + 33, RUA / 2 + 2]]);
const centro = (ls) => { let sx = 0, sy = 0, n = 0; for (const l of ls) for (const p of l) { sx += p[0]; sy += p[1]; n++; } return [sx / n, sy / n]; };
const mover = (ls, dx, dy, graus = 0, esc = 1) => {
  const c = centro(ls), r = graus * Math.PI / 180, co = Math.cos(r) * esc, si = Math.sin(r) * esc;
  return ls.map((l) => l.map(([x, y]) => [c[0] + co * (x - c[0]) - si * (y - c[1]) + dx, c[1] + si * (x - c[0]) + co * (y - c[1]) + dy]));
};
// erro de cada canto de quadra depois de aplicar a similaridade dos pares
const erroMaximo = (plantaMetros, r) => {
  const [a, b] = [r.pares[0], r.pares[2]].map((p) => [m(p.planta), m(p.satelite)]);
  const dz = [b[0][0] - a[0][0], b[0][1] - a[0][1]], dZ = [b[1][0] - a[1][0], b[1][1] - a[1][1]], den = dz[0] ** 2 + dz[1] ** 2;
  const k = [(dZ[0] * dz[0] + dZ[1] * dz[1]) / den, (dZ[1] * dz[0] - dZ[0] * dz[1]) / den];
  const T = ([x, y]) => { const rx = x - a[0][0], ry = y - a[0][1]; return [a[1][0] + k[0] * rx - k[1] * ry, a[1][1] + k[1] * rx + k[0] * ry]; };
  let pior = 0;
  plantaMetros.forEach((l, i) => l.forEach((p, j) => { const q = T(p), o = quadras[i][j]; pior = Math.max(pior, Math.hypot(q[0] - o[0], q[1] - o[1])); }));
  return pior;
};
// igual ao erroMaximo, para um pedaço da planta: compara com as linhas originais dele
const erroMaximoDe = (plantaMetros, originais, r) => {
  const [a, b] = [r.pares[0], r.pares[2]].map((p) => [m(p.planta), m(p.satelite)]);
  const dz = [b[0][0] - a[0][0], b[0][1] - a[0][1]], dZ = [b[1][0] - a[1][0], b[1][1] - a[1][1]], den = dz[0] ** 2 + dz[1] ** 2;
  const k = [(dZ[0] * dz[0] + dZ[1] * dz[1]) / den, (dZ[1] * dz[0] - dZ[0] * dz[1]) / den];
  const T = ([x, y]) => { const rx = x - a[0][0], ry = y - a[0][1]; return [a[1][0] + k[0] * rx - k[1] * ry, a[1][1] + k[1] * rx + k[0] * ry]; };
  let pior = 0;
  plantaMetros.forEach((l, i) => l.forEach((p, j) => { const q = T(p), o = originais[i][j]; pior = Math.max(pior, Math.hypot(q[0] - o[0], q[1] - o[1])); }));
  return pior;
};
const rodar = (dx, dy, graus, esc) => {
  const metros = mover(quadras, dx, dy, graus, esc);
  const r = encaixarPelasRuas(metros.map((l) => l.map(g)), [], ruas);
  assert.ok(!ehFalhaEncaixe(r), `falhou: ${r.erro}`);
  return { r, erro: erroMaximo(metros, r) };
};

// 1. só deslocada (datum antigo, planta solta): volta para o lugar
{
  const { r, erro } = rodar(37, -22, 0, 1);
  assert.ok(erro < 1, `deslocada: erro ${erro.toFixed(2)} m`);
  assert.ok(r.acertoDepois > r.acertoAntes);
}
// 2. girada e com escala errada: fecha o centro e as pontas
{
  const { r, erro } = rodar(-15, 20, 1.2, 1.006);
  assert.ok(erro < 1.5, `girada: erro ${erro.toFixed(2)} m`);
  assert.ok(Math.abs(r.giroGraus + 1.2) < 0.1, `giro ${r.giroGraus}`);
}
// 3. já no lugar: não mexe
{
  const r = encaixarPelasRuas(quadras.map((l) => l.map(g)), [], ruas);
  assert.ok(ehFalhaEncaixe(r) && r.jaEncaixada, "planta no lugar não pode ser mexida");
}
// 4. uma quadra sozinha fora do lugar, vizinhas certas: só ela anda, e só desloca
{
  const alvo = 5 * NY + 4; // quadra do meio
  const movel = quadras.filter((_, i) => Math.floor(i / 5) === alvo);
  const fixo = quadras.filter((_, i) => Math.floor(i / 5) !== alvo);
  const errada = mover(movel, 4, -3);
  const r = encaixarPelasRuas(errada.map((l) => l.map(g)), fixo.map((l) => l.map(g)), ruas);
  assert.ok(!ehFalhaEncaixe(r), `quadra: ${r.erro}`);
  assert.ok(Math.abs(r.escala - 1) < 0.01, `quadra só deslocada mudou de tamanho: ${r.escala}`);
  assert.ok(Math.abs(r.giroGraus) < 1e-9, "quadra pequena não gira");
  const d = [m(r.pares[0].satelite)[0] - m(r.pares[0].planta)[0], m(r.pares[0].satelite)[1] - m(r.pares[0].planta)[1]];
  assert.ok(Math.hypot(d[0] + 4, d[1] - 3) < 0.8, `quadra deslocada ${d.map((v) => v.toFixed(2))}`);
}
// 4b. quadra com o desenho certo e o tamanho errado (áudio do Carlos, 26/11):
// cresce ou encolhe por igual até as frentes caírem no meio das ruas
for (const esc of [1.06, 0.95]) {
  const alvo = 4 * NY + 6;
  const movel = quadras.filter((_, i) => Math.floor(i / 5) === alvo);
  const fixo = quadras.filter((_, i) => Math.floor(i / 5) !== alvo);
  const errada = mover(movel, 2, 1, 0, esc);
  const r = encaixarPelasRuas(errada.map((l) => l.map(g)), fixo.map((l) => l.map(g)), ruas);
  assert.ok(!ehFalhaEncaixe(r), `quadra ${esc}: ${r.erro}`);
  assert.ok(Math.abs(r.escala * esc - 1) < 0.012, `quadra ${esc}: escala ${r.escala.toFixed(4)}`);
  assert.ok(erroMaximoDe(errada, movel, r) < 1, `quadra ${esc}: erro ${erroMaximoDe(errada, movel, r).toFixed(2)} m`);
}
// 4c. com a opção de só deslocar, a quadra pequena não muda de tamanho
{
  const alvo = 4 * NY + 6;
  const movel = quadras.filter((_, i) => Math.floor(i / 5) === alvo);
  const fixo = quadras.filter((_, i) => Math.floor(i / 5) !== alvo);
  const r = encaixarPelasRuas(mover(movel, 2, 1, 0, 1.06).map((l) => l.map(g)), fixo.map((l) => l.map(g)), ruas, { semEscalaPequena: true });
  assert.ok(ehFalhaEncaixe(r) || (r.soDeslocamento && r.escala === 1), "semEscalaPequena mudou o tamanho");
}
// 5. árvores e eixo de rua do CAD ficam fora da medição
{
  const fc = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { layer: "QUADRAS" }, geometry: { type: "MultiLineString", coordinates: quadras.map((l) => l.map(g)) } },
    { type: "Feature", properties: { layer: "VEGET_I" }, geometry: { type: "MultiLineString", coordinates: quadras.slice(0, 5).map((l) => l.map(g)) } },
    { type: "Feature", properties: { layer: "0" }, geometry: { type: "MultiLineString", coordinates: arvores.map((l) => l.map(g)) } },
    { type: "Feature", properties: { layer: "EIXO DE RUA" }, geometry: { type: "LineString", coordinates: ruas[0] } },
  ] };
  assert.equal(linhasParaEncaixe(fc).length, quadras.length);
}
// 6. caixa robusta ignora a linha solta a 50 km
{
  const ls = [...quadras.map((l) => l.map(g)), [g([50_000, 50_000]), g([50_010, 50_000])]];
  const [, , x1] = caixaRobusta(ls, 0.01, 0.99);
  assert.ok(m([x1, C[1]])[0] < 2_000);
}
// 7. XML da API do OSM
{
  const xml = `<osm><node id="1" lat="-19.7" lon="-50.1"/><node id="2" lat="-19.71" lon="-50.11"/><node id="3" lat="-19.72" lon="-50.12"/>
    <way id="9"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
    <way id="10"><nd ref="2"/><nd ref="3"/><tag k="waterway" v="river"/></way></osm>`;
  assert.deepEqual(ruasDoXmlOsm(xml), [[[-50.1, -19.7], [-50.11, -19.71]]]);
}
// 8. limpeza: o círculo de raio e o risco no pasto são soltos; nenhuma quadra é
{
  const { linhasSoltas, camadasNaoCadastro } = await jiti.import("../src/lib/geo/limpezaPlanta.ts");
  const circulo = Array.from({ length: 73 }, (_, i) => g([800 + 3000 * Math.cos(i * Math.PI / 36), 500 + 3000 * Math.sin(i * Math.PI / 36)]));
  const risco = [g([-900, -900]), g([-1500, -1400])];
  const itens = [...quadras.map((l, i) => ({ chave: "q" + i, coords: l.map(g) })), { chave: "circ", coords: circulo }, { chave: "risco", coords: risco }];
  assert.deepEqual(linhasSoltas(itens).sort(), ["circ", "risco"]);
  assert.deepEqual(camadasNaoCadastro(["0", "QUADRAS", "LT_LOTE", "Defpoints", "VEGET_I", "AZIMUTE", "GRID", "PDF_LOTES"]), ["Defpoints", "VEGET_I", "AZIMUTE", "GRID"]);
}
console.log("encaixe pelas ruas e limpeza: 11 casos ok");
