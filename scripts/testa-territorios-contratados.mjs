import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const url=process.env.ARINI_TESTE_CARTEIRA_DB;
const local=url && ["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname);
test("balcão e safras em organizações contratadas isoladas", { skip:!local }, async t=>{
  const servidor=new pg.Client({connectionString:url});await servidor.connect();
  const banco="arini_test_"+randomUUID().replaceAll("-","");await servidor.query("create database "+banco);
  const endereco=new URL(url);endereco.pathname="/"+banco;
  const pool=new pg.Pool({connectionString:endereco.href});const sql=(q,v=[])=>pool.query(q,v);
  try {
    for(const role of ["anon","authenticated","service_role"]) if (!(await sql("select from pg_roles where rolname=$1",[role])).rowCount) await sql("create role "+role);
    await sql(`create table profiles(user_id uuid primary key,ativo boolean default true,role text,nicho text);
      create table plans(id text primary key,ativo boolean,escopo text);
      create table organizations(id uuid primary key,nome text,ativo boolean,tipo text,plan_valido_ate timestamptz,plan_id text);
      create table organization_members(user_id uuid,org_id uuid,status text,papel_org text);
      create table audit_log(user_id uuid,acao text,entidade text,entidade_id uuid,dados_antes jsonb,dados_depois jsonb);
      insert into plans values('contrato',true,'organizacao');`);
    // A parte de 0097 abaixo só substitui o onboarding da aplicação e requer o restante do esquema.
    const m=await readFile(new URL("../supabase/migrations/0097_modulos_contratados.sql",import.meta.url),"utf8");
    await sql(m.slice(0,m.indexOf("create or replace function public.fn_trocar_contexto")));
    await sql(await readFile(new URL("../supabase/migrations/0098_territorios_contratados.sql",import.meta.url),"utf8"));
    async function org(tipo){
      const id=randomUUID(),u=randomUUID();
      const modo=tipo==="empresa"?"safras":"balcao",nicho=tipo==="empresa"?"empresa_holding":"ente_publico";
      await sql("insert into organizations values($1,'Organização de teste',true,$2,null,'contrato')",[id,tipo]);
      await sql("insert into profiles(user_id,role,nicho) values($1,'consulta',$2)",[u,nicho]);
      await sql("insert into organization_members values($1,$2,'ativo','admin')",[u,id]);
      await sql("insert into org_modulos_contratados(org_id,modulo,territorio,referencia,ativo) values($1,$2,'Território de teste','contrato teste',true)",[id,modo]);
      return {id,u};
    }
    await t.test("protocolo exige requisitos, isola municípios, versões, pendência e decisão",async()=>{
      const x=await org("ente_publico"),y=await org("ente_publico"),ext=randomUUID(),outro=randomUUID();
      await sql("insert into profiles(user_id,role,nicho) values($1,'comprador','comprador_investidor'),($2,'comprador','comprador_investidor')",[ext,outro]);
      const regra=(u,prev=null)=>sql("select fn_balcao_regra($1,'Viabilidade','Descreva o projeto.',array['Projeto'],$2) id",[u,prev]);
      const r=(await regra(x.u)).rows[0].id;
      await assert.rejects(regra(ext),{code:"42501"});
      const chave=randomUUID();
      const novo=(dados)=>sql("select fn_balcao_abrir($1,$2,$3,$4) n",[ext,chave,r,JSON.stringify(dados)]);
      await assert.rejects(novo({}),{code:"22023"});
      const duas=await Promise.all([novo({Projeto:"Uso residencial."}),novo({Projeto:"Uso residencial."})]);
      assert.equal(duas[0].rows[0].n,duas[1].rows[0].n);
      const ler=async(u,interno)=>(await sql("select fn_balcao_pedidos($1,$2) l",[u,interno])).rows[0].l;
      const [p]=await ler(ext,false);
      assert.equal((await ler(y.u,true)).length,0);assert.equal((await ler(outro,false)).length,0);
      const andar=(u,versao,etapa)=>sql("select fn_balcao_andar($1,$2,$3,$4,'Nova anotação')",[u,p.id,versao,etapa]);
      await assert.rejects(andar(y.u,1,"deferido"),{code:"42501"});await andar(x.u,1,"pendencia");
      await assert.rejects(andar(outro,2,"resposta"),{code:"42501"});await andar(ext,2,"resposta");
      await assert.rejects(andar(x.u,1,"deferido"),{code:"40001"});await andar(x.u,3,"deferido");
      await assert.rejects(andar(ext,4,"resposta"),{code:"40001"});
      await regra(x.u,r);assert.equal((await ler(ext,false))[0].versao,1);
      assert.equal((await ler(x.u,true))[0].andamentos.length,4);
      await sql("update organizations set plan_valido_ate=now()-interval '1 day' where id=$1",[x.id]);
      assert.equal((await sql("select * from fn_balcao_servicos(null)")).rowCount,0);
    });
    await t.test("empresa não acessa nem vincula dados de terceiros, resultado exige duas safras",async()=>{
      const x=await org("empresa"),y=await org("empresa");
      const novo=async(u,tipo,campos,id=randomUUID())=>{await sql("select fn_safra_lancar($1,$2,$3,$4)",[u,tipo,id,JSON.stringify(campos)]);return id;};
      const fornecedor=await novo(x.u,"fornecedor",{nome:"Fornecedor A"});
      const area=await novo(x.u,"area",{nome:"Fazenda A",fornecedor,hectares:10});
      await assert.rejects(novo(y.u,"area",{nome:"Vazamento",fornecedor,hectares:2}),{code:"23503"});
      const concorrentes=await Promise.allSettled([1,2].map(i=>novo(x.u,"talhao",{nome:"Talhão "+i,area,hectares:7})));
      assert.equal(concorrentes.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(concorrentes.find(r=>r.status==="rejected").reason.code,"P9801");
      const talhao=concorrentes.find(r=>r.status==="fulfilled").value;
      const campos={talhao,cultura:"Milho",ano:2024,toneladas:14,custo:10000,receita:21000};
      const s=await novo(x.u,"safra",campos);
      const painel=async(u)=>(await sql("select fn_safra_painel($1) p",[u])).rows[0].p;
      assert.equal((await painel(x.u)).areas[0].resultado,null);assert.equal((await painel(y.u)).safras.length,0);
      await assert.rejects(novo(y.u,"safra",{...campos,revisao:1},s),{code:"P0002"});
      await novo(x.u,"safra",{...campos,ano:2025,receita:22000});assert.equal((await painel(x.u)).areas[0].resultado,23000);
      await novo(x.u,"safra",{...campos,revisao:1,custo:9000},s);assert.equal((await painel(x.u)).areas[0].resultado,24000);
      await assert.rejects(novo(x.u,"safra",{...campos,revisao:1},s),{code:"40001"});
      await sql("update org_modulos_contratados set ativo=false where org_id=$1",[x.id]);await assert.rejects(painel(x.u),{code:"42501"});
    });
  } finally {await pool.end();await servidor.query("drop database "+banco);await servidor.end();}
});