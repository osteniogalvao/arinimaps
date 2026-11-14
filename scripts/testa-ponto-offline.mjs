// Teste local da fila de campo. node scripts/testa-ponto-offline.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const arquivo = await readFile(new URL("../src/lib/filaOffline.ts", import.meta.url), "utf8");
const js = ts.transpileModule(arquivo, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { enviarOuGuardar, sincronizar, pontosPendentes, assumirPontoLegado } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const storage = new Map();
globalThis.localStorage = {
  get length() { return storage.size; },
  getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)),
  key: (i) => [...storage.keys()][i] ?? null, removeItem: (k) => storage.delete(k),
};
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

const url = "/api/admin/ponto";
const contaA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const contaB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const hora = "2026-11-13T13:30:00.000Z";
const corpo = { user_id: contaA, registro_cliente: crypto.randomUUID() };
const tentativas = [];
globalThis.fetch = async (_, init) => {
  tentativas.push(JSON.parse(init.body));
  throw new TypeError("Conexão interrompida após o envio");
};
const r = await enviarOuGuardar(url, "POST", corpo, "Ponto", { ...corpo, offline_em: hora });
assert.equal(r.offline, true);
assert.equal(pontosPendentes(contaA)[0].corpo.registro_cliente, tentativas[0].registro_cliente);
assert.equal(await sincronizar(contaB), 0);
assert.equal(pontosPendentes(contaB).length, 0);

globalThis.fetch = async (_, init) => {
  tentativas.push(JSON.parse(init.body));
  return Response.json({ error: "Sessão expirada" }, { status: 403 });
};
assert.equal(await sincronizar(contaA), 0);
assert.equal(pontosPendentes(contaA).length, 1);
globalThis.fetch = async (_, init) => {
  const recebido = JSON.parse(init.body);
  assert.equal(recebido.user_id, contaA);
  assert.equal(recebido.registro_cliente, corpo.registro_cliente);
  assert.equal(recebido.offline_em, hora);
  return Response.json({ comprovante: { id: "mesmo-comprovante" } });
};
assert.equal(await sincronizar(contaA), 1);
assert.equal(pontosPendentes(contaA).length, 0);

const legado = { id: crypto.randomUUID(), url, method: "POST", rotulo: "Ponto", criado_em: hora, corpo: { offline_em: hora } };
localStorage.setItem("arini-fila-offline", JSON.stringify([legado]));
assert.equal(await sincronizar(contaA), 0);
assert.equal(await sincronizar(contaB), 0);
assumirPontoLegado(legado.id, contaB);
assert.equal(pontosPendentes(contaA).length, 0);
globalThis.fetch = async (_, init) => {
  const enviado = JSON.parse(init.body);
  assert.equal(enviado.registro_cliente, legado.id);
  assert.equal(enviado.user_id, contaB);
  return Response.json({ error: "Horário expirado. Peça ajuste." }, { status: 400 });
};
assert.equal(await sincronizar(contaB), 0);
assert.equal(pontosPendentes(contaB)[0].corpo.erro_local, "Horário expirado. Peça ajuste.");
console.log("OK: reenvio com a mesma chave, horário original, contas isoladas, 403 preservado e recuperação explícita da fila antiga.");
