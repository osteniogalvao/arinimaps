import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { periodoAgenda, ordenarAgenda } from "../src/lib/agenda-setores.ts";
const ler=n=>readFileSync(new URL("../supabase/migrations/"+n,import.meta.url),"utf8");

test("agenda limita o período e recusa setor externo mesmo se a origem entregar dados a mais",()=>{
  assert.deepEqual(periodoAgenda("2026-02-30","2030-01-01","2026-11-24"),{de:"2026-11-24",ate:"2026-12-24"});
  const item=(setor,data)=>({id:randomUUID(),setor,data,tipo:"Tarefa",titulo:"Teste",href:"/admin"});
  assert.deepEqual(ordenarAgenda([item("juridico","2026-11-25"),item("comercial","2026-11-23")],["comercial"],"2026-11-24","2026-12-24"),[]);
  const certo=item("comercial","2026-11-25");assert.deepEqual(ordenarAgenda([certo],["comercial"],"2026-11-24","2026-12-24"),[certo]);
});

const url=process.env.ARINI_TESTE_CARTEIRA_DB;
test("SQL origem: concorrência, pendência publicada/LGPD/autorização, resolução com auditoria e recorrência",{skip:!url},async()=>{
  assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname));
  const raiz=new pg.Client({connectionString:url});await raiz.connect();const nome="arini_test_"+randomUUID().replaceAll("-","");await raiz.query("create database "+nome);
  const dst=new URL(url);dst.pathname="/"+nome;const db=new pg.Pool({connectionString:dst.href});const q=(s,a)=>db.query(s,a);
  try{
    for(const role of ["anon","authenticated","service_role"])if(!(await q("select from pg_roles where rolname=$1",[role])).rowCount)await q("create role "+role);
    await q(`create table properties(id uuid primary key default gen_random_uuid(),codigo text,status text,descricao text);
      create table property_media(id uuid primary key default gen_random_uuid(),property_id uuid,capa boolean);
      create table property_authorizations(id uuid primary key default gen_random_uuid(),property_id uuid,validade date);
      create table exclusividade_eventos(autorizacao uuid,evento text);
      create table lgpd_requests(id uuid primary key default gen_random_uuid(),codigo text,status text,prazo date);
      create table tasks(id uuid primary key default gen_random_uuid(),titulo text,descricao text,setor text,responsavel uuid,prazo date,prioridade text,origem text,regra text,chave_evento text,property_id uuid,opportunity_id uuid,aceite_em timestamptz,status text default 'aberta',concluida_em timestamptz,evidencia text);
      create unique index chave_tarefa on tasks(chave_evento)where chave_evento is not null;
      create table task_events(task_id uuid,tipo text,autor uuid,para_setor text,texto text,dados jsonb);
      create table audit_log(user_id uuid,acao text,entidade text,entidade_id uuid,property_id uuid,opportunity_id uuid,dados_depois jsonb);`);
    const real=ler("0139_evidencia_tarefas_automaticas.sql");
    await q(real.slice(real.indexOf("create or replace function public.fn_tarefa_automatica("),real.indexOf("-- A decisão já foi persistida")));
    const migration=ler("0166_matriz_pendencias_origem.sql");await q(migration);await q(migration);
    const prop=(await q("insert into properties(codigo,status,descricao)values('QA-1','publicado','')returning id")).rows[0].id;
    const auth=(await q("insert into property_authorizations(property_id,validade)values($1,current_date+20)returning id",[prop])).rows[0].id;
    const lgpd=(await q("insert into lgpd_requests(codigo,status,prazo)values('LGPD-QA','recebido',current_date+12)returning id")).rows[0].id;
    const resultados=await Promise.all([q("select fn_matriz_pendencias_origem() r"),q("select fn_matriz_pendencias_origem() r")]);
    assert.equal(resultados.reduce((n,r)=>n+r.rows[0].r.pendencias_origem_criadas,0),3);
    assert.equal((await q("select * from tasks")).rowCount,3);
    assert.equal((await q("select count(*) n from tasks where regra='matriz_pedido_lgpd' and prazo=current_date+12")).rows[0].n,"1");
    await q("update properties set descricao='Descrição completa' where id=$1",[prop]);await q("insert into property_media(property_id,capa)values($1,true)",[prop]);
    await q("update property_authorizations set validade=current_date+365 where id=$1",[auth]);await q("update lgpd_requests set status='atendido' where id=$1",[lgpd]);
    assert.equal((await q("select fn_matriz_pendencias_origem() r")).rows[0].r.pendencias_origem_resolvidas,3);
    assert.equal((await q("select * from tasks where status='concluida' and evidencia is not null")).rowCount,3);
    assert.equal((await q("select * from audit_log where acao='tarefa_concluida_por_evento'")).rowCount,3);
    await q("update properties set descricao='' where id=$1",[prop]);
    assert.equal((await q("select fn_matriz_pendencias_origem() r")).rows[0].r.pendencias_origem_criadas,1);
    assert.equal((await q("select * from tasks where regra='matriz_material_incompleto' and status='aberta'")).rowCount,1);
    assert.equal((await q("select has_function_privilege('authenticated','fn_matriz_pendencias_origem()','EXECUTE') ok")).rows[0].ok,false);
  }finally{await db.end();await raiz.query("drop database "+nome+" with(force)");await raiz.end();}
});
