// node --test scripts/testa-financeiro.mjs — rotas e módulos reais com transporte em memória.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
function carregar(arquivo, modulos = {}, ambiente = {}) {
  const fonte = readFileSync(new URL("../src/" + arquivo, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(fonte, { fileName: arquivo, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const modulo = { exports: {} };
  const importar = (id) => {
    if (id === "server-only") return {};
    if (Object.hasOwn(modulos, id)) return modulos[id];
    if (["react/jsx-runtime", "lucide-react"].includes(id)) return require(id);
    throw new Error("Dependência sem simulação: " + id);
  };
  compileFunction(outputText, ["require", "module", "exports", ...Object.keys(ambiente)])(
    importar, modulo, modulo.exports, ...Object.values(ambiente));
  return modulo.exports;
}

const json = (dado, status = 200, headers = {}) =>
  new Response(JSON.stringify(dado), { status, headers: { "Content-Type": "application/json", ...headers } });
const cliente = (fetch) => createClient("https://teste.invalid", "teste-local", {
  global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const erro = () => json({ message: "Falha simulada", code: "TEST" }, 503);
const lotes = carregar("lib/supabase/lotes.ts");
const exibicao = { Indicadores: "Indicadores", CabecalhoSetor: "Cabecalho", Secao: "Secao", LinkAcao: "Link", TarefasDoSetor: "Tarefas", dataBR: () => "" };
function modulosFinanceiros(admin) {
  return {
    "@/lib/supabase/admin": { supabaseAdmin: () => admin }, "@/lib/supabase/lotes": lotes,
    "@/lib/authz": { ator: async () => ({ userId: "teste" }), temSetor: () => true },
    "@/lib/audit": { logAudit: async () => {} }, "next/server": { NextResponse: Response },
    "@/components/admin/Painel": exibicao, "@/components/admin/estilos": {},
    "@/components/ui/Pagina": { CabecalhoPagina: "Cabecalho", Vazio: "Vazio" }, "next/link": "Link",
    "@/lib/setores-servidor": { exigirSetor: async () => ({ id: "teste" }) },
    "@/lib/format": { formatBRL: (v) => String(v), plural: (v) => String(v) },
  };
}
function indicadores(no) {
  if (no?.type === "Indicadores") return Object.fromEntries(no.props.itens.map((i) => [i.rotulo, i]));
  for (const filho of [no?.props?.children].flat()) {
    if (filho && typeof filho === "object") {
      const achado = indicadores(filho);
      if (achado) return achado;
    }
  }
}

test("CSV percorre 2.005 lançamentos, ordena empates e recusa página incompleta", async () => {
  let falhar = false;
  const offsets = [];
  const admin = cliente(async (url) => {
    const p = new URL(url).searchParams;
    const de = Number(p.get("offset") || 0);
    offsets.push(de);
    assert.equal(p.get("order"), "data.asc,id.asc");
    assert.equal(p.get("limit"), "1000");
    if (falhar && de === 1000) return erro();
    return json(Array.from({ length: Math.min(1000, 2005 - de) }, (_, i) => ({
      data: "2026-01-15", historico: "Registro " + (de + i), valor: 2.5, natureza: "entrada",
    })));
  });
  const { GET } = carregar("app/api/admin/financeiro/contabil/route.ts", modulosFinanceiros(admin));
  const pedido = new Request("https://teste.invalid/contabil?de=2026-01-01&ate=2026-01-31");
  const resposta = await GET(pedido);
  const linhas = (await resposta.text()).split("\r\n");
  assert.deepEqual(offsets, [0, 1000, 2000]);
  assert.equal(linhas.length, 2006);
  assert.match(linhas.at(-1), /"Registro 2004"/);
  falhar = true;
  assert.equal((await GET(pedido)).status, 503);
});

test("indicadores incluem despesas além das primeiras 20 e lançamentos além da primeira página", async () => {
  const admin = cliente(async (url, init) => {
    const { pathname, searchParams: p } = new URL(url);
    const tabela = pathname.split("/").at(-1);
    const offset = Number(p.get("offset") || 0);
    if (init.method === "HEAD") {
      assert.equal(tabela, "despesas");
      assert.equal(p.get("status"), "eq.pendente");
      assert.match(new Headers(init.headers).get("prefer"), /count=exact/);
      return new Response(null, { headers: { "content-range": "0-0/57" } });
    }
    if (tabela === "fn_resultado_mensal" || tabela === "fn_financeiro_mensal" || tabela === "despesas") return json([]);
    if (tabela === "invoices" && p.get("limit") === "40") return json([]);
    if (tabela === "notas_fiscais") {
      assert.equal(p.get("status"), "eq.emitida");
      assert.ok(p.has("emitida_em"));
    }
    assert.equal(p.get("limit"), "1000");
    const n = Math.min(1000, 1011 - offset);
    return json(Array.from({ length: n }, (_, i) => ({
      id: offset + i, valor: 2, valor_mensal: 3, centro: { nome: "Operação" },
    })));
  });
  const deps = modulosFinanceiros(admin);
  const dre = indicadores(await carregar("app/admin/financeiro/resultado/page.tsx", deps).default());
  assert.equal(dre["Aguardando aprovação"].valor, 57);
  assert.equal(dre["Notas emitidas no mês"].valor, 1011);
  assert.equal(dre["Notas emitidas no mês"].nota, "2022");
  const painel = indicadores(await carregar("app/admin/financeiro/page.tsx", deps).default());
  assert.equal(painel["Faturas vencidas"].valor, 1011);
  assert.equal(painel["Comissões a receber"].valor, "2022");
  assert.equal(painel["Mensalidade recorrente"].valor, "3033");
});

function prepararEmissao({ perderResposta = false, perderGravacao = false, semNota = false } = {}) {
  const registro = { id: "ac6f2802-bef9-41b6-9e3f-831251075eaa", status: "rascunho", updated_at: "2026-01-01T00:00:00Z", gateway_id: null };
  const nota = { id: "inv_teste", externalReference: registro.id, status: "AUTHORIZED" };
  let pedidos = 0;
  let versao = 0;
  const admin = cliente(async (url, init) => {
    const p = new URL(url).searchParams;
    for (const [campo, filtro] of p) {
      if (filtro.startsWith("in.(") && !filtro.slice(4, -1).split(",").includes(registro[campo])) return json([]);
      if (filtro.startsWith("eq.") && filtro.slice(3) !== String(registro[campo])) return json([]);
      if (filtro === "is.null" && registro[campo] !== null) return json([]);
    }
    if (init.method === "PATCH") {
      const mudanca = JSON.parse(init.body);
      if (perderGravacao && mudanca.gateway_id) return erro();
      Object.assign(registro, mudanca, { updated_at: new Date(Date.now() + ++versao).toISOString() });
    }
    return json([registro]);
  });
  const env = { ASAAS_API_KEY: "simulado", ASAAS_BASE_URL: "https://fiscal.invalid" };
  const asaas = carregar("lib/asaas.ts", {}, { process: { env }, fetch: async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/customers") return json({ data: [{ id: "cus_teste" }] });
    if (pathname === "/invoices" && init.method === "GET") {
      assert.equal(searchParams.get("externalReference"), registro.id);
      return json({ data: semNota ? [] : [nota] });
    }
    if (pathname === "/invoices" && init.method === "POST") {
      pedidos++;
      assert.equal(JSON.parse(init.body).externalReference, registro.id);
      if (perderResposta) throw new Error("resposta simulada perdida");
      return json(nota);
    }
    if (pathname === "/invoices/inv_teste/authorize" || pathname === "/invoices/inv_teste") return json(nota);
    if (pathname === "/invoices/outra") return json({ ...nota, externalReference: "outra" });
    throw new Error("Chamada inesperada no ensaio " + pathname);
  } });
  const registros = carregar("lib/registros-servidor.ts", { "@/lib/supabase/admin": {}, "@/lib/authz": {} });
  carregar("lib/modulos/financeiro.ts", {
    "@/lib/registros-servidor": registros, "@/lib/asaas": asaas, "@/lib/authz": {}, "@/lib/central": {},
    "@/lib/settings": { lerConfiguracoes: async () => ({}), numero: (_s, _k, padrao) => padrao, texto: (_s, _k, padrao) => padrao },
  });
  const executar = (acao, motivo = "") => registros.executorDe("notas-fiscais", acao)({
    admin, id: registro.id, linha: { ...registro }, motivo,
  });
  return { executar, registro, admin, pedidos: () => pedidos };
}

test("dois emissores simultâneos geram uma única chamada fiscal", async () => {
  const s = prepararEmissao();
  const resultado = await Promise.allSettled([s.executar("emitir"), s.executar("emitir")]);
  assert.equal(resultado.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(s.pedidos(), 1);
  assert.equal(s.registro.status, "emitida");
  await assert.rejects(s.executar("emitir"));
  assert.equal(s.pedidos(), 1);
});

test("timeout fiscal exige conferência e o vínculo aceita apenas a referência da própria nota", async () => {
  const s = prepararEmissao({ perderResposta: true });
  await s.executar("emitir");
  assert.equal(s.registro.status, "conferir");
  await assert.rejects(s.executar("emitir"));
  await assert.rejects(s.executar("vincular", "outra"));
  assert.equal((await s.executar("vincular", "inv_teste")).gateway_id, "inv_teste");
  await assert.rejects(s.executar("confirmar_ausencia", "Busca realizada no Asaas"));
  assert.equal(s.pedidos(), 1);
});

test("ausência confirmada pelo operador e pelo Asaas permite voltar ao rascunho", async () => {
  const s = prepararEmissao({ perderResposta: true, semNota: true });
  await s.executar("emitir");
  assert.equal((await s.executar("confirmar_ausencia", "Busca realizada no Asaas")).status, "rascunho");
  assert.equal(s.pedidos(), 1);
});

test("falha ao persistir a resposta mantém a reserva até a conciliação", async () => {
  const s = prepararEmissao({ perderGravacao: true });
  await assert.rejects(s.executar("emitir"));
  assert.equal(s.registro.status, "emitindo");
  await assert.rejects(s.executar("emitir"));
  await assert.rejects(s.executar("confirmar_ausencia", "conferido"));
  s.registro.updated_at = "2026-01-01T00:00:00Z";
  assert.equal((await s.executar("vincular", "inv_teste")).gateway_id, "inv_teste");
  assert.equal(s.pedidos(), 1);
});

test("webhook autenticado concilia pela referência mesmo após perda da resposta", async () => {
  const s = prepararEmissao({ perderResposta: true });
  await s.executar("emitir");
  const deps = modulosFinanceiros(s.admin);
  const financeiro = carregar("lib/modulos/financeiro.ts", {
    "@/lib/registros-servidor": { registrarAcoes: () => {}, registrarAntesCriar: () => {} },
    "@/lib/authz": {}, "@/lib/settings": {}, "@/lib/central": {}, "@/lib/asaas": {},
  });
  const modulo = carregar("app/api/asaas/webhook/route.ts", {
    ...deps, "node:crypto": require("node:crypto"), "@/lib/modulos/financeiro": financeiro,
  }, { process: { env: { ASAAS_WEBHOOK_TOKEN: "segredo-sintetico" } } });
  const enviar = (status) => modulo.POST(new Request("https://teste.invalid/webhook", {
    method: "POST", headers: { "asaas-access-token": "segredo-sintetico" },
    body: JSON.stringify({ event: "INVOICE_" + status, invoice: { id: "inv_teste", status, externalReference: s.registro.id } }),
  }));
  assert.equal((await enviar("AUTHORIZED")).status, 200);
  assert.equal(s.registro.status, "emitida");
  assert.equal(s.registro.gateway_id, "inv_teste");
  assert.equal((await enviar("SCHEDULED")).status, 200);
  assert.equal(s.registro.status, "emitida");
  assert.equal(s.pedidos(), 1);
});
