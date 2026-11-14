// Rode com node --test scripts/testa-fila-worker.mjs. Os testes de fila
// usam uma tabela temporária em um Postgres local indicado em TEST_WORKER_PG_URL.
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { executarJob, proximoJob, recuperarInterrompidos } from "../worker/fila.mjs";
import { fetchPois } from "../worker/jobs/fetchPois.mjs";
import { coletarCotacoes } from "../worker/jobs/cotacoes.mjs";

const url = process.env.TEST_WORKER_PG_URL;
test("fila isola o Overpass e recupera apenas coletas interrompidas", { skip: !url }, async () => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query(`create temp table jobs (
      id serial primary key, tipo text, payload jsonb default '{}', status text default 'pendente',
      tentativas int default 0, erro text, created_at timestamptz default now(), updated_at timestamptz default now()
    )`);
    await db.query(`insert into jobs (tipo) values ('refresh_pois'), ('coletar_cotacoes'), ('render_video')`);
    const pois = await proximoJob(db, true);
    const cotacoes = await proximoJob(db, false);
    assert.equal(pois.tipo, "refresh_pois");
    assert.equal(cotacoes.tipo, "coletar_cotacoes");
    await executarJob(db, cotacoes, async () => { throw new Error("fonte indisponível"); });
    assert.equal((await proximoJob(db, false)).tipo, "render_video");
    assert.equal(await proximoJob(db, false), null);
    await db.query("update jobs set updated_at=now()-interval '30 minutes'");
    assert.equal(await recuperarInterrompidos(db), 1);
    assert.equal(await proximoJob(db, true), null);
    const novaCotacao = await proximoJob(db, false);
    assert.equal(novaCotacao.tentativas, 2);
    await executarJob(db, cotacoes, async () => {});
    await executarJob(db, novaCotacao, async () => {});
    await db.query("update jobs set updated_at=now()-interval '30 minutes' where status='erro'");
    assert.equal((await proximoJob(db, true)).tentativas, 2);
    const res = await db.query("select status, tentativas from jobs order by id");
    assert.deepEqual(res.rows, [
      { status: "processando", tentativas: 2 },
      { status: "concluido", tentativas: 2 },
      { status: "processando", tentativas: 1 },
    ]);
  } finally {
    await db.end();
  }
});

test("resposta parcial HTTP 200 do Overpass conserva os pontos do imóvel", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ elements: [], remark: "Query timed out" }));
  let leituras = 0;
  const db = { query: async (sql) => {
    if (sql.includes("property_geometries")) { leituras++; return { rows: [{ tipo: "rural", lng: -49, lat: -19 }] }; }
    if (sql.includes("from settings")) { leituras++; return { rows: [] }; }
    assert.fail("Resposta parcial não pode atualizar o imóvel");
  } };
  await assert.rejects(fetchPois({ property_id: "teste" }, db), /resposta incompleta/);
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(leituras, 2);
});

test("uma coleta de cotações sem nenhuma fonte disponível falha para permitir nova tentativa", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fonte offline"); });
  const db = { query: async (sql) => {
    if (sql.includes("count(*)")) return { rows: [{ n: 0 }] };
    assert.ok(sql.trim().startsWith("update cotacoes_series set ultimo_erro"));
    return { rows: [] };
  } };
  await assert.rejects(coletarCotacoes({}, db), /Nenhuma fonte retornou/);
});
