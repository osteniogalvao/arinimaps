import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
const url=process.env.ARINI_TESTE_CARTEIRA_DB;
const ler=n=>readFile(new URL("../supabase/migrations/"+n,import.meta.url),"utf8");
test("registros operacionais do CRM técnico e configuração por profissão",{skip:!url||!["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname)},async t=>{
 const servidor=new pg.Client({connectionString:url});await servidor.connect();
 const banco="arini_test_"+randomUUID().replaceAll("-","");await servidor.query("create database "+banco);
 const destino=new URL(url);destino.pathname="/"+banco;
 const db=new pg.Client({connectionString:destino.href});await db.connect();const q=(s,v=[])=>db.query(s,v);
 const adm=randomUUID(),u=randomUUID(),colega=randomUUID(),externo=randomUUID(),particular=randomUUID(),org=randomUUID(),outra=randomUUID();
 const entrar=async(id,role="authenticated")=>{await q("reset role");await q("select set_config('app.uid',$1,false)",[id]);await q("set role "+role);};
 try {
  for(const r of ["anon","authenticated","service_role"])if(!(await q("select from pg_roles where rolname=$1",[r])).rowCount)await q("create role "+r);
  await q(`create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select current_setting('app.uid',true)::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select '{"aal":"aal1"}'::jsonb$$;
   create table auth.mfa_factors(user_id uuid,status text); grant usage on schema auth to authenticated;
   create table profiles(user_id uuid primary key,nome text,role text,nicho text,ativo boolean default true,plan_id text,plan_origem text default 'padrao',plan_valido_ate timestamptz);
   create table organizations(id uuid primary key,nome text,ativo boolean,plan_id text,plan_valido_ate timestamptz);
   create table organization_members(user_id uuid,org_id uuid,status text,nicho_vinculo text);
   create table plans(id text primary key,ativo boolean,recursos text[],escopo text);
   create table audit_log(user_id uuid,acao text,entidade text,entidade_id uuid,dados_depois jsonb);
   create table decisoes(id int,liberado boolean);
   create function fn_niveis_itens_persona(text,text,int[]) returns table(id int,nivel text,liberado boolean)
   language sql stable as $$select i,'O'::text,d.liberado from unnest($3)i left join public.decisoes d on d.id=i$$;
   insert into plans values('tecnico_profissional',true,'{crm_privado,crm_setorial}','organizacao'),('tecnico_premium',true,'{crm_privado,crm_setorial}','organizacao'),
   ('tecnico_pessoal',true,'{crm_privado,crm_setorial}','conta'),('basico',true,'{crm_privado}','conta');`);
  await q(await ler("0077_crm_privado.sql"));
  await q("alter table crm_privado_contatos add column nicho text;");
  const m=await ler("0086_contextos_da_conta.sql");await q(m.slice(m.indexOf("create or replace function public.crm_privado_recursos()"),m.indexOf("create or replace function public.cofre_limite(")));
  await q(await ler("0103_modelos_operacionais_tecnicos.sql"));
  await q("insert into organizations values($1,'Escritório Um',true,'tecnico_profissional',null),($2,'Escritório Dois',true,'tecnico_premium',null)",[org,outra]);
  for(const id of [u,colega,externo,particular,adm])await q("insert into profiles(user_id,nome,role,nicho,plan_id,plan_origem) values($1,'Pessoa teste',$2,'engenheiro',$3,$4)",[id,id===adm?"admin_central":"engenheiro",id===particular?"tecnico_pessoal":null,id===particular?"manual":"padrao"]);
  for(const [id,o]of [[u,org],[colega,org],[externo,outra]])await q("insert into organization_members values($1,$2,'ativo','engenheiro')",[id,o]);
  const mod=(await q("select * from tecnico_modulos where nome='Casos e processos'")).rows[0];
  const reg=randomUUID();const salvar=(ver,id=reg,campos={campo_1:"Processo sintético",campo_2:"Parte sintética"},titulo="Trabalho operacional")=>
    q("select tecnico_salvar_registro($1,$2,$3,1,$4,$5,$6,'aberto',null)",[id,ver,mod.id,titulo,mod.documentos[0],campos]);
  await t.test("compartilha somente com o mesmo escritório, escreve snapshot, bloqueia leitura/edição externa",async()=>{
    await entrar(u);assert.equal((await q("select * from tecnico_modulos")).rowCount,28);
    await assert.rejects(salvar(0,reg,{campo_1:"x"}),{code:"22023"});await salvar(0);await salvar(0);
    await entrar(colega);const r=(await q("select * from tecnico_registros where id=$1",[reg])).rows[0];assert.equal(r.campos.campo_2,"Parte sintética");assert.equal(r.espaco,"org/"+org);
    await salvar(1,reg,{campo_1:"Processo editado",campo_2:"Outra parte"});await assert.rejects(salvar(1),{code:"40001"});
    await entrar(externo);assert.equal((await q("select * from tecnico_modulos")).rowCount,29);
    assert.equal((await q("select from tecnico_registros where id=$1",[reg])).rowCount,0);await assert.rejects(salvar(2),{code:"42501"});
    await entrar(particular);assert.equal((await q("select from tecnico_registros")).rowCount,0);await salvar(0,randomUUID());
    await entrar(u);assert.equal((await q("select from tecnico_registros")).rowCount,1);
    await q("reset role");await q("insert into decisoes values(433,false)");await entrar(u);assert.equal((await q("select from tecnico_registros")).rowCount,0);await assert.rejects(salvar(2),{code:"42501"});
    await q("reset role");await q("delete from decisoes");
  });
  await t.test("Diretoria publica modelo sem código e pedidos mantêm o titular e o prazo",async()=>{
    const novo=randomUUID(),pedido=randomUUID(),campos=[{id:"laudo",nome:"Nota do avaliador",tipo:"texto",obrigatorio:true}];
    const pub=(ator,nome="Vistoria avaliativa",versao=0)=>q("select tecnico_modelo_salvar($1,$2,$3,'Avaliação e perícia',$4,false,$5,array['Relatório operacional'],true)",[ator,novo,versao,nome,JSON.stringify(campos)]);
    await entrar(u);const pedir=()=>q("select tecnico_pedir_profissao($1,'Avaliação e perícia','Preciso acompanhar a vistoria de avaliação.') id",[pedido]);await pedir();await pedir();
    assert.equal((await q("select * from tecnico_pedidos")).rowCount,1);await assert.rejects(pub(u),{code:"42501"});
    await entrar(colega);assert.equal((await q("select * from tecnico_pedidos")).rowCount,0);
    await entrar(adm,"service_role");await pub(adm);
    await q("select tecnico_responder_profissao($1,$2,1,'liberado','Modelo disponível para atendimento.','Avaliação e perícia')",[adm,pedido]);
    await entrar(u);const resultado=(await q("select * from tecnico_pedidos")).rows[0];assert.equal(resultado.estado,"liberado");assert.ok(resultado.previsao);
    const id=randomUUID();await q("select tecnico_salvar_registro($1,0,$2,1,'Imóvel de teste','Relatório operacional',$3,'em_andamento',null)",[id,novo,JSON.stringify({laudo:"Vistoria realizada no teste."})]);
    await entrar(externo);assert.equal((await q("select * from tecnico_modulos where id=$1",[novo])).rowCount,1);assert.equal((await q("select from tecnico_registros where id=$1",[id])).rowCount,0);
    await entrar(adm,"service_role");await pub(adm,"Nome editado no catálogo",1);
    await entrar(colega);assert.equal((await q("select modelo,campos from tecnico_registros where id=$1",[id])).rows[0].modelo.nome,"Vistoria avaliativa");
    await q("reset role");await q("update organizations set plan_valido_ate=now()-interval '1 hour' where id=$1",[org]);await entrar(u);
    assert.equal((await q("select from tecnico_registros")).rowCount,0);await assert.rejects(salvar(0,randomUUID()),{code:"42501"});
  });
 }finally{await db.end();await servidor.query("drop database "+banco+" with (force)");await servidor.end();}
});