import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync } from "node:fs";
import { dentroDoHorario, prazoNoHorario, validarHorario } from "../src/lib/atendimento-horario.ts";

// Datas em Brasília (UTC-3)
const br = (s) => new Date(s + "-03:00");
const fin = { setor: "financeiro", dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "17:00", prazo_minutos: 30, mensagem_fora: "" };

test("horário do setor: dentro/fora e prazo contando só o expediente", () => {
  assert.equal(dentroDoHorario(fin, br("2026-11-24T10:00:00")), true); // terça
  assert.equal(dentroDoHorario(fin, br("2026-11-24T17:00:00")), false);
  assert.equal(dentroDoHorario(fin, br("2026-11-29T10:00:00")), false); // domingo
  // terça 16h50 + 30 min → quarta 8h20
  assert.equal(prazoNoHorario(fin, br("2026-11-24T16:50:00"), 30).toISOString(), br("2026-11-25T08:20:00").toISOString());
  // sexta 22h + 30 min → segunda 8h30
  assert.equal(prazoNoHorario(fin, br("2026-11-27T22:00:00"), 30).toISOString(), br("2026-11-30T08:30:00").toISOString());
  // antes de abrir: sábado conta se o setor atende sábado
  assert.equal(prazoNoHorario({ ...fin, dias: [6] }, br("2026-11-28T07:00:00"), 15).toISOString(), br("2026-11-28T08:15:00").toISOString());
});

test("validação do formulário da Diretoria", () => {
  assert.equal(validarHorario(fin), null);
  assert.match(validarHorario({ ...fin, dias: [] }), /dia/);
  assert.match(validarHorario({ ...fin, fim: "07:00" }), /depois/);
  assert.match(validarHorario({ ...fin, prazo_minutos: 2 }), /Prazo/);
  assert.match(validarHorario({ ...fin, inicio: "8h" }), /HH:MM/);
});

const url = process.env.ARINI_TESTE_CARTEIRA_DB;
test("SQL 0171: fn_atendimento_prazo bate com o cálculo da tela e cai no expediente geral", { skip: !url }, async () => {
  const servidor = new pg.Client({ connectionString: url }); await servidor.connect();
  const nome = "t_horario_" + Date.now();
  await servidor.query("create database " + nome);
  const db = new pg.Client({ connectionString: url.replace(/\/[^/]*$/, "/" + nome) }); await db.connect();
  try {
    await db.query(`do $$begin create role authenticated; exception when duplicate_object then null; end$$;
      do $$begin create role anon; exception when duplicate_object then null; end$$;
      do $$begin create role service_role; exception when duplicate_object then null; end$$;
      create table settings(chave text primary key, valor jsonb not null, updated_at timestamptz default now());
      create function fn_role() returns text language sql as $f$select 'admin_central'$f$;
      create table profiles(user_id uuid primary key);
      create table atendimento_conversas(id uuid primary key default gen_random_uuid(), codigo text, nome text, telefone text, setor text, responsavel uuid,
        status text, ultima_entrada_em timestamptz, ultima_saida_em timestamptz, canal text not null default 'whatsapp', ari_ativa_em timestamptz);
      create table tasks(chave text primary key, setor text, titulo text);
      create function fn_tarefa_automatica(p_chave text,p_regra text,p_setor text,p_titulo text,p_descricao text,p_resp uuid,p_prazo date,p_prio text)
        returns uuid language plpgsql as $f$begin insert into tasks values(p_chave,p_setor,p_titulo) on conflict do nothing; if found then return gen_random_uuid(); end if; return null; end$f$;`);
    const m147 = readFileSync("supabase/migrations/0147_crm_comercial_completo.sql", "utf8");
    const a = m147.indexOf("create or replace function public.fn_crm_prazo_expediente"), b = m147.indexOf("revoke execute on function public.fn_crm_prazo_expediente");
    await db.query(m147.slice(a, b));
    await db.query(readFileSync("supabase/migrations/0171_atendimento_horarios_canais.sql", "utf8"));
    await db.query(readFileSync("supabase/migrations/0171_atendimento_horarios_canais.sql", "utf8")); // idempotente
    await db.query("insert into atendimento_setores_horario(setor,dias,inicio,fim,prazo_minutos) values('financeiro','{1,2,3,4,5}','08:00','17:00',30)");
    const prazo = async (setor, ini, min) => (await db.query("select fn_atendimento_prazo($1,$2,$3) p", [setor, ini, min])).rows[0].p.toISOString();
    assert.equal(await prazo("financeiro", br("2026-11-24T16:50:00"), 30), prazoNoHorario(fin, br("2026-11-24T16:50:00"), 30).toISOString());
    assert.equal(await prazo("financeiro", br("2026-11-27T22:00:00"), 30), br("2026-11-30T08:30:00").toISOString());
    // comercial sem linha: expediente geral 8h–18h com sábado
    assert.equal(await prazo("comercial", br("2026-11-24T17:50:00"), 30), br("2026-11-25T08:20:00").toISOString());
    // regra: conversa do Financeiro passou do prazo vira tarefa uma vez; canal do site no título
    await db.query("insert into atendimento_conversas(codigo,nome,telefone,setor,status,ultima_entrada_em) values('AT-1','','site:abc','financeiro','aberta',now()-interval '2 days')");
    const n1 = (await db.query("select fn_atendimento_regras() n")).rows[0].n;
    const n2 = (await db.query("select fn_atendimento_regras() n")).rows[0].n;
    assert.equal(n1, 1); assert.equal(n2, 0);
    assert.match((await db.query("select titulo from tasks")).rows[0].titulo, /chat do site/);
    await assert.rejects(db.query("update atendimento_conversas set canal='fax'"), (e) => e.code === "23514");
    await db.query("update atendimento_conversas set canal='telegram'");
    await assert.rejects(db.query("insert into atendimento_setores_horario(setor,fim,inicio) values('comercial','08:00','18:00')"), (e) => e.code === "23514");
  } finally { await db.end(); await servidor.query("drop database " + nome + " with (force)"); await servidor.end(); }
});
