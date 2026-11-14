import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileFunction } from "node:vm";
import pg from "pg";
import ts from "typescript";

const ler = caminho => readFileSync(new URL("../" + caminho, import.meta.url), "utf8");

test("a rota usa apenas o titular da sessão e os quatro planos permitidos", async () => {
  const fonte = ler("src/app/api/planos/teste/route.ts");
  const js = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const titular = randomUUID();
  let a = null, chamada, erro = null;
  const dependencias = {
    "@/lib/authz": { ator: async () => a },
    "@/lib/solicitacoes-planos-servidor": { corpoPedido: req => req.json() },
    "@/lib/supabase/admin": { supabaseAdmin: () => ({ rpc: (fn, args) => {
      chamada = [fn, args]; return { data: { planoId: args.p_plano }, error: erro };
    } }) },
  };
  const rota = {};
  compileFunction(js, ["require","exports"])(id => dependencias[id], rota);
  const pedido = planoId => new Request("https://local.invalid/api/planos/teste", {
    method: "POST", body: JSON.stringify({ planoId, userId: randomUUID(), plan_valido_ate: "2099-01-01" }),
  });
  assert.equal((await rota.POST(pedido("tecnico_teste"))).status, 401);
  a = { userId: titular };
  assert.equal((await rota.POST(pedido("tecnico_premium"))).status, 400);
  assert.equal(chamada, undefined);
  assert.equal((await rota.POST(pedido("tecnico_teste"))).status, 200);
  assert.deepEqual(chamada, ["fn_ativar_plano_gratuito", { p_titular: titular, p_plano: "tecnico_teste" }]);
  erro = { code: "P8102", message: "Teste já utilizado." };
  const repetido = await rota.POST(pedido("tecnico_teste"));
  assert.equal(repetido.status, 409);
  assert.equal((await repetido.json()).codigo, "teste_utilizado");
});

