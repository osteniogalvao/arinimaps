// Número da quadra à mão (migration 0174) num banco descartável com PostGIS.
// Uso: ARINI_TESTE_CARTEIRA_DB=postgresql://... node --test scripts/testa-quadras-manuais-sql.mjs
// Pula sozinho sem banco ou sem PostGIS (o Postgres do CI não tem a extensão).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.ARINI_TESTE_CARTEIRA_DB;
test("Quadra numerada à mão: todos os lotes da quadra, nenhum da vizinha", { skip: !url }, async (t) => {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const servidor = new pg.Client({ connectionString: url }); await servidor.connect();
  const { rows: [ext] } = await servidor.query("select count(*)::int n from pg_available_extensions where name='postgis'");
  if (!ext.n) { await servidor.end(); t.skip("banco sem PostGIS"); return; }
  const nome = "arini_test_" + randomUUID().replaceAll("-", "");
  await servidor.query("create database " + nome);
  const dst = new URL(url); dst.pathname = "/" + nome;
  const db = new pg.Pool({ connectionString: dst.href });
  db.on("error", () => {});
  const q = (sql, args) => db.query(sql, args);
  const camada = "00000000-0000-0000-0000-000000000001";
  // ponto em 31982 (metros) para graus, para clicar "dentro" de um lote
  const clique = async (x, y) => (await q("select st_x(p) lng, st_y(p) lat from (select st_transform(st_setsrid(st_makepoint($1,$2),31982),4326) p) t", [x, y])).rows[0];
  try {
    for (const role of ["anon", "authenticated", "service_role"]) if (!(await q("select from pg_roles where rolname=$1", [role])).rowCount) await q("create role " + role);
    await q(`create extension postgis;
      create table profiles(user_id uuid primary key);
      create table cartography_layers(id uuid primary key);
      create table urban_lots(id uuid primary key default gen_random_uuid(), layer_id uuid, geom geometry(Polygon,4326),
        geom_3857 geometry generated always as (st_transform(geom,3857)) stored, area_m2 numeric, quadra text, numero text);
      create table properties(id serial, lote_id uuid, lote_quadra text);
      create table audit_log(acao text, entidade text, entidade_id uuid, user_id uuid, dados_depois jsonb);
      insert into cartography_layers values ('${camada}');
      -- dois quarteirões de 5 x 2 lotes de 10 x 25 m, com rua de 12 m entre eles
      insert into urban_lots(layer_id, geom, area_m2)
      select '${camada}', st_transform(st_setsrid(st_makeenvelope(x0+i*10, y0+j*25, x0+(i+1)*10, y0+(j+1)*25),31982),4326), 250
      from (values (600000.0, 7800000.0), (600062.0, 7800000.0)) b(x0,y0), generate_series(0,4) i, generate_series(0,1) j;
      insert into properties(lote_id) select id from urban_lots order by st_xmin(geom), st_ymin(geom) limit 1;`);
    const migration = readFileSync(new URL("../supabase/migrations/0174_quadras_manuais.sql", import.meta.url), "utf8");
    await q(migration); await q(migration); // idempotente

    const a = await clique(600005, 7800005);
    const { rows: [r] } = await q("select fn_numerar_quadra($1,$2,$3,$4,$5,$6,null) n", [camada, a.lng, a.lat, " 5 ", -50, -20]);
    assert.equal(r.n, 10, "os 10 lotes da quadra recebem o número");
    const { rows: grupos } = await q("select coalesce(quadra,'-') quadra, count(*)::int n from urban_lots group by 1 order by 1");
    assert.deepEqual(grupos, [{ quadra: "-", n: 10 }, { quadra: "5", n: 10 }], "a quadra vizinha, do outro lado da rua, não muda");
    assert.equal((await q("select lote_quadra from properties")).rows[0].lote_quadra, "5", "imóvel ligado ao lote passa a mostrar a quadra");
    assert.equal((await q("select count(*)::int n from cartografia_quadras_manuais")).rows[0].n, 1, "âncora guardada para a fila reaplicar");

    const rua = await clique(600056, 7800005);
    assert.equal((await q("select fn_numerar_quadra($1,$2,$3,'7') n", [camada, rua.lng, rua.lat])).rows[0].n, 0, "clique na rua não numera nada");
    await assert.rejects(q("select fn_numerar_quadra($1,$2,$3,'   ')", [camada, a.lng, a.lat]), /quadra_invalida/);
  } finally {
    await db.end(); await servidor.query("drop database " + nome + " with (force)"); await servidor.end();
  }
});
