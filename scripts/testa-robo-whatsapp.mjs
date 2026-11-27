// Robô do WhatsApp de ponta a ponta, com banco em memória e envio simulado
// (pedido do Stenio, 26/11/2026: "o robô seguir tudo o que precisar de
// consulta do sistema com IA e encaminhar sozinho para o setor escolhido").
//
// Roda o código real de lib/atendimento.ts e lib/atendimento-ari.ts; só o
// banco, o envio pela Evolution e a resposta da IA são simulados.
// Uso: node --test scripts/testa-robo-whatsapp.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";

function carregar(arquivo, deps = {}) {
  const js = ts.transpileModule(readFileSync(new URL("../src/" + arquivo, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = {};
  compileFunction(js, ["require", "exports"])((id) => { assert.ok(Object.hasOwn(deps, id), "dependência não simulada: " + id); return deps[id]; }, m);
  return m;
}

/** Banco em memória com o pedaço do PostgREST que o atendimento usa. */
function bancoEmMemoria(tabelas) {
  const casa = (r, [op, k, v]) => {
    if (op === "eq") return r[k] === v;
    if (op === "in") return v.includes(r[k]);
    if (op === "ilike") { const re = new RegExp("^" + String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("%", ".*") + "$", "i"); return re.test(String(r[k] ?? "")); }
    if (op === "gte") return String(r[k] ?? "") >= String(v);
    if (op === "lte") return String(r[k] ?? "") <= String(v);
    if (op === "neq") return r[k] !== v;
    if (op === "not") return true;
    return true;
  };
  return {
    from(t) {
      tabelas[t] ??= [];
      let op = "select", dados, opcoes;
      const filtros = [];
      const exec = (um) => {
        let linhas = tabelas[t].filter((r) => filtros.every((f) => casa(r, f)));
        if (op === "insert") { const novas = (Array.isArray(dados) ? dados : [dados]).map((d) => ({ id: randomUUID(), ...(t === "atendimento_conversas" ? { etiquetas: [], status: "aberta" } : {}), ...d })); tabelas[t].push(...novas); linhas = novas; }
        if (op === "upsert") {
          const chave = opcoes?.onConflict;
          const existe = tabelas[t].find((r) => r[chave] === dados[chave]);
          if (!existe) tabelas[t].push({ id: randomUUID(), ...(t === "atendimento_conversas" ? { etiquetas: [], status: "aberta" } : {}), ...dados }); else if (!opcoes?.ignoreDuplicates) Object.assign(existe, dados);
          linhas = [];
        }
        if (op === "update") for (const r of linhas) Object.assign(r, dados);
        return { data: structuredClone(um ? linhas[0] ?? null : linhas), error: null };
      };
      const q = {
        select() { return q; }, eq(k, v) { filtros.push(["eq", k, v]); return q; }, in(k, v) { filtros.push(["in", k, v]); return q; },
        ilike(k, v) { filtros.push(["ilike", k, v]); return q; }, not() { return q; }, order() { return q; }, limit() { return q; },
        gte(k, v) { filtros.push(["gte", k, v]); return q; }, lte(k, v) { filtros.push(["lte", k, v]); return q; }, neq(k, v) { filtros.push(["neq", k, v]); return q; },
        is() { return q; }, or() { return q; }, range() { return q; }, gt() { return q; }, lt() { return q; },
        insert(v) { op = "insert"; dados = v; return q; }, update(v) { op = "update"; dados = v; return q; },
        upsert(v, o) { op = "upsert"; dados = v; opcoes = o; return q; },
        maybeSingle: async () => exec(true), single: async () => exec(true),
        then(ok, no) { return Promise.resolve().then(() => exec(false)).then(ok, no); },
      };
      return q;
    },
    rpc: async (fn, args) => {
      tabelas.__rpc ??= [];
      tabelas.__rpc.push({ fn, args });
      if (fn === "fn_crm_lead_manual") return { data: { id: randomUUID(), codigo: "NEG-0001", responsavel: "corretor-rodizio" }, error: null };
      return { data: null, error: null };
    },
  };
}

function montar({ ariLigadaNoMenu = true, respostaIa } = {}) {
  const agora = new Date().toISOString();
  const tabelas = {
    atendimento_conversas: [], whatsapp_mensagens: [], atendimento_eventos: [], atendimento_setores_horario: [],
    profiles: [
      { user_id: "dono-1", nome: "Proprietário Teste", role: "proprietario", telefone: "(34) 99999-1111" },
      { user_id: "recepcao-1", nome: "Recepção", role: "analista_arini", ativo: true, setores: ["comercial"], atendimento_recepcao: true },
      { user_id: "fin-1", nome: "Financeiro", role: "analista_arini", ativo: true, setores: ["financeiro"], atendimento_recepcao: false },
    ],
    settings: [{ chave: "rodizio_expediente_inicio", valor: "00:00" }, { chave: "rodizio_expediente_fim", valor: "23:59" }, { chave: "rodizio_domingo", valor: true }],
    atendimento_menu: [{
      id: 1, ativo: true, saudacao: "Olá{{nome}}! Sou o atendimento da ARINI. Escolha uma opção:", confirmacao: "Pronto! Você foi encaminhado para {{setor}}.",
      nao_entendi: "Não entendi. Responda com o número:", fora_expediente: "", max_tentativas: 3, setor_escape: null, expira_minutos: 60,
      reenviar_apos_horas: 12, ari_ativo: ariLigadaNoMenu, ari_limite_dia: 40,
    }],
    atendimento_menu_opcoes: [
      { id: "o1", ordem: 1, chave: "1", rotulo: "Quero comprar", setor: "comercial", responsavel: null, etiqueta: "compra", confirmacao: null, ativo: true, acao: "setor" },
      { id: "o2", ordem: 2, chave: "2", rotulo: "Quero anunciar", setor: "operacoes", responsavel: null, etiqueta: null, confirmacao: null, ativo: true, acao: "setor" },
      { id: "o3", ordem: 3, chave: "3", rotulo: "Financeiro", setor: "financeiro", responsavel: null, etiqueta: null, confirmacao: null, ativo: true, acao: "setor" },
      { id: "o4", ordem: 4, chave: "4", rotulo: "Jurídico", setor: "juridico", responsavel: null, etiqueta: null, confirmacao: null, ativo: true, acao: "setor" },
      { id: "o7", ordem: 7, chave: "7", rotulo: "Consultar imóveis à venda", setor: null, responsavel: null, etiqueta: null, confirmacao: null, ativo: true, acao: "ari" },
      { id: "o0", ordem: 8, chave: "0", rotulo: "Falar com a equipe de atendimento", setor: null, responsavel: null, etiqueta: null, confirmacao: null, ativo: true, acao: "setor" },
      { id: "o9", ordem: 9, chave: "9", rotulo: "Falar com a equipe de atendimento", setor: null, responsavel: null, etiqueta: null, confirmacao: null, ativo: true, acao: "setor" },
    ],
    properties: [], property_media: [],
  };
  const db = bancoEmMemoria(tabelas);
  const enviados = [], imagens = [], avisos = [], perguntasIa = [];
  const pendentes = [];
  const meta = {
    telefoneWhatsapp: (t) => { const d = String(t ?? "").replace(/\D/g, ""); return d.length >= 12 ? d : "55" + d; },
    enviarImagemWhatsapp: async (tel, url, legenda) => { imagens.push({ tel, url, legenda }); return "img-" + imagens.length; },
  };
  const metaMensagens = {
    canalDoContato: () => "whatsapp", contatoSocial: () => false,
    enviarPeloCanal: async (tel, texto) => { enviados.push({ tel, texto }); return "wa-" + enviados.length; },
  };
  const setores = carregar("lib/setores.ts");
  const rotulos = carregar("lib/atendimento-rotulos.ts", { "@/lib/setores": setores });
  const horario = carregar("lib/atendimento-horario.ts");
  const comum = { "server-only": {}, "@/lib/supabase/admin": { supabaseAdmin: () => db } };
  const ari = carregar("lib/atendimento-ari.ts", {
    ...comum,
    "@/lib/compartilhar": { urlDoSite: () => "https://arinibrasil.com.br" },
    "@/lib/format": { formatArea: (a) => `${a} ha`, formatBRL: (v) => `R$ ${v}` },
    "@/lib/ia/assistente": { responder: async (p) => { perguntasIa.push(p); return respostaIa ? respostaIa(p) : { texto: "Encontrei a *AIB-000123* em Iturama.", fontes: [{ tipo: "imovel", href: "/imovel/AIB-000123" }] }; } },
    "@/lib/ia/config": { iaConfigurada: () => true },
    "@/lib/imovel/vitrine": { STATUS_VITRINE: ["publicado"] },
    "@/lib/meta": meta, "@/lib/meta-mensagens": metaMensagens,
    "@/lib/settings": { lerConfiguracoes: async () => ({ ia_chat_ativo: true }) },
    "@/lib/vendidos": { fotoUrl: (p) => "https://exemplo/" + p },
  });
  const atendimento = carregar("lib/atendimento.ts", {
    ...comum,
    "@/lib/authz": { temSetor: () => true },
    "@/lib/meta": meta, "@/lib/meta-mensagens": metaMensagens,
    "@/lib/notificacoes": { notificar: async (...a) => { avisos.push(a); } },
    "next/server": { after: (fn) => { pendentes.push(fn()); } },
    "@/lib/atendimento-ari": ari, "@/lib/atendimento-rotulos": rotulos, "@/lib/atendimento-horario": horario,
  });
  let n = 0;
  async function recebe(telefone, texto, nome = "Cliente Teste", extra = {}) {
    const { data } = await db.from("whatsapp_mensagens").insert({ telefone, direcao: "entrada", texto, recebida_em: agora }).select("id").single();
    await atendimento.entradaAtendimento({ telefone, nome, texto, mensagemId: data.id, opp: null, canal: "principal", ...extra });
    await Promise.all(pendentes.splice(0));
    n++;
    return tabelas.atendimento_conversas.find((c) => c.telefone === telefone);
  }
  return { recebe, tabelas, enviados, imagens, avisos, perguntasIa, atendimento };
}

test("\"Oi\" recebe o menu; \"3\" encaminha sozinho ao Financeiro e confirma ao cliente", async () => {
  const s = montar();
  let c = await recebe(s, "5534988880001", "Oi");
  assert.match(s.enviados.at(-1).texto, /\*1\* - Quero comprar/);
  assert.match(s.enviados.at(-1).texto, /\*7\* - Consultar imóveis/);
  assert.equal(c.setor ?? null, null, "antes da escolha ninguém recebe a conversa");
  assert.equal(s.atendimento.naAutomatica(c), true, "fica na caixa Automático enquanto está no menu");
  c = await recebe(s, "5534988880001", "3");
  assert.equal(c.setor, "financeiro");
  assert.ok(c.menu_respondido_em);
  assert.match(s.enviados.at(-1).texto, /Financeiro/);
  assert.equal(s.atendimento.naAutomatica(c), false, "depois da escolha sai da caixa Automático e vai para a fila do setor");
  assert.ok(s.tabelas.atendimento_eventos.some((e) => e.para_setor === "financeiro" && e.acao === "menu"));
});

test("cada opção do menu cai no setor certo (Comercial, Operações, Financeiro, Jurídico)", async () => {
  const esperado = { 1: "comercial", 2: "operacoes", 3: "financeiro", 4: "juridico" };
  for (const [opcao, setor] of Object.entries(esperado)) {
    const s = montar();
    const tel = "553498888100" + opcao;
    await recebe(s, tel, "Boa tarde");
    const c = await recebe(s, tel, opcao);
    assert.equal(c.setor, setor, `opção ${opcao}`);
  }
});

test("resposta fora do menu pede de novo; \"opção 2\" e \"2.\" também valem", async () => {
  const s = montar();
  await recebe(s, "5534988880002", "Olá");
  let c = await recebe(s, "5534988880002", "não sei");
  assert.match(s.enviados.at(-1).texto, /Não entendi/);
  assert.equal(c.menu_tentativas, 1);
  c = await recebe(s, "5534988880002", "opção 2");
  assert.equal(c.setor, "operacoes");
  const s2 = montar();
  await recebe(s2, "5534988880003", "Olá");
  assert.equal((await recebe(s2, "5534988880003", "2.")).setor, "operacoes");
});

test("busca clara na 1ª mensagem vai direto para a Ari, que consulta o sistema e manda foto e link", async () => {
  const s = montar();
  s.tabelas.properties.push({ id: "p1", codigo: "AIB-000123", titulo: "Fazenda Boa Vista", tipo: "rural", valor: 3000000, area_declarada: 100, status: "publicado" });
  const c = await recebe(s, "5534988880004", "Tem fazenda de uns 100 ha em Iturama até 3 milhões?");
  assert.ok(c.ari_ativa_em, "Ari assumiu");
  assert.equal(s.perguntasIa.length, 1, "a IA recebeu a pergunta");
  assert.match(s.perguntasIa[0].instrucoesCanal, /WhatsApp/);
  assert.match(s.enviados.at(-1).texto, /AIB-000123/);
  assert.equal(c.ari_ultimo_imovel, "AIB-000123");
  assert.equal(c.setor ?? null, null, "busca de imóvel não vai para nenhum setor");
  assert.equal(s.atendimento.naAutomatica(c), true, "conversa da Ari fica na caixa Automático");
});

test("opção 7 do menu liga a Ari; \"quero visitar\" cria o lead no rodízio e passa ao Comercial", async () => {
  const s = montar();
  await recebe(s, "5534988880005", "Oi");
  let c = await recebe(s, "5534988880005", "7");
  assert.ok(c.ari_ativa_em);
  assert.match(s.enviados.at(-1).texto, /Me conte o que você procura|responda \*0\*/i);
  c = await recebe(s, "5534988880005", "chácara em União de Minas");
  assert.equal(s.perguntasIa.length, 1);
  c = await recebe(s, "5534988880005", "quero visitar");
  assert.equal(c.ari_ativa_em, null, "a Ari para");
  assert.equal(c.setor, "comercial");
  const lead = s.tabelas.__rpc.find((r) => r.fn === "fn_crm_lead_manual");
  assert.ok(lead, "lead criado");
  assert.equal(lead.args.p_codigo_imovel, "AIB-000123");
  assert.equal(lead.args.p_rodizio, true);
  assert.match(s.enviados.at(-1).texto, /corretor/);
});

test("\"0\" a qualquer momento na Ari leva a uma pessoa do Comercial", async () => {
  const s = montar({ respostaIa: () => ({ texto: "Posso ajudar a achar um imóvel.", fontes: [] }) });
  await recebe(s, "5534988880006", "procuro terreno em Iturama");
  const c = await recebe(s, "5534988880006", "0");
  assert.equal(c.setor, "comercial");
  assert.equal(c.ari_ativa_em, null);
  assert.ok(!s.tabelas.__rpc?.some((r) => r.fn === "fn_crm_lead_manual"), "sem imóvel citado, não cria lead às cegas");
});

test("se a IA falhar, a conversa não fica perdida: vai para o Comercial", async () => {
  const s = montar({ respostaIa: () => { throw new Error("provedor fora"); } });
  const c = await recebe(s, "5534988880007", "quero comprar uma fazenda");
  assert.equal(c.setor, "comercial");
  assert.match(s.enviados.at(-1).texto, /corretor/);
});

test("com a Ari desligada, a busca clara recebe o menu (não fica sem resposta)", async () => {
  const s = montar({ ariLigadaNoMenu: false });
  const c = await recebe(s, "5534988880008", "tem fazenda em Iturama?");
  assert.equal(c.ari_ativa_em ?? null, null);
  assert.match(s.enviados.at(-1).texto, /\*1\* - Quero comprar/);
});

test("proprietário reconhecido pelo telefone vai direto para Operações, sem menu", async () => {
  const s = montar();
  const c = await recebe(s, "5534999991111", "Bom dia, quero saber da minha fazenda");
  assert.equal(c.setor, "operacoes");
  assert.equal(s.enviados.length, 0, "não recebe menu");
});

test("\"menu\" na caixa central reenvia as opções", async () => {
  const s = montar();
  await recebe(s, "5534988880009", "Oi");
  await recebe(s, "5534988880009", "menu");
  assert.equal(s.enviados.filter((e) => /\*1\* - Quero comprar/.test(e.texto)).length, 2);
});

test("vender ou anunciar não vai para a Ari (vai pelo menu para Operações)", async () => {
  const s = montar();
  const c = await recebe(s, "5534988880010", "quero vender minha fazenda");
  assert.equal(c.ari_ativa_em ?? null, null);
  assert.match(s.enviados.at(-1).texto, /\*2\* - Quero anunciar/);
});

test("opções com o mesmo texto (0 e 9) aparecem uma vez só no menu; a tecla escondida continua valendo", async () => {
  const s = montar();
  await recebe(s, "5534988880020", "Oi");
  const menu = s.enviados.at(-1).texto;
  assert.equal((menu.match(/Falar com a equipe de atendimento/g) ?? []).length, 1);
  assert.match(menu, /\*0\* - Falar com a equipe/);
  const c = await recebe(s, "5534988880020", "9");
  assert.ok(c.menu_respondido_em);
});

test("\"0\" (caixa central) avisa a recepção; setor sem responsável avisa quem é do setor", async () => {
  const s = montar();
  await recebe(s, "5534988880021", "Oi");
  await recebe(s, "5534988880021", "0");
  assert.ok(s.avisos.some((a) => a[0] === "recepcao-1" && /caixa central/.test(a[2])), "recepção avisada");
  const s2 = montar();
  await recebe(s2, "5534988880022", "Oi");
  await recebe(s2, "5534988880022", "3");
  assert.ok(s2.avisos.some((a) => a[0] === "fin-1" && /Financeiro/.test(a[2])), "Financeiro avisado");
});

test("errar o menu até o limite explica ao cliente e avisa a recepção", async () => {
  const s = montar();
  const tel = "5534988880023";
  await recebe(s, tel, "Oi");
  for (const t of ["xyz", "abc", "qwe"]) await recebe(s, tel, t);
  assert.match(s.enviados.at(-1).texto, /Não consegui identificar a opção/);
  assert.ok(s.avisos.some((a) => a[0] === "recepcao-1"));
});

test("figurinha com o menu aberto não conta como opção errada; mensagem atrasada não recebe menu", async () => {
  const s = montar();
  const tel = "5534988880024";
  await recebe(s, tel, "Oi");
  const antes = s.enviados.length;
  const c = await s.recebe(tel, "[sticker]", "Cliente", { tipo: "sticker" });
  assert.equal(s.enviados.length, antes);
  assert.equal(c.menu_tentativas ?? 0, 0);
  const s2 = montar();
  await s2.recebe("5534988880025", "Oi", "Cliente", { recebidaEm: new Date(Date.now() - 5 * 3_600_000).toISOString() });
  assert.equal(s2.enviados.length, 0);
});

function recebe(s, tel, texto) { return s.recebe(tel, texto); }
