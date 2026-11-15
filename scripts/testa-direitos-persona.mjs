import assert from "node:assert/strict";
import { test } from "node:test";
import { permiteItem, personaDaMatriz } from "../src/lib/direitos-persona.ts";

test("vender usa a coluna P9 somente dentro do perfil de proprietário", () => {
  assert.equal(personaDaMatriz("proprietario", "anunciar"), "quero_vender");
  assert.equal(personaDaMatriz("proprietario", "vender"), "proprietario");
  assert.equal(personaDaMatriz("comprador_investidor", "anunciar"), "comprador_investidor");
  assert.equal(personaDaMatriz("correspondente_bancario"), "correspondente_bancario");
  assert.equal(personaDaMatriz("toString"), null);
});

test("o plano só pode liberar um item admitido pela persona, com sua operação e escopo", () => {
  const linha = (nivel, liberado = null) => ({ id: 1, nivel, liberado });
  assert.equal(permiteItem(linha("-", true), "consultar", true), false);
  assert.equal(permiteItem(linha("C", true), "operar", true), false);
  assert.equal(permiteItem(linha("L", true), "consultar", true), false);
  assert.equal(permiteItem(linha("L"), "consultar", false, true), true);
  assert.equal(permiteItem(linha("P"), "operar", false), false);
  assert.equal(permiteItem(linha("P", true), "operar", false), true);
  assert.equal(permiteItem(linha("P", false), "operar", true), false);
  assert.equal(permiteItem(linha("O"), "gerir", true), false);
  assert.equal(permiteItem(linha("M"), "comercializar", false), true);
  assert.equal(permiteItem(undefined, "consultar", true), false);
});
