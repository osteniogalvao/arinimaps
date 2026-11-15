// Requer initdb, pg_ctl e psql no PATH. Para conferir o arquivo convertido
// do operador, informe ARINI_MATRIZ_TESTE_JSON. Os dados ficam no cluster local.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PERSONAS_MATRIZ } from "../src/lib/direitos-persona.ts";

test("importação de 915 itens, limites da diretoria, logs e áreas privadas", async () => {
  const portaLivre = createServer();
  await new Promise((ok, falha) => portaLivre.once("error", falha).listen(0, "127.0.0.1", ok));
  const porta = String(portaLivre.address().port);
  await new Promise(ok => portaLivre.close(ok));
  const pasta = await mkdtemp(join(tmpdir(), "arini-qa-matriz-"));
  const cluster = join(pasta, "pg");
  const env = { ...process.env, PGHOST: "127.0.0.1", PGPORT: porta, PGUSER: "postgres", PGDATABASE: "postgres", PGSSLMODE: "disable", PGCLIENTENCODING: "UTF8" };
  function executar(programa, args, opcoes = {}, falhaEsperada = false) {
    const r = spawnSync(programa, args, { encoding: "utf8", env, timeout: 90000, windowsHide: true, ...opcoes });
    assert.ifError(r.error);
    if (falhaEsperada) assert.notEqual(r.status, 0);
    else assert.equal(r.status, 0, r.stderr?.slice(0, 1200));
    return r.stdout?.trim();
  }
  const sql = (input, falha = false) => executar("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input }, falha);
  const admin = "00000000-0000-4000-8000-000000000001", outro = "00000000-0000-4000-8000-000000000002";
  let iniciado = false;
  try {
    executar("initdb", ["-D", cluster, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    executar("pg_ctl", ["-D", cluster, "-o", "-h 127.0.0.1 -p " + porta, "-l", join(pasta, "log"), "-w", "start"], { stdio: "ignore" });
    iniciado = true;
    sql(`create role anon; create role authenticated; create role service_role;
        create table plans(id text primary key); create table profiles(user_id uuid primary key,role text,ativo boolean);
        create table audit_log(user_id uuid,acao text,entidade text,dados_antes jsonb,dados_depois jsonb);
        create table consultas_area_geom(chave text primary key,user_id uuid);
        create function fn_area_consulta(text) returns jsonb language sql as $$ select to_jsonb(chave) from public.consultas_area_geom where chave=$1 $$;
        create function fn_area_consulta_registrar(text,jsonb,uuid,numeric) returns jsonb language plpgsql as $$
          begin insert into public.consultas_area_geom values ($1,$3) on conflict do nothing;return '{"valida":true}'::jsonb;end $$;`);
    for (const nome of ["0078_matriz_personas.sql", "0083_matriz_direitos_por_plano.sql"]) {
      sql(await readFile(new URL("../supabase/migrations/" + nome, import.meta.url), "utf8"));
    }
    const dados = process.env.ARINI_MATRIZ_TESTE_JSON ? JSON.parse(await readFile(process.env.ARINI_MATRIZ_TESTE_JSON, "utf8"))
      : Array.from({ length: 915 }, (_, i) => ({ id: i+1, titulo: "Teste", natureza: "F", modulo: "Teste", subsecao: "Teste",
        disposicao: i === 252 ? "Backoffice ARINI" : "Produto", fase: "L0 Lançamento", futuro: false,
        permissoes: Object.fromEntries(Object.keys(PERSONAS_MATRIZ).map(p => [p, "C"])) }));
    const importar = "select fn_importar_matriz_personas('" + JSON.stringify(dados).replaceAll("'", "''") + "'::jsonb)";
    assert.equal(sql(importar), "915");
    assert.equal(sql(importar), "915");
    sql("select fn_importar_matriz_personas('[]')", true);
    assert.equal(sql("select count(*) from matriz_personas, lateral jsonb_each(permissoes)"), "9150");
    assert.equal(sql("select nivel from fn_niveis_itens_persona('quero_vender',null,array[253])"), "-");
    sql("set role anon; select * from matriz_personas", true);
    sql("set role authenticated; select * from fn_niveis_itens_persona('quero_vender',null,array[253])", true);
    sql(`insert into profiles values('${admin}','admin_central',true),('${outro}','comprador',true); insert into plans values('qa')`);
    const ajustar = (id, valor, usuario = admin) => `select fn_configurar_direito_plano('${usuario}','qa',${id},${valor})`;
    sql(ajustar(150, false, outro), true);
    sql(ajustar(150, false)); sql(ajustar(150, false));
    assert.equal(sql("select count(*) from audit_log"), "1");
    assert.equal(sql("select liberado from fn_niveis_itens_persona('proprietario','qa',array[150])"), "f");
    sql(ajustar(1, false), true);
    sql(ajustar(150, null));
    assert.equal(sql("select count(*) from plano_direitos_item"), "0");
    sql(`select fn_registrar_area_propria('amostra','{}','${admin}',0)`);
    assert.equal(sql(`select fn_ler_area_propria('amostra','${outro}') is null`), "t");
    sql(`select fn_registrar_area_propria('amostra','{}','${outro}',0)`);
    assert.equal(sql("select count(*) from consultas_area_autores"), "2");
  } finally {
    if (iniciado) executar("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
    await rm(pasta, { recursive: true, force: true });
  }
});