// Só roda em um PostgreSQL local, criando e apagando um banco exclusivo.
const local = process.env.TEST_PLANOS_PG_URL;
test("Postgres controla início, expiração, repetição e atribuições da Diretoria", { skip: !local }, async () => {
  const destino = new URL(local);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(destino.hostname));
  const nome = "arini_teste_ativacao_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: destino.href });
  await admin.connect();
  await admin.query("create database " + nome);
  destino.pathname = "/" + nome;
  const pool = new pg.Pool({ connectionString: destino.href });
  try {
    await pool.query(`
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      end $$;
      create table plans(id text primary key, nome text, ativo boolean default true, escopo text, periodicidade text, preco_mensal numeric, recursos text[], cotas jsonb, ordem integer);
      create table profiles(user_id uuid primary key,role text,nicho text,ativo boolean default true,plan_id text references plans,plan_origem text default 'padrao',plan_valido_ate timestamptz);
      create table organizations(id uuid primary key, ativo boolean, plan_id text, plan_valido_ate timestamptz);
      create table organization_members(org_id uuid, user_id uuid, status text);
      create table plan_subscriptions(user_id uuid,status text);
    `);
    await pool.query(ler("supabase/migrations/0080_planos_por_persona.sql"));
    await pool.query("insert into plans(id,ativo,preco_mensal,periodicidade,escopo) values ('parceiro',true,0,'mensal','conta'),('consulta_profissional',true,0,'mensal','conta')");
    await pool.query(ler("supabase/migrations/0081_ativacao_planos_gratuitos.sql"));
    const conta = async (role, nicho, plano = null, origem = "padrao") => {
      const id = randomUUID();
      await pool.query("insert into profiles(user_id,role,nicho,plan_id,plan_origem) values($1,$2,$3,$4,$5)", [id,role,nicho,plano,origem]);
      return id;
    };
    const ativar = async (id, plano, cliente = pool) =>
      (await cliente.query("select fn_ativar_plano_gratuito($1,$2) as ativacao", [id,plano])).rows[0].ativacao;
    const corretor = await conta("corretor","corretor_imobiliaria","parceiro");
    const primeiro = await pool.connect(), segundo = await pool.connect();
    let original;
    try {
      await primeiro.query("begin");
      original = await ativar(corretor, "corretor_teste", primeiro);
      const disputa = ativar(corretor, "corretor_teste", segundo);
      let aguardou = false;
      for (let i = 0; i < 60 && !aguardou; i++) {
        aguardou = (await pool.query("select cardinality(pg_blocking_pids($1))>0 as sim",[segundo.processID])).rows[0].sim;
        if (!aguardou) await new Promise(resolve => setTimeout(resolve, 20));
      }
      await primeiro.query("commit");
      const novamente = await disputa;
      assert.equal(original.jaAtivo,false);
      assert.equal(novamente.jaAtivo,true);
      assert.equal(novamente.validoAte,original.validoAte);
      assert.ok(aguardou);
    } finally { await primeiro.query("rollback"); primeiro.release(); segundo.release(); }
    const prazo = (await pool.query("select extract(epoch from (p.plan_valido_ate-h.iniciado_em))::integer segundos, p.role, p.plan_origem from profiles p join planos_testes_utilizados h on h.titular_id=p.user_id where p.user_id=$1",[corretor])).rows[0];
    assert.deepEqual(prazo,{ segundos: 72*3600, role: "corretor", plan_origem: "padrao" });
    await assert.rejects(ativar(corretor, "produtor_teste"), { code: "P8101" });

    // Simula a passagem de 72 horas apenas neste banco de fixture.
    await pool.query("update planos_testes_utilizados set iniciado_em=iniciado_em-interval '4 days' where titular_id=$1",[corretor]);
    await pool.query("update profiles set plan_valido_ate=null where user_id=$1",[corretor]);
    await assert.rejects(ativar(corretor, "corretor_teste"), { code: "P8102" });
    await pool.query("update profiles set plan_id=null where user_id=$1",[corretor]);
    await assert.rejects(ativar(corretor, "corretor_teste"), { code: "P8102" });
    await pool.query("update profiles set role='engenheiro',nicho='engenheiro' where user_id=$1",[corretor]);
    assert.equal((await ativar(corretor, "tecnico_teste")).planoId,"tecnico_teste");
    await assert.rejects(pool.query("update plans set recursos=array['crm_privado'] where id='tecnico_teste'"), { code: "23514" });
    const manual = await conta("engenheiro","engenheiro","consulta_profissional","manual");
    await assert.rejects(ativar(manual,"tecnico_teste"), { code: "P8103" });
    await pool.query("update profiles set plan_id='tecnico_teste',plan_valido_ate=null where user_id=$1",[manual]);
    const antes = (await pool.query("select plan_valido_ate from profiles where user_id=$1",[manual])).rows[0].plan_valido_ate;
    assert.ok(antes);
    const depois = (await pool.query("update profiles set plan_valido_ate=now()+interval '1 year' where user_id=$1 returning plan_valido_ate",[manual])).rows[0].plan_valido_ate;
    assert.equal(antes.getTime(),depois.getTime());
    const pago = await conta("proprietario","proprietario","proprietario_completo");
    await assert.rejects(ativar(pago,"proprietario_gratuito"), { code: "P8103" });
    const produtor = await conta("proprietario","produtor_rural","consulta_profissional");
    const org = randomUUID();
    await pool.query("insert into organizations values($1,true,'corretor_profissional',null)",[org]);
    await pool.query("insert into organization_members values($1,$2,'ativo')",[org,produtor]);
    await assert.rejects(ativar(produtor,"produtor_teste"), { code: "P8103" });
    await pool.query("update organizations set plan_valido_ate=now()-interval '1 second' where id=$1",[org]);
    assert.ok((await ativar(produtor,"produtor_teste")).validoAte);
    const dono = await conta("proprietario","proprietario");
    await pool.query("insert into plan_subscriptions values($1,'ativa')",[dono]);
    await assert.rejects(ativar(dono,"proprietario_gratuito"), { code: "P8103" });
    await pool.query("delete from plan_subscriptions where user_id=$1",[dono]);
    assert.deepEqual(await ativar(dono,"proprietario_gratuito"),{ planoId: "proprietario_gratuito", validoAte: null, jaAtivo:false });
    assert.ok((await ativar(dono,"proprietario_gratuito")).jaAtivo);
    assert.equal((await pool.query("select count(*)::int n from plan_subscriptions")).rows[0].n,0);
    assert.equal((await pool.query("select count(*)::int n from planos_testes_utilizados where titular_id=$1",[dono])).rows[0].n,0);
    const externo = await pool.connect();
    try {
      await externo.query("set role authenticated");
      await assert.rejects(ativar(corretor,"corretor_teste",externo), { code: "42501" });
      await assert.rejects(externo.query("select * from planos_testes_utilizados"), { code: "42501" });
    } finally { externo.release(true); }
  } finally {
    await pool.end();
    await admin.query("drop database " + nome);
    await admin.end();
  }
});
