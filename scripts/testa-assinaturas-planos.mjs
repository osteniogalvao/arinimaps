import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";

const url=process.env.ARINI_TESTE_CARTEIRA_DB;
test("assinaturas cotadas e faturas com gateway simulado",{skip:!url||!["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname)},async t=>{
 const servidor=new pg.Client({connectionString:url});await servidor.connect();
 const banco="arini_test_"+randomUUID().replaceAll("-","");await servidor.query("create database "+banco);
 const endereco=new URL(url);endereco.pathname="/"+banco;
 const pool=new pg.Pool({connectionString:endereco.href}),sql=(q,v=[])=>pool.query(q,v);
 pool.on("error",()=>{});
 try {
  for(const r of ["anon","authenticated","service_role"]) if(!(await sql("select from pg_roles where rolname=$1",[r])).rowCount) await sql("create role "+r);
  await sql(`create table profiles(user_id uuid primary key,ativo boolean default true,role text,setores text[],nicho text,plan_id text,plan_origem text default 'padrao',plan_valido_ate timestamptz,asaas_customer_id text);
   create domain geography as numeric;
   create function st_area(geography) returns numeric language sql as 'select $1::numeric';
   create function st_equals(numeric,numeric) returns boolean language sql as 'select $1=$2';
   create table monitor_areas(id uuid,ativo boolean,titular uuid,nicho text,geom numeric,aceite_em timestamptz,cofre_id uuid);
   create function monitor_geom_cofre(uuid,uuid) returns numeric language sql as 'select null::numeric';
   create function monitor_cota(uuid,text,text) returns bigint language sql as 'select null::bigint';
   create function monitor_autorizado(uuid,text) returns boolean language sql as 'select true';
   create table partners(profile_id uuid,tipo text,status text);
   create table plans(id text primary key,ativo boolean,preco_mensal numeric,escopo text);
   create table organizations(id uuid primary key,ativo boolean,plan_id text,plan_valido_ate timestamptz);
   create table organization_members(user_id uuid,org_id uuid,status text,nicho_vinculo text,papel_org text);
   create table plan_subscriptions(user_id uuid,nicho_vinculo text,status text);
   create table conta_contextos(titular uuid,nicho text,plano text,origem text,validade timestamptz);
   create table solicitacoes_planos(id uuid primary key,user_id uuid,status text,cotacao jsonb,updated_at timestamptz);
   create table cofre_concessoes(pedido_id uuid,titular_id uuid,quantidade int default 1);
   create table audit_log(user_id uuid,acao text,entidade text,entidade_id uuid,dados_depois jsonb);
   create function public.cofre_limite(uuid) returns bigint language sql as 'select 3::bigint';
   insert into plans values('proprietario_completo',true,99.90,'conta'),('tecnico_profissional',true,479,'organizacao');`);
  await sql(await readFile(new URL("../supabase/migrations/0099_assinaturas_cotadas.sql",import.meta.url),"utf8"));
  const adm=randomUUID();await sql("insert into profiles(user_id,role) values($1,'admin_central')",[adm]);
  async function pedido(ciclo="mensal",extras=0,tecnico=false){
    const id=randomUUID(),u=randomUUID(),p=tecnico?"tecnico_profissional":"proprietario_completo",n=tecnico?"engenheiro":"proprietario";
    await sql("insert into profiles(user_id,role,nicho,asaas_customer_id) values($1,$2,$3,'cus_sintetico')",[u,tecnico?"engenheiro":"proprietario",n]);
    const primeira=ciclo==="anual"?69900:6990,normal=ciclo==="anual"?69900:9990;
    await sql("insert into solicitacoes_planos values($1,$2,'em_analise',$3,now())",[id,u,JSON.stringify({planoId:p,personaId:tecnico?"profissional_tecnico":n,ciclo,sobOrcamento:false,
       baseCicloCentavos:primeira,adicionaisMensaisCentavos:extras*1500,mensalRecorrenteCentavos:ciclo==="anual"?null:normal+extras*1500,itens:extras?[{id:"propriedade_adicional",quantidade:extras}]:[]})]);
    return {id,u,p,liberar:(ator=adm)=>sql("select assinatura_liberar($1,$2,'Escopo sintético disponível para os testes.')",[ator,id]),aceitar:(valor=primeira)=>sql("select assinatura_aceitar($1,$2,'cus_sintetico',$3,$4,$5,$6)",[u,id,valor,normal,extras*1500,ciclo])};
  }
  const cancelar=(s,estorno)=>sql("select assinatura_cancelar($1,$2,$3)",[s.u,s.id,estorno]);
  const faturas=async(s)=>(await sql("select * from faturas_cotadas where assinatura=$1 order by componente desc,numero",[s.id])).rows;
  const reservar=f=>sql("select assinatura_reservar_emissao($1) r",[f.id]);
  const evento=(f,tipo,valor=f.valor,cliente="cus_sintetico")=>sql("select assinatura_pagamento($1,$2,$3,$4,$5)",[f.id,"pay_"+f.id,cliente,valor,tipo]);
  await t.test("aceite, promoção, concorrência, suspensão e perfil alternativo",async()=>{
   const s=await pedido();await assert.rejects(s.aceitar());await assert.rejects(s.liberar(s.u),{code:"42501"});await s.liberar();
   assert.equal((await faturas(s)).length,0);await assert.rejects(s.aceitar(1),{code:"55000"});
   await Promise.all([s.aceitar(),s.aceitar()]);const [f]=await faturas(s);assert.equal(f.valor,6990);
   assert.deepEqual((await Promise.all([reservar(f),reservar(f)])).map(x=>x.rows[0].r).sort(),[false,true]);
   await assert.rejects(evento(f,"PAYMENT_RECEIVED",1),{code:"22023"});await assert.rejects(evento(f,"PAYMENT_RECEIVED",6990,"cus_errado"),{code:"22023"});
   assert.equal((await sql("select plan_id from profiles where user_id=$1",[s.u])).rows[0].plan_id,null);
   await sql("insert into conta_contextos values($1,'proprietario',null,'padrao',null)",[s.u]);await sql("update profiles set nicho='produtor_rural',plan_id='produtor_teste' where user_id=$1",[s.u]);
   await Promise.all([evento(f,"PAYMENT_RECEIVED"),evento(f,"PAYMENT_CONFIRMED")]);assert.equal((await sql("select plano from conta_contextos where titular=$1",[s.u])).rows[0].plano,s.p);
   assert.equal((await sql("select plan_id from profiles where user_id=$1",[s.u])).rows[0].plan_id,"produtor_teste");
   await sql("select assinatura_gerar($1,$2)",[s.id,f.fim]);const [,segunda]=await faturas(s);assert.equal(segunda.valor,9990);
   await reservar(segunda);await evento(segunda,"PAYMENT_OVERDUE");assert.equal((await faturas(s))[1].status,"vencida");
   await Promise.all([cancelar(s,true),evento(f,"PAYMENT_REFUNDED")]);await evento(f,"PAYMENT_RECEIVED");
   assert.equal((await faturas(s))[0].status,"estornada");assert.equal((await sql("select plano from conta_contextos where titular=$1",[s.u])).rows[0].plano,null);
  });
  await t.test("anual e vagas separadas, cancelamento preserva prazo pago e estorno revoga só vagas",async()=>{
   const s=await pedido("anual",2);await s.liberar();await s.aceitar();const [base,extras]=await faturas(s);
   assert.equal(base.valor,69900);assert.equal(extras.valor,3000);await reservar(base);await reservar(extras);
   await evento(base,"PAYMENT_CONFIRMED");const limite=async()=>Number((await sql("select cofre_limite($1) n",[s.u])).rows[0].n);
   assert.equal(await limite(),3);await evento(extras,"PAYMENT_RECEIVED");assert.equal(await limite(),5);
   await assert.rejects(sql("insert into cofre_concessoes(pedido_id,titular_id) values($1,$2)",[s.id,s.u]),{code:"55000"});
   await sql("insert into monitor_areas select gen_random_uuid(),true,$1,'proprietario',1000,now()+make_interval(mins=>n),null from generate_series(1,4)n",[s.u]);
   const quarta=async()=>(await sql("select monitor_area_habilitada(a) h from monitor_areas a where titular=$1 order by aceite_em desc limit 1",[s.u])).rows[0].h;
   await sql("insert into conta_contextos select user_id,nicho,plan_id,plan_origem,plan_valido_ate from profiles where user_id=$1",[s.u]);
   await sql("update profiles set nicho='produtor_rural',plan_id='produtor_teste',plan_origem='padrao',plan_valido_ate=null where user_id=$1",[s.u]);
   assert.equal(await quarta(),true);assert.equal(await limite(),3);
   await sql("update profiles p set nicho=c.nicho,plan_id=c.plano,plan_origem=c.origem,plan_valido_ate=c.validade from conta_contextos c where c.titular=p.user_id and p.user_id=$1",[s.u]);
   await cancelar(s,false);assert.equal(await limite(),5);await evento(extras,"PAYMENT_REFUNDED");assert.equal(await limite(),3);assert.equal(await quarta(),false);
   await sql("update profiles set plan_id='manual',plan_origem='manual' where user_id=$1",[s.u]);await evento(base,"PAYMENT_REFUNDED");
   assert.equal((await sql("select plan_id from profiles where user_id=$1",[s.u])).rows[0].plan_id,"manual");
  });
  await t.test("escopo organização só com vínculo de administrador e validade de competência vencida",async()=>{
   const s=await pedido("mensal",0,true);await s.liberar();await assert.rejects(s.aceitar(),{code:"55000"});
   await sql("insert into partners values($1,'engenheiro','aprovado')",[s.u]);const o=randomUUID();await sql("insert into organizations values($1,true,null,null)",[o]);await sql("insert into organization_members values($1,$2,'ativo','engenheiro','admin')",[s.u,o]);await s.aceitar();
   const [f]=await faturas(s);await reservar(f);await evento(f,"PAYMENT_RECEIVED");
   assert.equal((await sql("select plan_id from organizations where id=$1",[o])).rows[0].plan_id,s.p);
   await cancelar(s,false);await evento(f,"PAYMENT_REFUNDED");assert.equal((await sql("select plan_id from organizations where id=$1",[o])).rows[0].plan_id,null);
   const velho=await pedido();await velho.liberar();await velho.aceitar();const [v]=await faturas(velho);await reservar(v);
   await sql("update faturas_cotadas set inicio=current_date-62,fim=current_date-30 where id=$1",[v.id]);await evento(v,"PAYMENT_RECEIVED");
   assert.equal((await faturas(velho))[0].operacao,"estornar");assert.equal((await sql("select plan_id from profiles where user_id=$1",[velho.u])).rows[0].plan_id,null);
  });
 }finally{await pool.end();await servidor.query("drop database "+banco+" with (force)");await servidor.end();}
});