// Usa apenas banco descartável local. As tabelas e políticas da fixture são revertidas.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import ts from "typescript";
import { compileFunction } from "node:vm";
import * as crm from "../src/lib/crm-privado.ts";

const ler = arq => readFileSync(new URL("../" + arq, import.meta.url), "utf8");
function rota(status, rpc) {
  const js = ts.transpileModule(ler("src/app/api/painel/crm/route.ts"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = {};
  const deps = { "@/lib/crm-privado": crm, "@/lib/crm-privado-servidor": {
    sessaoCrm: async () => ({ status, banco: { rpc }, titular: randomUUID() }),
  } };
  compileFunction(js,["require","exports"])(id => { assert.ok(Object.hasOwn(deps,id)); return deps[id]; }, mod);
  return mod;
}
const req = (method, dados) => new Request("https://local.invalid/api/painel/crm", { method, body: JSON.stringify(dados) });
test("API barra sessão sem direito e rejeita a identidade do titular enviada pelo navegador", async () => {
  const dados = { id: randomUUID(), assunto: "Visita inicial", nome: "Contato sintético" };
  const semChamadas = () => assert.fail("Não deveria consultar/gravar");
  for (const status of [401,403,503]) assert.equal((await rota(status, semChamadas).POST(req("POST",dados))).status,status);
  const app = rota(200, semChamadas);
  assert.equal((await app.POST(req("POST",{...dados,titular_id:randomUUID()}))).status,400);
  assert.equal((await app.PATCH(req("PATCH",{id:dados.id,versao:"2",etapa:"triagem"}))).status,400);
});
test("API abre triagem e preserva conflito de edição para o cliente", async () => {
  const id = randomUUID();
  const app = rota(200, async (fn,params) => {
    assert.equal(params.p_id, id); assert.ok(!("p_titular" in params));
    if (fn === "crm_privado_abrir") { assert.equal(params.p_nome,"Ana"); return { data: id, error: null }; }
    assert.equal(fn,"crm_privado_encaminhar"); assert.equal(params.p_versao,1); return { error: { code:"40001" } };
  });
  assert.equal((await app.POST(req("POST",{id,nome:"Ana",assunto:"Consulta rural"}))).status,201);
  assert.equal((await app.PATCH(req("PATCH",{id,etapa:"em_atendimento",versao:1}))).status,409);
});

const url = process.env.TEST_CRM_PRIVADO_PG_URL;
test("Postgres: criação, triagem, histórico imutável, isolamento, MFA, autoelevação e herança válida sem compartilhamento", { skip: !url }, async () => {
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname));
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const q = (sql,args) => db.query(sql,args);
  const valor = async (sql,args) => Object.values((await q(sql,args)).rows[0])[0];
  async function rejeita(sql,args,codigo) {
    await q("savepoint esperado"); await assert.rejects(q(sql,args),e => e.code === codigo); await q("rollback to esperado");
  }
  try {
    await q("begin");
    await q(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select (current_setting('app.uid',true))::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('app.aal',true))$$;
      grant usage on schema auth to authenticated;
      create table auth.mfa_factors(user_id uuid,status text);
      create table public.plans(id text primary key,ativo boolean,recursos text[],escopo text);
      create table public.profiles(user_id uuid primary key,nome text,role text,nicho text,plan_id text,plan_origem text,plan_valido_ate timestamptz,ativo boolean);
      create table public.organizations(id uuid primary key,ativo boolean,plan_id text,plan_valido_ate timestamptz);
      create table public.organization_members(user_id uuid,org_id uuid,status text);
      alter table public.profiles enable row level security;
      grant select,update on public.profiles to authenticated;
      create policy perfil_leitura on public.profiles for select using (user_id=auth.uid());`);
    // Usa a policy de proteção de campos vigente do produto, sem simular a decisão de acesso.
    const policy = ler("supabase/migrations/0036_seguranca_lgpd.sql").match(/create policy p_profiles_self_update on profiles for update[\s\S]*?\n  \);/i);
    assert.ok(policy); await q(policy[0]);
    await q(ler("supabase/migrations/0077_crm_privado.sql"));
    const a = randomUUID(), b = randomUUID(), org = randomUUID(), caso = randomUUID();
    await q(`insert into plans values ('liberado',true,'{crm_privado}','conta'),('org',true,'{crm_privado}','organizacao'),('negado',true,'{}','conta');
      insert into organizations values ('${org}',true,'org',null);`);
    await q("insert into profiles values ($1,'Titular A','corretor','corretor_imobiliaria','liberado','manual',null,true), ($2,'Titular B','engenheiro','engenheiro','negado','padrao',null,true)",[a,b]);
    await q("insert into organization_members values ($1,$3,'ativo'),($2,$3,'ativo')",[a,b,org]);
    const entrar = async (uid,aal="aal1") => { await q("set local role authenticated"); await q("select set_config('app.uid',$1,true),set_config('app.aal',$2,true)",[uid,aal]); };
    const abrir = "select crm_privado_abrir($1,$2,'Contato inicial',null,null,'Primeira visita','2026-12-05','Origem da conversa')";
    const mover = "select crm_privado_encaminhar($1,$2,'em_atendimento','2026-12-07','Visita confirmada')";
    await entrar(a);
    assert.equal(await valor("select crm_privado_liberado()"),true);
    assert.equal(await valor(abrir,[caso,null]),caso);
    assert.equal(await valor(abrir,[caso,null]),caso);
    assert.equal(await valor("select count(*)::int from crm_privado_contatos"),1);
    const contato = await valor("select id from crm_privado_contatos");
    assert.equal(await valor(mover,[caso,1]),2);
    await rejeita(mover,[caso,1],"40001");
    assert.deepEqual((await q("select versao,etapa_anterior,etapa,proximo_retorno::text as retorno from crm_privado_historico order by versao")).rows,
      [{versao:1,etapa_anterior:null,etapa:"triagem",retorno:"2026-12-05"},{versao:2,etapa_anterior:"triagem",etapa:"em_atendimento",retorno:"2026-12-07"}]);
    await rejeita("delete from crm_privado_historico",[],"42501");
    await rejeita("update crm_privado_atendimentos set etapa='concluido'",[],"42501");
    await valor(abrir,[randomUUID(),contato]); assert.equal(await valor("select count(*)::int from crm_privado_contatos"),1);
    await entrar(b); assert.equal(await valor("select crm_privado_liberado()"),true);
    for (const tabela of ["espacos","contatos","atendimentos","historico"])
      assert.equal(await valor("select count(*)::int from crm_privado_" + tabela),0);
    await rejeita(mover,[caso,2],"P0002"); await rejeita(abrir,[randomUUID(),contato],"P0002");
    await valor(abrir,[caso,null]); // chave privada: não colide com a do outro titular.
    assert.equal(await valor("select count(*)::int from crm_privado_historico"),1);
    await q("reset role"); await q("update organizations set ativo=false");
    await entrar(b); assert.equal(await valor("select crm_privado_liberado()"),false);
    assert.equal(await valor("select count(*)::int from crm_privado_contatos"),0);
    await rejeita(abrir,[randomUUID(),null],"42501");
    await rejeita("update profiles set plan_id='liberado' where user_id=$1",[b],"42501");
    await rejeita("update profiles set nicho='proprietario' where user_id=$1",[b],"42501");
    await q("update profiles set nome='Outro nome' where user_id=$1",[b]);
    for (const [campo,v] of [["plan_valido_ate","'2000-01-01'"],["nicho","'produtor_rural'"],["ativo","false"],["role","'admin_central'"]]) {
      await q("reset role"); await q("savepoint perfil"); await q("update profiles set "+campo+"="+v+" where user_id=$1",[a]);
      await entrar(a); assert.equal(await valor("select crm_privado_liberado()"),false); await q("rollback to perfil");
    }
    await q("reset role"); await q("update plans set ativo=false where id='liberado'");
    await entrar(a); assert.equal(await valor("select crm_privado_liberado()"),false);
    await q("reset role"); await q("update plans set ativo=true where id='liberado'"); await q("insert into auth.mfa_factors values ($1,'verified')",[a]);
    await entrar(a); assert.equal(await valor("select crm_privado_liberado()"),false);
    await entrar(a,"aal2"); assert.equal(await valor("select crm_privado_liberado()"),true);
    const configurar = "select crm_privado_profissao($1)";
    const classificar = "select crm_privado_abrir($1,null,'Contato setorial',null,null,'Serviço',null,null,$2,$3,$4)";
    await rejeita(configurar,["advocacia"],"42501");
    await q("reset role"); await q("update plans set recursos='{crm_privado,crm_setorial}' where id in ('org','liberado')");
    await q("update organizations set ativo=true");
    await entrar(a,"aal2"); assert.equal(await valor("select crm_setorial_liberado()"),false);
    await rejeita(classificar,[randomUUID(),"advocacia","caso",{}],"42501");
    await entrar(b); assert.equal(await valor("select crm_setorial_liberado()"),true);
    const modelos = (await valor("select crm_privado_configuracao()")).modelos;
    assert.equal(Object.keys(modelos).length,6);
    await rejeita(configurar,["perfil_inventado"],"22023");
    await valor(configurar,["advocacia"]);
    await rejeita(classificar,[randomUUID(),"agrimensura","levantamento",{}],"40001");
    await rejeita(classificar,[randomUUID(),"advocacia","levantamento",{}],"22023");
    await rejeita(classificar,[randomUUID(),"advocacia","caso",{escritorio:"outro"}],"22023");
    await rejeita(classificar,[randomUUID(),"advocacia","caso",{prazo:"2026-02-31"}],"22008");
    for (const [prof,modelo] of Object.entries(modelos)) {
      const id = randomUUID(); await valor(configurar,[prof]);
      const categoria = Object.keys(modelo.categorias)[0];
      const dados = Object.fromEntries(Object.entries(modelo.campos).map(([k,c]) => [k,c.tipo === "data" ? "2026-12-03" : c.tipo === "numero" ? "12.5" : "Referência 32"]));
      await valor(classificar,[id,prof,categoria,dados]);
      assert.equal(await valor(mover,[id,1]),2);
      const item = (await q("select * from crm_privado_servicos where atendimento_id=$1",[id])).rows[0];
      assert.equal(item.profissao,prof); assert.equal(item.categoria_nome,modelo.categorias[categoria]);
      for (const [k,v] of Object.entries(dados)) assert.equal(item.campos[k].valor,v);
    }
    assert.equal(await valor("select count(distinct profissao)::int from crm_privado_servicos"),6);
    await rejeita("update crm_privado_servicos set campos='{}'",[],"42501");
    await q("reset role"); await q("update plans set recursos='{crm_privado}' where id='org'");
    await entrar(b); assert.equal(await valor("select crm_privado_configuracao()"),null);
    assert.equal(await valor("select count(*)::int from crm_privado_servicos"),0);
    assert.equal(await valor("select count(*)::int from crm_privado_atendimentos"),7);
    await q("reset role"); await q("set local role anon"); await rejeita("select crm_privado_liberado()",[],"42501");
  } finally { await q("rollback"); await db.end(); }
});
