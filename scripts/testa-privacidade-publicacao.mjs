import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";

const url=process.env.ARINI_TESTE_CARTEIRA_DB;
const local=url && ["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname);
test("privacidade, exclusividade e recuperação da Central", {skip:!local}, async t=>{
  const db="arini_test_"+randomUUID().replaceAll("-","");
  const host=new pg.Client({connectionString:url}); await host.connect(); await host.query("create database "+db);
  const u=new URL(url);u.pathname="/"+db;const pool=new pg.Pool({connectionString:u.href});const c=await pool.connect();
  // As regras de prazo usam a data de Brasília; current_date do teste precisa seguir o mesmo fuso,
  // senão entre 21h e 0h (horário de Brasília) os dias divergem e o teste falha pelo relógio.
  await c.query("set timezone='America/Sao_Paulo'");
  const q=(s,v=[])=>c.query(s,v); const desde=(id)=>readFile(new URL("../supabase/migrations/"+id,import.meta.url),"utf8");
  const [owner,corretor,marketing,ops,par,im,aut]=Array.from({length:7},()=>randomUUID());
  try {
    await q(`do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
    create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table profiles(user_id uuid primary key,role text,ativo boolean,setores text[]);
    create function fn_tem_setor(text) returns boolean language sql stable set search_path=public as $$select exists(select from profiles where user_id=auth.uid() and ativo and (role='admin_central' or (role='analista_arini' and $1=any(setores))))$$;
    create table partners(id uuid primary key,profile_id uuid,tipo text,status text);
    create table opportunities(responsavel_tipo text,responsavel_partner_id uuid,partner_comprador_id uuid);
    create table property_espelho(i int); create table property_espelho_eventos(i int);
    create table properties(id uuid primary key,modalidade text,status text,codigo text);
    create table property_authorizations(id uuid,property_id uuid,tipo text,aceite_por uuid,aceite_at timestamptz,validade date,termo_aceito jsonb,prazo_meses integer default 6);
    create table exclusividade_eventos(autorizacao uuid,evento text,vencimento date,criado_em timestamptz default now());
    create table property_documents(property_id uuid,tipo text,verificado boolean,substituido_por uuid);
    create table recuperacao_codigos(user_id uuid primary key,codigo_hash text,tentativas int,expira_em timestamptz);
    create table settings(chave text,valor jsonb);create table plans(id text,recursos text[]);
    create table leads(id uuid);create table favoritos(id uuid);create policy leads_setor_select on leads using(true);create policy favoritos_setor_select on favoritos using(true);
    create table crm_pipelines(id uuid default gen_random_uuid(),setor text,nome text,descricao text);
    create table crm_etapas(pipeline_id uuid,nome text,ordem int,sla_horas int,final boolean);`);
    await q("insert into profiles values($1,'proprietario',true,'{}'),($2,'corretor',true,'{}'),($3,'analista_arini',true,'{marketing}'),($4,'analista_arini',true,'{comercial}')",[owner,corretor,marketing,ops]);
    await q("insert into partners values($1,$2,'corretor','ativo')",[par,corretor]);
    for (const f of ["0127_privacidade_oportunidades.sql","0128_exclusividade_publicacao.sql","0129_marketing_trafego.sql","0133_codigo_recuperacao.sql","0134_comparacao_insumos.sql","0136_vigencia_termo_conferido.sql","0137_grupos_insumos.sql"]) await q(await desde(f));
    await t.test("dono ou Marketing não leem oportunidade; só o parceiro designado ativo e o Comercial leem",async()=>{
      const ve=async(user,tipo,id)=>{await q("select set_config('test.uid',$1,false)",[user]);return (await q("select fn_opp_visible(row($1,$2,null)::opportunities) ok",[tipo,id])).rows[0].ok;};
      assert.equal(await ve(owner,"proprietario",null),false);assert.equal(await ve(marketing,"parceiro",par),false);assert.equal(await ve(corretor,"parceiro",par),true);
      assert.equal(await ve(corretor,"proprietario",par),false);assert.equal(await ve(ops,"central",null),true);
      await q("update partners set status='suspenso'");assert.equal(await ve(corretor,"parceiro",par),false);
      assert.deepEqual((await q("select setores from profiles where user_id=$1",[marketing])).rows[0].setores,["marketing","marketing_trafego"]);
    });
    const status=(s)=>q("update properties set status=$1 where id=$2",[s,im]); const bloqueada=async(s)=>assert.rejects(status(s),{code:"P1280"});
    await t.test("não publica com autorização simples, desatualizada, ainda em carência ou vencida; leilão segue regras distintas",async()=>{
      await q("insert into properties values($1,'venda','pendente')",[im]);await bloqueada("aprovado");
      await q("insert into property_documents(property_id,tipo,verificado) values($1,'autorizacao',true)",[im]);await bloqueada("publicado");
      await q("update property_documents set exclusividade_assinada_em=current_date-1,exclusividade_meses=6");await status("aprovado");await bloqueada("publicado");
      await q("update property_documents set exclusividade_assinada_em=current_date-181");await bloqueada("publicado");
      await q("update property_documents set exclusividade_assinada_em=current_date-10,substituido_por=gen_random_uuid()");await bloqueada("publicado");
      await q("update property_documents set substituido_por=null");await status("publicado");
      await q("update property_documents set verificado=false,exclusividade_assinada_em=null,exclusividade_meses=null");
      assert.equal((await q("select status from properties where id=$1",[im])).rows[0].status,"suspenso");
      await q("insert into properties values(gen_random_uuid(),'leilao','publicado')");
    });
    await t.test("aceite eletrônico tem carência e encerramento revoga o direito de republicar",async()=>{
      await q("delete from property_documents");await q(`insert into property_authorizations values($1,$2,'exclusividade',$3,now(),current_date+180,'{"versao":"2026.11.15"}')`,[aut,im,owner]);
      await status("aprovado");await bloqueada("publicado");await q("update property_authorizations set aceite_at=now()-interval '8 days'");await status("publicado");await status("suspenso");
      await q("insert into exclusividade_eventos values($1,'desistencia')",[aut]);await bloqueada("publicado");
    });
    await t.test("um termo antigo não derruba a venda com outro válido; o vencimento do último suspende uma só vez",async()=>{
      await q("insert into property_documents(property_id,tipo,verificado,exclusividade_assinada_em,exclusividade_meses) values($1,'autorizacao',true,current_date-10,6)",[im]);
      await q("delete from exclusividade_eventos");await q("update property_authorizations set validade=current_date-1");await status("publicado");
      assert.equal((await q("select fn_vigencia_exclusividades() n")).rows[0].n,1);
      assert.equal((await q("select status from properties where id=$1",[im])).rows[0].status,"publicado");
      // Simula o relógio do próximo ciclo sem desativar triggers da tabela de imóveis.
      await q("alter table property_documents disable trigger tr_retirar_termo_conferido");
      await q("update property_documents set exclusividade_assinada_em=current_date-181");await q("alter table property_documents enable trigger tr_retirar_termo_conferido");
      assert.equal((await q("select fn_conferir_vigencia_documental() n")).rows[0].n,1);
      assert.equal((await q("select fn_conferir_vigencia_documental() n")).rows[0].n,0);
    });
    await t.test("comparador encontra itens antigos, separa unidade e não mistura notas de titulares",async()=>{
      await q(`insert into insumos_compras(titular,documento,item,emissao,fornecedor,produto,gtin,unidade,quantidade,total)
        select $1,repeat('a',64),i,current_date,'Loja','Adubo '||i,null,'KG',5,100 from generate_series(1,700)i`,[owner]);
      await q(`insert into insumos_compras(titular,documento,item,emissao,fornecedor,produto,gtin,unidade,quantidade,total) values
        ($1,repeat('b',64),1,current_date-150,'Cooperativa','Produto A','12345678','KG',5,10),
        ($1,repeat('b',64),2,current_date,'Loja','Produto A em promoção','12345678','KG',2,12),
        ($1,repeat('b',64),3,current_date,'Loja','Produto A','12345678','SC',1,30),
        ($2,repeat('c',64),1,current_date,'Outro','Produto A','12345678','KG',1,0.01)`,[owner,ops]);
      const linhas=(await q("select grupo,menor from fn_grupos_compra($1,'promoção',0)",[owner])).rows;
      assert.equal(linhas.length,1);assert.equal(Number(linhas[0].menor),2);
      assert.equal((await q("select count(*) n from fn_grupos_compra($1,'12345678',0)",[owner])).rows[0].n,"2");
      assert.equal((await q("select count(*) n from fn_grupos_compra($1,'Adubo',10)",[owner])).rows[0].n,"51");
    });
    await t.test("cinco tentativas paralelas bloqueiam o código; o código novo só pode ser consumido uma vez",async()=>{
      const tenta=(hash)=>pool.query("select fn_tentar_codigo_recuperacao($1,$2) ok",[ops,hash]).then(r=>r.rows[0].ok);
      await q("insert into recuperacao_codigos values($1,'certo',0,now()+interval '15 minutes')",[ops]);
      assert.deepEqual(await Promise.all(Array.from({length:6},()=>tenta("errado"))),Array(6).fill(false)); assert.equal(await tenta("certo"),false);
      await q("update recuperacao_codigos set tentativas=0,codigo_hash='novo'");assert.deepEqual((await Promise.all([tenta("novo"),tenta("novo")])).sort(),[false,true]);
    });
  } finally {c.release();await pool.end();await host.query("drop database "+db);await host.end();}
});
