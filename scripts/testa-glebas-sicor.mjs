import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { lerGlebasSicor, juntarOperacoesSicor } from "../worker/jobs/glebasSicor.mjs";

const bbox = [-51, -20, -50, -19];
const origem = [
  "#REF_BACEN;NU_ORDEM;NU_INDICE;GT_GEOMETRIA",
  "12345;1;1;POLYGON ((-50.8 -19.8,-50.7 -19.8,-50.7 -19.7,-50.8 -19.8))",
  "99999;1;2;POLYGON ((-60 -19,-59 -19,-59 -20,-60 -19))",
].join("\r\n");

test("carga regional descarta a referência após associar somente dados públicos da operação", async () => {
  const { carga, lidas } = await lerGlebasSicor(Readable.from([gzipSync(origem)]), 2026, bbox);
  assert.equal(lidas, 2);
  assert.equal(carga.glebas.length, 1);
  assert.match(carga.glebas[0].id, /^[a-f0-9]{64}$/);
  assert.equal(carga.glebas[0].chave, "12345/1");
  const operacoes = "#REF_BACEN;NU_ORDEM;VL_PARC_CREDITO;CPF_CNPJ\n12345;1;1500,50;DOCUMENTO_NAO_PUBLICO";
  assert.equal(await juntarOperacoesSicor(carga.glebas, Readable.from([gzipSync(operacoes)])), 1);
  assert.deepEqual(Object.keys(carga.glebas[0]).sort(), ["id", "operacao", "wkt"]);
  assert.deepEqual(carga.glebas[0].operacao, { valor: 1500.5 });
  assert.equal(JSON.stringify(carga).includes("12345"), false);
  assert.equal(JSON.stringify(carga).includes("DOCUMENTO_NAO_PUBLICO"), false);
});

test("gleba sem operação correspondente também descarta a referência", async () => {
  const { carga } = await lerGlebasSicor(Readable.from([gzipSync(origem)]), 2026, bbox);
  const operacoes = "#REF_BACEN;NU_ORDEM;VL_PARC_CREDITO\n99999;1;120";
  assert.equal(await juntarOperacoesSicor(carga.glebas, Readable.from([gzipSync(operacoes)])), 0);
  assert.deepEqual(Object.keys(carga.glebas[0]).sort(), ["id", "wkt"]);
});

test("distribuições vazias ou com transferência incompleta falham antes da troca", async () => {
  await assert.rejects(lerGlebasSicor(Readable.from([gzipSync(origem).subarray(0, -5)]), 2026, bbox));
  await assert.rejects(lerGlebasSicor(Readable.from([gzipSync(origem)]), 2026, [-30,-12,-29,-11]));
});
