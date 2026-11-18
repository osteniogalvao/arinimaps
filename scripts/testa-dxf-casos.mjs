// Casos de planta DXF que o leitor precisa aceitar (ou recusar com motivo).
// Uso: node scripts/testa-dxf-casos.mjs  — não precisa de servidor.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { fsCache: false, alias: {
  "@": fileURLToPath(new URL("../src", import.meta.url)),
  "server-only": fileURLToPath(new URL("../node_modules/server-only/empty.js", import.meta.url)),
} });
const { converterDxf, ErroDxf } = await jiti.import("../src/lib/geo/dxf.ts");

const fluxo = (txt) => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(txt)); c.close(); } });
const dxf = (blocos, entidades) =>
  ["0", "SECTION", "2", "BLOCKS", ...blocos, "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", ...entidades, "0", "ENDSEC", "0", "EOF", ""].join("\n");
const linha = (x1, y1, x2, y2, extra = []) => ["0", "LINE", "8", "LOTES", ...extra, "10", x1, "20", y1, "11", x2, "21", y2];
// Distrito de Estrela da Barra (Carneirinho, MG), UTM 22S aproximado
const X = 540_000, Y = 7_800_000;
const terreno = (n, f = 1) => Array.from({ length: n }, (_, i) => linha((X + i * 10) * f, Y * f, (X + i * 10 + 8) * f, (Y + 8) * f)).flat();
const dentroDoDistrito = (r) => {
  assert.ok(r.centro[0] > -51 && r.centro[0] < -50, `lng ${r.centro[0]}`);
  assert.ok(r.centro[1] > -20 && r.centro[1] < -19.5, `lat ${r.centro[1]}`);
};

// 1. carimbo/moldura na folha (67=1) em maior número que o terreno
{
  const folha = Array.from({ length: 300 }, (_, i) => linha(5000 + i, 200, 5001 + i, 240, ["67", "1"])).flat();
  const r = await converterDxf(fluxo(dxf([], [...folha, ...terreno(100)])));
  dentroDoDistrito(r);
  assert.equal(r.diagnostico.entidadesDaFolha, 300);
  assert.equal(r.linhas, 100);
}

// 2. legenda/detalhe em coordenada local no próprio model space, terreno minoritário
{
  const local = Array.from({ length: 300 }, (_, i) => linha(5000 + i, 200, 5001 + i, 240)).flat();
  const r = await converterDxf(fluxo(dxf([], [...local, ...terreno(100)])));
  dentroDoDistrito(r);
  assert.equal(r.linhas, 100);
}

// 3. bloco dentro de bloco: o INSERT interno não pode virar terreno com coordenada local
{
  const blocos = [
    "0", "BLOCK", "2", "LOTE", "10", "0", "20", "0", ...linha(0, 0, 10, 10),
    "0", "ENDBLK",
    "0", "BLOCK", "2", "QUADRA", "10", "0", "20", "0",
    ...Array.from({ length: 20 }, (_, i) => ["0", "INSERT", "8", "LOTES", "2", "LOTE", "10", 5000 + i * 12, "20", "200"]).flat(),
    "0", "ENDBLK",
  ];
  const ents = Array.from({ length: 10 }, (_, i) => ["0", "INSERT", "8", "QUADRAS", "2", "QUADRA", "10", X - 5000 + i * 300, "20", Y - 200]).flat();
  const r = await converterDxf(fluxo(dxf(blocos, ents)));
  dentroDoDistrito(r);
  assert.equal(r.linhas, 200);
  assert.equal(r.diagnostico.pontosDescartados, 0);
}

// 4. desenho em milímetros
{
  const r = await converterDxf(fluxo(dxf([], terreno(50, 1000))));
  dentroDoDistrito(r);
  assert.equal(r.diagnostico.unidade, "milímetros");
}

// 5. polilinha com extrusão Z negativa (X espelhado no OCS)
{
  const lw = (x, y) => ["0", "LWPOLYLINE", "8", "LOTES", "90", "2", "70", "0", "10", -x, "20", y, "10", -(x + 5), "20", y + 5, "210", "0", "220", "0", "230", "-1"];
  const r = await converterDxf(fluxo(dxf([], Array.from({ length: 30 }, (_, i) => lw(X + i, Y)).flat())));
  dentroDoDistrito(r);
}

// 6. só coordenada local continua recusado, com o motivo
{
  const local = Array.from({ length: 50 }, (_, i) => linha(5000 + i, 200, 5001 + i, 240)).flat();
  await assert.rejects(converterDxf(fluxo(dxf([], local))), (e) => e instanceof ErroDxf && /coordenadas de terreno/.test(e.message));
}

console.log("DXF: 6 casos ok");
