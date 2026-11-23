// Contratação direta dos planos (migration 0155, áudios do Carlos de 23/11/2026).
// node --test scripts/testa-contratacao-direta.mjs  (com ARINI_TESTE_CARTEIRA_DB apontando para um Postgres local)
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";

const url=process.env.ARINI_TESTE_CARTEIRA_DB;
test("contratação direta libera, aceita e cria o escritório quando preciso",{skip:!url||!["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname)},async t=>{
 const servidor=new pg.Client({connectionString:url});await servidor.connect();
 const banco="arini_test_"+randomUUID().replaceAll("-","");await servidor.query("create database "+banco);
 const endereco=new URL(url);endereco.pathname="/"+banco;
 const pool=new pg.Pool({connectionString:endereco.href}),sql=(q,v=[])=>pool.query(q,v);
 pool.on("error",()=>{});
 try {
  for(const r of ["anon","authenticated","service_role"]) if(!(await sql("select from pg_roles where rolname=$1",[r])).rowCount) await sql("create role "+r);
  await sql(`create schema auth; create table auth.users(id uuid primary key,email text);
   create table profiles(user_id uuid primary key,nome text,ativo boolean default true,role text,setores text[],nicho text,plan_id text,plan_origem text default 'padrao',plan_valido_ate timestamptz,asaas_customer_id text);
   create domain geography as numeric;
   create function st_area(geography) returns numeric language sql as 'select $1::numeric';
   create function st_equals(numeric,numeric) returns boolean language sql as 'select $1=$2';
   create table monitor_areas(id uuid,ativo boolean,titular uuid,nicho text,geom numeric,aceite_em timestamptz,cofre_id uuid);
   create function monitor_geom_cofre(uuid,uuid) returns numeric language sql as 'select null::numeric';
   create function monitor_cota(uuid,text,text) returns bigint language sql as 'select null::bigint';
   create function monitor_autorizado(uuid,text) returns boolean language sql as 'select true';
   create table partners(profile_id uuid,tipo text,status text);
   create table plans(id text primary key,nome text,ativo boolean,preco_mensal numeric,escopo text);
   create table organizations(id uuid primary key default gen_random_uuid(),nome text not null,tipo text not null,ativo boolean default true,plan_id text,plan_valido_ate timestamptz,created_by uuid,observacoes text);
   create table organization_members(id uuid primary key default gen_random_uuid(),user_id uuid,org_id uuid,email text not null,status text,nicho_vinculo text,papel_org text,convidado_por uuid,aceito_em timestamptz);
   create unique index uq_org_members_user_ativo on organization_members (user_id) where status = 'ativo';
   create table plan_subscriptions(user_id uuid,nicho_vinculo text,status text);
   create table conta_contextos(titular uuid,nicho text,plano text,origem text,validade timestamptz);
   create table solicitacoes_planos(id uuid primary key,user_id uuid,status text,cotacao jsonb,updated_at timestamptz);
   create table cofre_concessoes(pedido_id uuid,titular_id uuid,quantidade int default 1);
   create table audit_log(user_id uuid,acao text,entidade text,entidade_id uuid,dados_depois jsonb);
   create function public.cofre_limite(uuid) returns bigint language sql as 'select 3::bigint';
   insert into plans values('tecnico_consulta','Consulta territorial',true,29.90,'conta'),('corretor_essencial','Corretor · Essencial',true,97,'organizacao'),
     ('tecnico_essencial','Técnico · Essencial',true,79.90,'organizacao'),('proprietario_monitoramento','Monitoramento',true,49,'conta');`);
  await sql(await readFile(new URL("../supabase/migrations/0099_assinaturas_cotadas.sql",import.meta.url),"utf8"));
  await sql("create table assinatura_reajustes(assinatura uuid,vigencia date,aplicado_em timestamptz)");
  await sql(await readFile(new URL("../supabase/migrations/0124_troca_de_plano.sql",import.meta.url),"utf8"));
  await sql(await readFile(new URL("../supabase/migrations/0155_contratacao_direta_planos.sql",import.meta.url),"utf8"));

  async function conta(role,nicho){
   const u=randomUUID();
   await sql("insert into auth.users values($1,$2)",[u,u.slice(0,8)+"@teste.arini"]);
   await sql("insert into profiles(user_id,nome,role,nicho,asaas_customer_id) values($1,'Conta Teste',$2,$3,$4)",[u,role,nicho,"cus_"+u]);
   return u;
  }
  async function pedido(u,planoId,personaId,{ciclo="mensal",base=2990,recorrente=base,itens=[],extras=0}={}){
   const id=randomUUID();
   await sql("insert into solicitacoes_planos values($1,$2,'pendente',$3,now())",[id,u,JSON.stringify({planoId,personaId,ciclo,sobOrcamento:false,itens,
     baseCicloCentavos:base,adicionaisMensaisCentavos:extras,mensalRecorrenteCentavos:ciclo==="anual"?null:recorrente+extras})]);
   return id;
  }
  const direto=(u,id)=>sql("select assinatura_contratar_direto($1,$2) n",[u,id]).then(r=>r.rows[0].n);
  const aceitar=async(u,id)=>{
   const s=(await sql("select * from assinaturas_cotadas where id=$1",[id])).rows[0];
   return sql("select assinatura_aceitar($1,$2,$3,$4,$5,$6,$7)",[u,id,"cus_"+u,s.primeira,s.recorrente,s.adicionais,s.ciclo]);
  };

  await t.test("corretor contrata a Consulta territorial no próprio perfil e a fatura sai",async()=>{
   const u=await conta("corretor","corretor_imobiliaria"),id=await pedido(u,"tecnico_consulta","profissional_tecnico");
   assert.equal(await direto(u,id),"corretor_imobiliaria");
   assert.equal(await direto(u,id),"corretor_imobiliaria","repetir não duplica");
   await aceitar(u,id);
   assert.equal((await sql("select status from solicitacoes_planos where id=$1",[id])).rows[0].status,"concluido");
   const f=(await sql("select valor,status from faturas_cotadas where assinatura=$1",[id])).rows;
   assert.deepEqual(f,[{valor:2990,status:"nova"}]);
  });

  await t.test("plano de escritório do corretor cria o escritório com o titular como administrador",async()=>{
   const u=await conta("corretor","corretor_imobiliaria"),id=await pedido(u,"corretor_essencial","corretor_imobiliaria",{base:9700});
   assert.equal(await direto(u,id),"corretor_imobiliaria");
   const m=(await sql("select m.papel_org,m.status,m.nicho_vinculo,o.tipo from organization_members m join organizations o on o.id=m.org_id where m.user_id=$1",[u])).rows;
   assert.deepEqual(m,[{papel_org:"admin",status:"ativo",nicho_vinculo:"corretor_imobiliaria",tipo:"imobiliaria"}]);
   await aceitar(u,id);
   assert.ok((await sql("select org from assinaturas_cotadas where id=$1",[id])).rows[0].org);
  });

  await t.test("técnico sem cadastro profissional aprovado fica na fila da Central, sem nada criado",async()=>{
   const u=await conta("engenheiro","engenheiro"),id=await pedido(u,"tecnico_essencial","profissional_tecnico",{base:7990});
   await assert.rejects(direto(u,id),/cadastro profissional aprovado/);
   assert.equal((await sql("select status from solicitacoes_planos where id=$1",[id])).rows[0].status,"pendente");
   assert.equal((await sql("select count(*)::int n from organization_members where user_id=$1",[u])).rows[0].n,0);
  });

  await t.test("complementos: vagas de propriedade seguem direto; outros vão para a Central",async()=>{
   const u=await conta("proprietario","proprietario");
   const ok=await pedido(u,"proprietario_monitoramento","proprietario",{base:4900,itens:[{id:"propriedade_adicional",quantidade:2}],extras:3000});
   assert.equal(await direto(u,ok),"proprietario");
   assert.deepEqual((await sql("select primeira,recorrente,adicionais,vagas from assinaturas_cotadas where id=$1",[ok])).rows[0],{primeira:4900,recorrente:4900,adicionais:3000,vagas:2});
   const especial=await pedido(u,"proprietario_monitoramento","proprietario",{base:4900,itens:[{id:"creditos_ia",quantidade:1}],extras:3000});
   await assert.rejects(direto(u,especial),/configurados pela Central/);
  });

  await t.test("pedido de outra conta ou de outro perfil é recusado",async()=>{
   const u=await conta("proprietario","proprietario"),outro=await conta("corretor","corretor_imobiliaria");
   const id=await pedido(u,"proprietario_monitoramento","proprietario",{base:4900});
   await assert.rejects(direto(outro,id),/Pedido não encontrado/);
   const errado=await pedido(outro,"proprietario_monitoramento","proprietario",{base:4900});
   await assert.rejects(direto(outro,errado),/outro perfil/);
  });
 } finally {
  await pool.end();await servidor.query("drop database "+banco);await servidor.end();
 }
});
