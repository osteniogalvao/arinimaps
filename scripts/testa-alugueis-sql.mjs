// Integração das migrations reais de caixa/aluguéis num banco descartável local.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
const url = process.env.ARINI_TESTE_CARTEIRA_DB;
const ler = p => readFileSync(new URL("../supabase/migrations/" + p,import.meta.url),"utf8");
test("Aluguéis: contrato, parcelas idempotentes, atraso, caixa, repasse e estornos", { skip:!url }, async () => {
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname));
  const servidor = new pg.Client({ connectionString:url }); await servidor.connect();
  const nome = "arini_test_" + randomUUID().replaceAll("-","");
  await servidor.query("create database " + nome);
  const dst = new URL(url); dst.pathname="/"+nome;
  const db = new pg.Pool({ connectionString:dst.href });
  const q=(sql,args)=>db.query(sql,args), uma=async(sql,args)=>(await q(sql,args)).rows[0];
  try {
    for (const role of ["anon","authenticated","service_role"]) if (!(await q("select from pg_roles where rolname=$1",[role])).rowCount) await q("create role "+role);
    await q(`create table profiles(user_id uuid primary key);
      create table properties(id uuid primary key);
      create table settings(chave text primary key,valor jsonb);
      create table tarefas_teste(chave text primary key, titulo text);
      create function fn_touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
      create function fn_tarefa_automatica(text,text,text,text,text,uuid,date,text) returns uuid language plpgsql as $$
      begin insert into tarefas_teste values ($1,$4) on conflict do nothing; if found then return gen_random_uuid();end if; return null;end$$;`);
    // Blocos do produto, sem reconstruir o cálculo financeiro na fixture.
    await q(ler("0066_central_financeiro.sql").split("create or replace function trg_despesa_lancamento()")[0]);
    const aluguel = ler("0157_crm_arini_alugueis_caixa_fluxo.sql").split("-- 3. Fluxo do imóvel:")[0];
    await q(aluguel); await q(aluguel);
    const {id:contrato}=await uma(`insert into contratos_locacao(proprietario_nome,inquilino_nome,valor_aluguel,taxa_administracao,inicio,fim)
      values('Proprietário sintético','Inquilino sintético',1000,10,'2026-01-01','2027-12-31') returning id`);
    const criar=()=>uma("select fn_aluguel_gerar_parcela($1,'2026-11-01') id",[contrato]);
    const concorrentes=await Promise.all([criar(),criar()]);
    assert.equal(concorrentes.filter(r=>r.id).length,1);
    const id=concorrentes.find(r=>r.id).id;
    assert.equal((await uma("select fn_aluguel_gerar_parcela($1,'2025-12-01') id",[contrato])).id,null);
    await q("update contas_bancarias set saldo_inicial_em='2026-01-01'");
    const saldo=async()=>Number((await uma("select * from fn_caixa_saldos() limit 1")).saldo);
    await q("update alugueis_parcelas set status='pago',pago_em='2026-11-20',valor_pago=1000 where id=$1",[id]);
    assert.equal(await saldo(),1000);
    await q("update alugueis_parcelas set status='pago' where id=$1",[id]);
    assert.equal(Number((await uma("select count(*) n from lancamentos_contabeis where not estornado")).n),1);
    await q("update alugueis_parcelas set repasse_status='repassado',repasse_em='2026-11-25' where id=$1",[id]);
    assert.equal(await saldo(),100);
    await q("update alugueis_parcelas set repasse_status='pendente',repasse_em=null where id=$1",[id]);
    assert.equal(await saldo(),1000);
    await q("update alugueis_parcelas set status='pendente',pago_em=null,valor_pago=null where id=$1",[id]);
    assert.equal(await saldo(),0);
    await q("update alugueis_parcelas set status='pago',pago_em='2026-11-20',valor_pago=1000 where id=$1",[id]);
    assert.equal(await saldo(),1000);
    await q("select fn_alugueis_rotina()");
    const antes=Number((await uma("select count(*) n from tarefas_teste")).n);
    await q("select fn_alugueis_rotina()");
    assert.equal(Number((await uma("select count(*) n from tarefas_teste")).n),antes);
    assert.ok(antes>0,"rotina gerou lembrete de repasse");
  } finally {
    await db.end(); await servidor.query("drop database "+nome+" with (force)"); await servidor.end();
  }
});
