import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileFunction } from "node:vm";
import pg from "pg";
import ts from "typescript";

const arquivo = (caminho) => readFileSync(new URL("../" + caminho, import.meta.url), "utf8");
function modulo(caminho, dependencias = {}) {
  const js = ts.transpileModule(arquivo(caminho), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  compileFunction(js, ["require", "exports"])(id => {
    assert.ok(Object.hasOwn(dependencias, id), "Dependência inesperada: " + id);
    return dependencias[id];
  }, exports);
  return exports;
}
const perfis = modulo("src/lib/perfis.ts");
const { montarAcesso } = modulo("src/lib/planos.ts", { "./perfis": perfis });
const plano = { id: "teste", ativo: true, recursos: ["anunciar", "crm_privado", "crm_setorial", "api_dados", "desconhecido", "mapa"] };
test("recursos efetivos respeitam perfil, atividade, validade e reserva", () => {
  const recursos = (role, nicho, p = plano, validade = null) => montarAcesso(role, p, nicho, validade).recursos;
  for (const role of ["admin_central", "analista_arini"]) {
    const ativos = recursos(role, null, null);
    assert.ok(ativos.has("anunciar") && !ativos.has("api_dados") && !ativos.has("crm_privado") && !ativos.has("crm_setorial"));
  }
  assert.deepEqual([...recursos("engenheiro", "engenheiro")].sort(), ["crm_privado", "crm_setorial", "mapa"]);
  assert.ok(!recursos("engenheiro", "engenheiro", { ...plano, recursos: ["crm_setorial"] }).has("crm_setorial"));
  assert.deepEqual([...recursos("corretor", "corretor_imobiliaria")].sort(), ["anunciar", "crm_privado", "mapa"]);
  assert.deepEqual([...recursos("proprietario", "produtor_rural")].sort(), ["anunciar", "mapa"]);
  assert.ok(!recursos("proprietario", "ente_publico").has("anunciar"));
  assert.ok(!recursos("proprietario", "proprietario", { ...plano, ativo: false }).has("anunciar"));
  assert.ok(!recursos("proprietario", "proprietario", plano, "2020-01-01").has("anunciar"));
});

// Apenas localhost. Cria e apaga um banco de fixture com nome aleatório.
const local = process.env.TEST_ANUNCIOS_PG_URL;
test("Postgres aplica a cota no envio, inclusive em lote e sob concorrência", { skip: !local }, async () => {
  const destino = new URL(local);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(destino.hostname));
  const db = "arini_teste_anuncio_" + randomUUID().replaceAll("-", "");
  const administrador = new pg.Client({ connectionString: destino.href });
  await administrador.connect();
  await administrador.query("create database " + db);
  destino.pathname = "/" + db;
  const pool = new pg.Pool({ connectionString: destino.href });
  try {
    await pool.query(`
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      end $$;
      create table profiles(user_id uuid primary key, role text, setores text[], ativo boolean default true, nicho text, plan_id text, plan_origem text default 'padrao', plan_valido_ate timestamptz);
      create table plans(id text primary key, ativo boolean, escopo text, recursos text[], cotas jsonb);
      create table organizations(id uuid primary key, ativo boolean, plan_id text, plan_valido_ate timestamptz);
      create table organization_members(org_id uuid, user_id uuid, status text);
      create table owners(id uuid primary key, profile_id uuid, status text default 'aprovado');
      create table partners(id uuid primary key, profile_id uuid, status text default 'aprovado');
      create table properties(id uuid primary key default gen_random_uuid(), owner_id uuid, partner_id uuid, created_by uuid, status text default 'rascunho',
        constraint chk_property_responsavel check (owner_id is not null or partner_id is not null));
      alter table properties enable row level security;
      grant select,insert,update on properties to authenticated;
      create policy p_properties_read on properties for select using (status='publicado');
      insert into plans values ('p',true,'conta',array['anunciar'],'{"imoveis_ativos":1}'), ('org',true,'organizacao',array['anunciar'],'{"imoveis_ativos":2}');
    `);
    await pool.query(arquivo("supabase/migrations/0076_anuncios_plano_cota.sql"));
    const dono = randomUUID(), owner = randomUUID(), diretoria = randomUUID();
    await pool.query("insert into profiles(user_id,role,nicho,plan_id) values($1,'proprietario','proprietario','p'),($2,'admin_central',null,null)", [dono, diretoria]);
    await pool.query("insert into owners(id,profile_id) values($1,$2)", [owner, dono]);
    const rascunho = async () => (await pool.query("insert into properties(owner_id,created_by) values($1,$2) returning id", [owner, dono])).rows[0].id;
    const a = await rascunho(), b = await rascunho();
    const enviar = (cliente, ids) => cliente.query("select fn_enviar_cadastro_imoveis($1,$2)", [dono, ids]);
    const cota = erro => erro.code === "P7502";
    await assert.rejects(enviar(pool, [a,b]), cota);
    assert.equal((await pool.query("select count(*)::int n from properties where status='pendente'")).rows[0].n, 0);

    const primeiro = await pool.connect(), segundo = await pool.connect();
    try {
      await primeiro.query("begin");
      await enviar(primeiro, [a]);
      const disputa = assert.rejects(enviar(segundo, [b]), cota);
      // Confirma disputa real com sessões distintas antes de liberar a transação vencedora.
      let bloqueado = false;
      for (let i = 0; !bloqueado && i < 50; i++) {
        bloqueado = (await pool.query("select cardinality(pg_blocking_pids($1))>0 as sim", [segundo.processID])).rows[0].sim;
        if (!bloqueado) await new Promise(resolve => setTimeout(resolve, 20));
      }
      await primeiro.query("commit");
      await disputa;
      assert.ok(bloqueado, "a segunda ativação deveria aguardar o lock da primeira");
    } finally {
      await primeiro.query("rollback");
      primeiro.release(); segundo.release();
    }
    await pool.query("update properties set status='em_analise' where id=$1", [a]);
    await pool.query("update properties set status='suspenso' where id=$1", [a]);
    await enviar(pool, [b]);
    await assert.rejects(pool.query("update properties set status='publicado' where id=$1", [a]), cota);
    await pool.query("update profiles set role='engenheiro' where user_id=$1", [dono]);
    await assert.rejects(pool.query("update properties set status='publicado' where id=$1", [a]), { code: "P7503" });
    await pool.query("update profiles set role='proprietario' where user_id=$1", [dono]);
    await pool.query("update plans set ativo=false where id='p'");
    await assert.rejects(pool.query("update properties set status='publicado' where id=$1", [a]), { code: "P7501" });
    const org = randomUUID();
    await pool.query("insert into organizations values($1,true,'org',null)", [org]);
    await pool.query("insert into organization_members values($1,$2,'ativo')", [org, dono]);
    await pool.query("update properties set status='publicado' where id=$1", [a]);
    await pool.query("insert into properties(created_by,responsavel_central,status) values ($1,true,'pendente')", [diretoria]);
    await assert.rejects(pool.query("insert into properties(created_by,responsavel_central,status) values ($1,true,'pendente')", [dono]), { code: "P7503" });
    const externo = await pool.connect();
    try {
      await externo.query("set role authenticated");
      assert.equal((await externo.query("select count(*)::int n from properties")).rows[0].n, 1);
      assert.equal((await externo.query("update properties set status='pendente' where id=$1", [a])).rowCount, 0);
      await assert.rejects(externo.query("insert into properties(owner_id,created_by) values($1,$2)", [owner,dono]), { code: "42501" });
      await assert.rejects(enviar(externo, [a]), { code: "42501" });
    } finally { externo.release(true); }
  } finally {
    await pool.end();
    await administrador.query("drop database " + db);
    await administrador.end();
  }
});
