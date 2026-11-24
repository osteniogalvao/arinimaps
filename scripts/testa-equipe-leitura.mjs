import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import ts from "typescript";
import { compileFunction } from "node:vm";
import { mfaObrigatoriaEquipe, somenteLeituraEquipe, escritaLiberadaParaLeitura } from "../src/lib/seguranca/equipe.ts";

test("2FA obrigatório desligado mesmo com a opção marcada; leitura preserva consulta e a segurança da própria conta",()=>{
  assert.equal(mfaObrigatoriaEquipe({role:"admin_central"},false),false);
  assert.equal(mfaObrigatoriaEquipe({role:"analista_arini",setores_gestor:["comercial"]},false),false);
  assert.equal(mfaObrigatoriaEquipe({role:"analista_arini"},false),false);
  assert.equal(mfaObrigatoriaEquipe({role:"analista_arini"},true),false);
  assert.equal(mfaObrigatoriaEquipe({role:"comprador"},true),false);
  assert.equal(somenteLeituraEquipe({role:"analista_arini",equipe_acesso:"leitura"}),true);
  for(const caminho of ["/api/admin/crm","/api/admin/equipe","/api/oportunidades/abc","/admin/automacoes","/admin/equipe","/conta/seguranca"]){
    assert.equal(escritaLiberadaParaLeitura(caminho,"GET"),true);
    for(const method of ["POST","PATCH","PUT","DELETE"])assert.equal(escritaLiberadaParaLeitura(caminho,method),false);
  }
  for(const caminho of ["/api/auth/entrar","/api/auth/redefinir","/api/notificacoes"])assert.equal(escritaLiberadaParaLeitura(caminho,"POST"),true);
});

test("Server Actions validam o ator mesmo quando executadas fora da URL original",async()=>{
  for(const [arquivo,nome,args] of [
    ["src/app/admin/marketing/comunicados/acoes.ts","comunicar",[new FormData(),randomUUID(),false]],
    ["src/app/admin/imoveis/[id]/indicar-testemunha.ts","indicarTestemunha",["",new FormData()]],
  ]){
    const js=ts.transpileModule(readFileSync(new URL("../"+arquivo,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    for(const atorTeste of [null,{userId:randomUUID(),somenteLeitura:true}]){
      const deps={"@/lib/authz":{ator:async()=>atorTeste,temSetor:()=>true},"next/cache":{revalidatePath:()=>{}},"@/lib/supabase/admin":{supabaseAdmin:()=>assert.fail("Escrita indevida na Action")}};
      const exports={};compileFunction(js,["require","exports"])(id=>{assert.ok(Object.hasOwn(deps,id));return deps[id];},exports);
      const resposta=await exports[nome](...args);assert.match(typeof resposta==="string"?resposta:resposta.erro,/restrito/i);
    }
  }
});

const url=process.env.ARINI_TESTE_CARTEIRA_DB;
test("SQL: leitura bloqueia DML e RPCdefiner, mantém consulta/preferências; gestão sem 2FA obrigatório",{skip:!url},async()=>{
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname));
  const servidor=new pg.Client({connectionString:url});await servidor.connect();const nome="arini_test_"+randomUUID().replaceAll("-","");await servidor.query("create database "+nome);
  const dst=new URL(url);dst.pathname="/"+nome;const db=new pg.Client({connectionString:dst.href});await db.connect();
  const q=(sql,args)=>db.query(sql,args);const leitor=randomUUID(),operador=randomUUID(),gestor=randomUUID(),admin=randomUUID();
  try{
    for(const role of ["anon","authenticated","service_role"])if(!(await q("select from pg_roles where rolname=$1",[role])).rowCount)await q("create role "+role);
    await q(`create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('app.aal',true))$$;
      grant usage on schema auth to authenticated;
      create type user_role as enum('admin_central','analista_arini','comprador');
      create table profiles(user_id uuid primary key,role user_role,ativo boolean default true,setores text[] default '{comercial}',setores_gestor text[] default '{}',nome text,preferencias jsonb default '{}');
      create table tasks(id uuid primary key default gen_random_uuid(),titulo text);
      create table notificacoes(id uuid primary key default gen_random_uuid(),user_id uuid,titulo text,lida_em timestamptz);
      alter table profiles enable row level security;alter table tasks enable row level security;
      create policy teste_profiles on profiles for all to authenticated using(true) with check(true);
      create policy teste_tasks on tasks for all to authenticated using(true) with check(true);
      grant select,insert,update,delete on profiles,tasks,notificacoes to authenticated;
      create function qa_criar_task() returns void language sql security definer set search_path=public as $$insert into tasks(titulo)values('via definer')$$;`);
    const sql=readFileSync(new URL("../supabase/migrations/0165_equipe_leitura.sql",import.meta.url),"utf8");await q(sql);await q(sql);
    await q("insert into profiles(user_id,role,equipe_acesso,setores_gestor,nome)values($1,'analista_arini','leitura','{}','Leitor'),($2,'analista_arini','operador','{}','Operador'),($3,'analista_arini','operador','{comercial}','Gestor'),($4,'admin_central','operador','{}','Dono')",[leitor,operador,gestor,admin]);
    await q("insert into tasks(titulo)values('Consulta permitida')");
    await q("set role authenticated");await q("select set_config('app.uid',$1,false),set_config('app.aal','aal1',false)",[leitor]);
    assert.equal((await q("select * from tasks")).rowCount,1);
    for(const sql of ["insert into tasks(titulo)values('proibido')","update tasks set titulo='proibido'","delete from tasks","select qa_criar_task()","update profiles set equipe_acesso='operador' where user_id=auth.uid()"])
      await assert.rejects(q(sql),e=>e.code==="42501",sql);
    await q("update profiles set nome='Meu nome',preferencias='{\"tema\":\"escuro\"}' where user_id=auth.uid()");
    await q("select set_config('app.uid',$1,false)",[operador]);await q("select qa_criar_task()");
    // 2FA obrigatório desligado (24/11/2026): gestão opera em aal1.
    for(const pessoa of [gestor,admin]){
      await q("select set_config('app.uid',$1,false),set_config('app.aal','aal1',false)",[pessoa]);
      assert.ok((await q("select * from tasks")).rowCount>0,"sem 2FA obrigatório a gestão consulta");
      await q("select qa_criar_task()");
      assert.equal((await q("select fn_tem_setor('comercial') as setor")).rows[0].setor,true);
    }
    await q("reset role");await q("select set_config('app.uid','',false)");
    await assert.rejects(q("update profiles set equipe_acesso='leitura' where user_id=$1",[admin]),e=>e.code==="23514");
    await assert.rejects(q("update profiles set equipe_acesso='leitura' where user_id=$1",[gestor]),e=>e.code==="23514");
  }finally{await db.end();await servidor.query("drop database "+nome+" with(force)");await servidor.end();}
});
