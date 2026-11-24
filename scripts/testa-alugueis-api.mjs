// Exercita o handler real com persistência em memória e conflitos controlados.
// Não lê .env, não cobra clientes e não altera o banco de produção.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import ts from "typescript";

const ID = "00000000-0000-4000-8000-000000000001";
const CONTRATO = "00000000-0000-4000-8000-000000000002";
const js = ts.transpileModule(readFileSync(new URL("../src/app/api/admin/financeiro/alugueis/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function ambiente({ setor = "financeiro", parcela = {}, conflito = false, contratoErro = false } = {}) {
  const estado = { id: ID, contrato_id: CONTRATO, valor: 1000, status: "pendente", vencimento: "2026-11-10", repasse_status: "pendente", updated_at: "2026-11-01T12:00:00Z", ...parcela };
  const auditoria = [];
  const gravacoes = [];
  const db = { from(tabela) {
    let mudanca;
    const filtros = [];
    const executar = () => {
      if (tabela === "contratos_locacao") return contratoErro ? { data: null, error: { message: "indisponível" } } : { data: { taxa_administracao: 10, dias_repasse: 5 }, error: null };
      assert.equal(tabela, "alugueis_parcelas");
      if (!mudanca) return { data: structuredClone(estado), error: null };
      if (conflito || filtros.some(([k,v]) => estado[k] !== v)) return { data: null, error: null };
      gravacoes.push(structuredClone(mudanca)); Object.assign(estado, mudanca);
      return { data: { id: ID }, error: null };
    };
    const q = {
      select() { return q; }, eq(k,v) { filtros.push([k,v]); return q; },
      update(m) { mudanca = m; return q; },
      maybeSingle: async () => executar(), single: async () => executar(),
      then(resolve,reject) { return Promise.resolve().then(executar).then(resolve,reject); },
    };
    return q;
  } };
  const deps = {
    "next/server": { NextResponse: Response },
    "@/lib/supabase/admin": { supabaseAdmin: () => db },
    "@/lib/authz": { ator: async () => ({ userId: ID, setor }), temSetor: (a,...ss) => ss.includes(a.setor) },
    "@/lib/audit": { logAudit: async e => auditoria.push(e) },
  };
  const mod = {};
  compileFunction(js,["require","exports"])(id => { assert.ok(Object.hasOwn(deps,id)); return deps[id]; },mod);
  return { estado, auditoria, gravacoes, post: body => mod.POST(new Request("https://local.invalid/api/admin/financeiro/alugueis", { method: "POST", body: JSON.stringify({ id: ID, ...body }) })) };
}

test("Financeiro: recebimento, taxa, repasse e estorno pelo handler real", async () => {
  const a = ambiente();
  assert.equal((await a.post({ acao:"pagar", valor:1000, data:"2026-11-20" })).status,200);
  assert.equal(a.estado.valor_repasse,900); assert.equal(a.estado.repasse_vencimento,"2026-11-25");
  assert.equal((await a.post({ acao:"repassar", data:"2026-11-25" })).status,200);
  assert.equal((await a.post({ acao:"desfazer_pagamento" })).status,400);
  assert.equal((await a.post({ acao:"desfazer_repasse" })).status,200);
  assert.equal((await a.post({ acao:"desfazer_pagamento" })).status,200);
  assert.equal(a.estado.valor_pago,null); assert.equal(a.auditoria.length,4);
});

test("Comercial não altera aluguel e conflito de edição não vira sucesso/auditoria", async () => {
  const sem = ambiente({ setor:"comercial" });
  assert.equal((await sem.post({ acao:"pagar" })).status,403); assert.equal(sem.gravacoes.length,0);
  const corrida = ambiente({ conflito:true });
  assert.equal((await corrida.post({ acao:"pagar", data:"2026-11-20" })).status,409);
  assert.equal(corrida.auditoria.length,0); assert.equal(corrida.estado.status,"pendente");
});

test("Retenção não estorna silenciosamente um repasse já concluído", async () => {
  const a = ambiente({ parcela:{status:"pago",repasse_status:"repassado",repasse_em:"2026-11-20"} });
  assert.equal((await a.post({ acao:"reter", motivo:"Pendência documental" })).status,400);
  assert.equal(a.gravacoes.length,0); assert.equal(a.estado.repasse_status,"repassado");
  const semPagamento = ambiente();
  assert.equal((await semPagamento.post({ acao:"reter", motivo:"Pendência documental" })).status,400);
});

test("Falha ao consultar taxa do contrato impede receber com taxa zero", async () => {
  const a = ambiente({ contratoErro:true });
  assert.equal((await a.post({ acao:"pagar", data:"2026-11-20" })).status,503);
  assert.equal(a.gravacoes.length,0);
});

test("Datas inexistentes e inválidas não são aceitas nem substituídas por hoje", async () => {
  for (const data of ["2026-02-30","2026-13-20","ontem"]) {
    const a = ambiente();
    assert.equal((await a.post({ acao:"pagar", data })).status,400, data);
    assert.equal(a.gravacoes.length,0);
  }
});
