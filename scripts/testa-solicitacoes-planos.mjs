// Rotas e catálogo reais. TEST_PLANOS_PG_URL aponta exclusivamente para um banco
// local vazio e descartável; o teste transacional sempre desfaz sua fixture.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { compileFunction } from "node:vm";
import ts from "typescript";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const raiz = new URL("../", import.meta.url);
function carregar(arq, deps = {}) {
  const js = ts.transpileModule(readFileSync(new URL("src/" + arq + ".ts", raiz), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modulo = {};
  compileFunction(js, ["require", "exports"])(id => {
    if (id === "server-only") return {};
    assert.ok(Object.hasOwn(deps, id), "Dependência inesperada: " + id);
    return deps[id];
  }, modulo);
  return modulo;
}
const catalogo = carregar("lib/planos-catalogo");
const status = carregar("lib/solicitacoes-planos");
const dono = randomUUID(), outro = randomUUID(), chave = randomUUID();
const selecao = { planoId: "proprietario_monitoramento", ciclo: "mensal", adicionais: [] };
const req = (metodo, body, query = "") => new Request("https://local.invalid/api/planos/solicitacoes" + query, {
  method: metodo, headers: { "Idempotency-Key": chave, "content-type": "application/json" },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
function rotas(ator, fetch) {
  const admin = createClient("https://teste.invalid", "teste-local", { global: { fetch }, auth: { persistSession: false } });
  const deps = {
    "@/lib/authz": { ator: async () => ator, temSetor: (a, ...setores) => !!a?.ehArini && a.setores.some(s => setores.includes(s)) },
    "@/lib/supabase/admin": { supabaseAdmin: () => admin }, "@/lib/planos-catalogo": catalogo, "@/lib/solicitacoes-planos": status,
    "@/lib/seguranca/limite": { limitar: async () => ({ permitido: true }) },
  };
  deps["@/lib/solicitacoes-planos-servidor"] = carregar("lib/solicitacoes-planos-servidor", deps);
  return {
    publico: carregar("app/api/planos/solicitacoes/route", deps),
    central: carregar("app/api/admin/planos/solicitacoes/route", deps),
  };
}
test("o servidor ignora preço, identidade, status e e-mail forjados e registra a estimativa do catálogo", async () => {
  let enviada;
  const precoVigente = {id: selecao.planoId, preco_mensal: 45.67, preco_anual_centavos: 45678, primeiro_mes_centavos: 1234};
  const { publico } = rotas({ userId: dono }, async (url, init) => {
    if (new URL(url).pathname.endsWith("/plans")) return Response.json([precoVigente]);
    assert.match(new URL(url).pathname, /rpc\/fn_solicitar_plano$/);
    enviada = JSON.parse(init.body);
    return Response.json({ id: randomUUID(), status: "pendente", cotacao: enviada.p_cotacao });
  });
  const r = await publico.POST(req("POST", { ...selecao, user_id: outro, status: "concluido", email_contato: "falso",
    cotacao: { totalCentavos: 1 }, totalCentavos: 1 }));
  assert.equal(r.status, 200);
  const oferta = catalogo.comPrecoVigente(catalogo.PLANOS_CATALOGO.find(p=>p.id===selecao.planoId),precoVigente);
  assert.deepEqual(enviada, { p_user_id: dono, p_chave: chave, p_selecao: selecao, p_cotacao: catalogo.cotarPlano(selecao,[oferta]) });
  const cotado = (await r.json()).solicitacao.cotacao;
  assert.equal(cotado.totalCentavos,1234);
  assert.equal(cotado.mensalRecorrenteCentavos,4567);
  const orcado = await publico.POST(req("POST", { ...selecao, areaTotalHa: 1001 }));
  assert.equal((await orcado.json()).solicitacao.cotacao.totalCentavos, null);
});
test("endpoints barram sessão inválida, acesso setorial indevido, payload excessivo e avanço pelo solicitante", async () => {
  let chamadas = 0;
  for (const a of [null, { userId: dono, ehArini: false, setores: ["financeiro"] }, { userId: dono, ehArini: true, setores: ["marketing"] }]) {
    const { publico, central } = rotas(a, async () => { chamadas++; throw Error("não deveria acessar o banco"); });
    assert.equal((await central.GET(req("GET"))).status, a ? 403 : 401);
    assert.equal((await central.PATCH(req("PATCH", { id: outro, status: "em_analise" }))).status, a ? 403 : 401);
    assert.equal((await publico.GET(req("GET", undefined, "?pagina=0"))).status, a ? 400 : 401);
    assert.equal((await publico.PATCH(req("PATCH", { id: outro, status: "concluido" }))).status, a ? 400 : 401);
    assert.equal((await publico.POST(req("POST", { ...selecao, extras: "a".repeat(10000) }))).status, a ? 400 : 401);
    assert.equal((await publico.POST(req("POST", { ...selecao, adicionais: [{ id: "drone", quantidade: 1 }] }))).status, a ? 400 : 401);
  }
  assert.equal(chamadas, 0);
});
test("histórico ignora o titular injetado; Financeiro pode listar com filtro", async () => {
  let params;
  const { publico, central } = rotas({ userId: dono, ehArini: true, setores: ["financeiro"] }, async url => {
    params = new URL(url).searchParams;
    return Response.json([]);
  });
  assert.equal((await publico.GET(req("GET", undefined, "?user_id=" + outro))).status, 200);
  assert.equal(params.get("user_id"), "eq." + dono);
  assert.doesNotMatch(params.get("select"), /email|telefone/);
  assert.equal((await central.GET(req("GET", undefined, "?status=pendente"))).status, 200);
  assert.equal(params.get("user_id"), null);
  assert.equal(params.get("status"), "eq.pendente");
  assert.match(params.get("select"), /email_contato/);
});

const local = process.env.TEST_PLANOS_PG_URL;
test("Postgres: privilégios, retry, auditoria única, conflito, cancelamento, conclusão e exclusão do titular", { skip: !local }, async () => {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(local).hostname));
  const db = new pg.Client({ connectionString: local });
  await db.connect();
  try {
    await db.query("begin");
    await db.query(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create table public.profiles(user_id uuid primary key references auth.users(id) on delete cascade, ativo boolean default true, role text default 'comprador', setores text[] default '{}');
      create table public.audit_log(user_id uuid, acao text, entidade text, entidade_id uuid, dados_antes jsonb, dados_depois jsonb);`);
    await db.query(readFileSync(new URL("supabase/migrations/0075_solicitacoes_planos.sql", raiz), "utf8"));
    const fin = randomUUID(), marketing = randomUUID(), diretoria = randomUUID();
    for (const [id, role, setores] of [[dono,"comprador",[]],[outro,"comprador",[]],[fin,"analista_arini",["financeiro"]],[marketing,"analista_arini",["marketing"]],[diretoria,"admin_central",[]]]) {
      await db.query("insert into auth.users values ($1,'titular@teste.invalid')", [id]);
      await db.query("insert into public.profiles(user_id,role,setores) values ($1,$2,$3)", [id,role,setores]);
    }
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const rejeita = async (executar, code) => {
      await db.query("savepoint caso"); await assert.rejects(executar, e => e.code === code); await db.query("rollback to caso");
    };
    const pedir = (id, key, s, v) => one("select * from public.fn_solicitar_plano($1,$2,$3,$4)", [id,key,s,{ totalCentavos: v }]);
    const mudar = (uid, id, s, central) => one("select * from public.fn_atualizar_solicitacao_plano($1,$2,$3,$4)", [uid,id,s,central]);
    await db.query("set local role authenticated");
    await rejeita(() => pedir(dono,chave,selecao,1), "42501");
    await rejeita(() => one("select * from public.solicitacoes_planos"), "42501");
    await db.query("set local role service_role");
    const p = await pedir(dono,chave,selecao,4900);
    assert.equal(p.email_contato,"titular@teste.invalid");
    const replay = await pedir(dono,chave,selecao,9900);
    assert.equal(replay.id,p.id); assert.equal(replay.cotacao.totalCentavos,4900);
    await rejeita(() => pedir(dono,chave,{...selecao,ciclo:"anual"},9900),"23505");
    await rejeita(() => mudar(outro,p.id,"cancelado",false),"P0002");
    await rejeita(() => mudar(marketing,p.id,"em_analise",true),"42501");
    await rejeita(() => mudar(dono,p.id,"concluido",false),"22023");
    await rejeita(() => mudar(fin,p.id,"concluido",true),"55000");
    await mudar(fin,p.id,"em_analise",true); await mudar(fin,p.id,"em_analise",true);
    await mudar(dono,p.id,"cancelado",false);
    await rejeita(() => mudar(diretoria,p.id,"concluido",true),"55000");
    assert.equal((await pedir(dono,chave,selecao,4900)).status,"cancelado");
    const novo = await pedir(dono,randomUUID(),selecao,4900); assert.notEqual(novo.id,p.id);
    await mudar(diretoria,novo.id,"em_analise",true); await mudar(fin,novo.id,"concluido",true);
    await rejeita(() => mudar(dono,novo.id,"cancelado",false),"55000");
    await db.query("reset role");
    assert.equal((await one("select count(*)::int n from public.audit_log where entidade_id=$1",[p.id])).n,3);
    await db.query("delete from auth.users where id=$1", [dono]);
    assert.equal((await one("select count(*)::int n from public.solicitacoes_planos")).n,0);
  } finally { await db.query("rollback"); await db.end(); }
});
