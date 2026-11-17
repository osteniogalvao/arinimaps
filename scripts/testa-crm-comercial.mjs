// CRM comercial (migration 0147): rodízio com carteira, fila vazia, regras por
// corretor, lead cadastrado na Central e prazo só no expediente. Roda contra um
// Postgres local descartável (o mesmo ARINI_TESTE_CARTEIRA_DB dos outros testes).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const endereco = process.env.ARINI_TESTE_CARTEIRA_DB;
const local = endereco && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(endereco).hostname);

test("rodízio, carteira e lead manual do CRM comercial", { skip: !local }, async () => {
  const admin = new pg.Client({ connectionString: endereco });
  await admin.connect();
  const nome = "arini_test_" + randomUUID().replaceAll("-", "");
  await admin.query("create database " + nome);
  const dst = new URL(endereco);
  dst.pathname = "/" + nome;
  const pool = new pg.Pool({ connectionString: dst.href });
  const q = (sql, args = []) => pool.query(sql, args);
  const uma = async (sql, args = []) => (await q(sql, args)).rows[0];
  const [ana, bia, dir] = [randomUUID(), randomUUID(), randomUUID()];
  const lead = async (nomeCliente, fone, { resp = null, rodizio = true, codigo = "AIB-1" } = {}) =>
    (await uma("select fn_crm_lead_manual($1,$2,$3,$4,null,null,'telefone',null,null,$5,$6) r",
      [dir, codigo, nomeCliente, fone, resp, rodizio])).r;
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      if (!(await q("select from pg_roles where rolname=$1", [role])).rowCount) await q("create role " + role);
    }
    await q(`
      create type property_status as enum ('rascunho','pendente','em_analise','correcao','aprovado','publicado','em_negociacao','vendido','historico','suspenso','inativo','reprovado');
      create type property_type as enum ('urbano','rural');
      create type lead_status as enum ('novo','em_oportunidade','descartado');
      create type responsible_type as enum ('arini','parceiro','proprietario');
      create table profiles(user_id uuid primary key, role text, nome text default '', setores text[] default '{}', ativo boolean default true,
        rodizio_leads boolean not null default false, rodizio_ultimo_em timestamptz);
      create table municipalities(id uuid primary key default gen_random_uuid(), nome text, uf text);
      create table properties(id uuid primary key default gen_random_uuid(), codigo text unique, tipo property_type, status property_status,
        municipality_id uuid references municipalities(id), regime_comercial text);
      create table leads(id uuid primary key default gen_random_uuid(), property_id uuid not null references properties(id), nome text not null,
        telefone text, email text, mensagem text, origem text not null default 'pagina', canal text, utm jsonb not null default '{}',
        status lead_status not null default 'novo', consentimento_lgpd boolean not null default false, created_at timestamptz not null default now());
      create sequence opp_seq;
      create table opportunities(id uuid primary key default gen_random_uuid(), codigo text default 'OP-'||nextval('opp_seq'),
        lead_id uuid references leads(id), property_id uuid not null references properties(id), etapa text default 'novo_lead',
        responsavel_tipo responsible_type default 'arini', regime_na_origem text, protecao_ate timestamptz, responsavel_user_id uuid,
        atribuida_em timestamptz, prazo_atendimento timestamptz, primeiro_atendimento_em timestamptz,
        rodizio_tentativas int not null default 0, created_at timestamptz default now());
      create table opportunity_events(id uuid primary key default gen_random_uuid(), opportunity_id uuid, tipo text, descricao text default '',
        autor uuid, created_at timestamptz default now());
      create table opportunity_atribuicoes(id uuid primary key default gen_random_uuid(), opportunity_id uuid, user_id uuid,
        motivo text not null check (motivo in ('rodizio','sem_atendimento','manual','assumiu')), autor uuid, created_at timestamptz not null default now());
      create table audit_log(user_id uuid, acao text, entidade text, entidade_id uuid, property_id uuid, opportunity_id uuid, dados_antes jsonb, dados_depois jsonb);
      create table settings(chave text primary key, valor jsonb not null, updated_at timestamptz default now());
      create function fn_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;`);
    const sql = await readFile(new URL("../supabase/migrations/0147_crm_comercial_completo.sql", import.meta.url), "utf8");
    await q(sql);
    await q(sql); // idempotente

    const mun = (await uma("insert into municipalities(nome,uf) values ('Iturama','MG') returning id")).id;
    await q("insert into properties(codigo,tipo,status,municipality_id,regime_comercial) values ('AIB-1','rural','publicado',$1,'EXCLUSIVO_ARINI'),('AIB-2','urbano','vendido',null,'EXCLUSIVO_ARINI')", [mun]);
    await q(`insert into profiles(user_id,role,nome,setores) values ($1,'analista_arini','Ana','{comercial}'),($2,'analista_arini','Bia','{comercial}'),($3,'admin_central','Dir','{}')`, [ana, bia, dir]);

    // fila vazia: vai para o Comercial, um de cada vez
    const r1 = await lead("Cliente X", "(34) 99999-0000");
    assert.ok([ana, bia].includes(r1.responsavel));
    // carteira: mesmo telefone em outro formato volta para quem atende
    const r2 = await lead("Cliente X", "34999990000");
    assert.equal(r2.responsavel, r1.responsavel);
    // outro cliente: a outra pessoa da equipe
    const r3 = await lead("Cliente Y", "11888887777");
    assert.notEqual(r3.responsavel, r1.responsavel);

    // com fila: Bia só urbano, imóvel rural → ninguém (a fila existe, não cai no Comercial)
    await q("update profiles set rodizio_leads=true, rodizio_tipos='{urbano}' where user_id=$1", [bia]);
    assert.equal((await lead("Cliente Z", "11777776666")).responsavel, null);
    await q("update profiles set rodizio_tipos='{}', rodizio_pausa_ate=now()+interval '2 days' where user_id=$1", [bia]);
    assert.equal((await lead("Cliente P", "11777775555")).responsavel, null, "pausado não recebe");
    // limite: o que ela já recebeu hoje + 1
    await q(`update profiles set rodizio_pausa_ate=null, rodizio_limite_dia=1+(select count(*) from opportunity_atribuicoes where user_id=$1) where user_id=$1`, [bia]);
    assert.equal((await lead("Cliente W", "11666665555")).responsavel, bia);
    assert.equal((await lead("Cliente V", "11666664444")).responsavel, null, "limite diário");

    // responsável escolhido: fica com ela, já atendido
    const r6 = await lead("Cliente K", "11555554444", { resp: ana, rodizio: false });
    assert.equal(r6.responsavel, ana);
    const o6 = await uma("select primeiro_atendimento_em from opportunities where id=$1", [r6.id]);
    assert.ok(o6.primeiro_atendimento_em);

    // imóvel vendido não recebe interessado
    await assert.rejects(lead("A", "1199", { codigo: "AIB-2" }), /não aceita/);

    const motivos = (await q("select motivo, count(*)::int n from opportunity_atribuicoes group by 1")).rows;
    assert.ok(motivos.some((m) => m.motivo === "carteira"));
    assert.ok(motivos.some((m) => m.motivo === "equipe"));

    // prazo do primeiro contato só no expediente (08:00 às 18:00, sábado sim, domingo não)
    const prazo = async (ini, min) => (await uma(
      "select to_char(fn_crm_prazo_expediente($1::timestamptz,$2) at time zone 'America/Sao_Paulo','YYYY-MM-DD HH24:MI') p", [ini, min])).p;
    assert.equal(await prazo("2026-11-17 10:00-03", 30), "2026-11-17 10:30");
    assert.equal(await prazo("2026-11-17 22:00-03", 30), "2026-11-18 08:30");
    assert.equal(await prazo("2026-11-17 17:50-03", 30), "2026-11-18 08:20");
    assert.equal(await prazo("2026-11-21 19:00-03", 30), "2026-11-23 08:30");

    // catálogos semeados
    assert.ok((await uma("select count(*)::int n from crm_motivos_perda")).n >= 5);
    assert.ok((await uma("select count(*)::int n from crm_modelos_mensagem")).n >= 5);
  } finally {
    await pool.end();
    await admin.query("drop database " + nome + " with (force)");
    await admin.end();
  }
});
