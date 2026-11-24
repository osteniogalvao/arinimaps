import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
const url=process.env.ARINI_TESTE_CARTEIRA_DB;
const ler=p=>readFileSync(new URL("../supabase/migrations/"+p,import.meta.url),"utf8");
test("Atendimento abre CRM de forma atômica, concorrente, autorizada e com uma notificação",{skip:!url},async()=>{
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname));
  const servidor=new pg.Client({connectionString:url});await servidor.connect();
  const nome="arini_test_"+randomUUID().replaceAll("-","");await servidor.query("create database "+nome);
  const dst=new URL(url);dst.pathname="/"+nome;const db=new pg.Pool({connectionString:dst.href});
  const q=(sql,args)=>db.query(sql,args),uma=async(sql,args)=>(await q(sql,args)).rows[0];
  try{
    for(const role of ["anon","authenticated","service_role"])if(!(await q("select from pg_roles where rolname=$1",[role])).rowCount)await q("create role "+role);
    await q(`create table profiles(user_id uuid primary key,role text,setores text[],ativo boolean default true,atendimento_recepcao boolean default false);
      create table properties(id uuid primary key);create table opportunities(id uuid primary key);
      create table avisos(titular uuid,titulo text,chave text unique);
      create function fn_notificar(uuid,text,text,text,text,text) returns void language sql as $$insert into avisos values ($1,$3,$6) on conflict do nothing$$;
      create function fn_touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;`);
    await q(ler("0069_central_crm_setores.sql").split("-- modelos iniciais")[0]);
    await q(`create table atendimento_conversas(id uuid primary key default gen_random_uuid(),codigo text default 'AT-QA',telefone text,nome text,setor text,responsavel uuid,
      crm_item_id uuid references crm_itens(id),opportunity_id uuid,ultimo_texto text);
      create table atendimento_eventos(id uuid primary key default gen_random_uuid(),conversa_id uuid references atendimento_conversas(id),acao text,autor uuid,texto text);`);
    const migracao=ler("0163_atendimento_crm_atomico.sql");await q(migracao);await q(migracao);
    const admin=randomUUID(),comercial=randomUUID(),juridico=randomUUID();
    await q("insert into profiles(user_id,role,setores)values($1,'admin_central','{}'),($2,'analista_arini','{comercial}'),($3,'analista_arini','{juridico}')",[admin,comercial,juridico]);
    const {id:funil}=await uma("insert into crm_pipelines(setor,nome) values ('comercial','Vendas') returning id");
    await q("insert into crm_etapas(pipeline_id,nome,ordem,sla_horas)values($1,'Entrada',0,24)",[funil]);
    const conversa=async()=> (await uma("insert into atendimento_conversas(telefone,setor,nome)values('5511000000000','comercial','Cliente sintético')returning id")).id;
    const id=await conversa();
    const abrir=(id,autor=admin)=>uma("select fn_atendimento_abrir_crm($1,$2,$3,'Negociação sintética') r",[id,autor,funil]);
    await assert.rejects(abrir(id,juridico),e=>e.code==="42501");
    const resultados=await Promise.allSettled([abrir(id),abrir(id)]);
    assert.equal(resultados.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(resultados.find(r=>r.status==="rejected").reason.code,"23505");
    for(const tabela of ["crm_itens","crm_item_eventos","atendimento_eventos","avisos"])assert.equal(Number((await uma("select count(*) n from "+tabela)).n),1,tabela);
    const item=await uma("select * from crm_itens");assert.equal(item.dados.telefone,"+5511000000000");assert.ok(item.prazo_etapa);
    assert.equal((await uma("select crm_item_id from atendimento_conversas where id=$1",[id])).crm_item_id,item.id);
    await q("insert into crm_campos(pipeline_id,chave,rotulo,tipo,exigido_desde)values($1,'cpf','CPF conferido','texto',$2)",[funil,item.etapa_id]);
    const semDados=await conversa();await assert.rejects(abrir(semDados),/campos obrigatórios.*CPF conferido/);
    assert.equal((await uma("select crm_item_id from atendimento_conversas where id=$1",[semDados])).crm_item_id,null);
    assert.equal(Number((await uma("select count(*) n from crm_itens")).n),1);
    await q("delete from crm_campos where pipeline_id=$1",[funil]);
    // Falha depois de criar o item deve reverter item, trigger de aviso e vínculo.
    await q(`create function qa_falha_evento() returns trigger language plpgsql as $$begin raise exception 'falha sintética';end$$;
      create trigger qa_falha before insert on atendimento_eventos for each row execute function qa_falha_evento();`);
    const segundo=await conversa();await assert.rejects(abrir(segundo),/falha sintética/);
    assert.equal((await uma("select crm_item_id from atendimento_conversas where id=$1",[segundo])).crm_item_id,null);
    for(const tabela of ["crm_itens","crm_item_eventos","avisos"])assert.equal(Number((await uma("select count(*) n from "+tabela)).n),1,tabela);
    assert.equal((await uma("select has_function_privilege('authenticated','fn_atendimento_abrir_crm(uuid,uuid,uuid,text)','execute') permitido")).permitido,false);
  }finally{await db.end();await servidor.query("drop database "+nome+" with(force)");await servidor.end();}
});

