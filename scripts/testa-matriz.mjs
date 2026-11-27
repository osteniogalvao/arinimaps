// Teste da Matriz por setores (rodada 2, 01/10/2026):
//  · cada tela da Central abre sem erro para a diretoria;
//  · tarefa, chamado de suporte, pedido LGPD e planilha do financeiro funcionam;
//  · um membro só do Comercial não entra no Financeiro (tela nem rota);
//  · segundo fator: ativa com TOTP, o login passa a pedir o código, desativa.
// Tudo o que o teste cria é apagado no fim.
//
// Uso: node scripts/testa-matriz.mjs   (com `npm run dev` rodando)
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL_TESTE = "teste.setor@arinibrasil.com.br";
const SENHA_TESTE = "SetorTeste2026x";

/** TOTP (RFC 6238) a partir do segredo em base32 — o mesmo cálculo do aplicativo autenticador. */
function totp(segredo) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of segredo.replace(/=+$/, "").toUpperCase()) bits += alfabeto.indexOf(c).toString(2).padStart(5, "0");
  const chave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", chave).update(contador).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox", "--window-size=1440,900"],
});
const novaPagina = async () => {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  // IP próprio por sessão (faixa 10.251.x.x), como no testa-seguranca: em localhost não há
  // proxy, e sem isto os limites dos formulários públicos por IP travam o teste seguinte
  await p.setExtraHTTPHeaders({ "x-real-ip": `10.251.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await p.setViewport({ width: 1440, height: 900 });
  // senha de bloqueio do site (fase de testes): sem ela toda rota responde "acesso restrito"
  await p.goto(`${BASE}/acesso`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.evaluate(async (s) => {
    await fetch("/api/acesso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha: s }) });
  }, process.env.SITE_SENHA ?? "");
  await p.goto(`${BASE}/entrar`, { waitUntil: "networkidle2", timeout: 120000 });
  return p;
};
const api = (p, url, body, method = "POST") => p.evaluate(async (u, bd, m) => {
  const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: m === "GET" ? undefined : JSON.stringify(bd ?? {}) });
  const t = await r.text();
  return { status: r.status, corpo: t.slice(0, 220), json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
}, url, body, method);
// ✗ marca a saída com erro: o npm run testa precisa enxergar a falha
const ok = (rotulo, cond, extra = "") => {
  if (!cond) process.exitCode = 1;
  console.log(`${cond ? "✓" : "✗"} ${rotulo}${extra ? " — " + extra : ""}`);
};

const criados = { tarefas: [], tickets: [], lgpd: [], usuario: null };
try {
  // ---------- diretoria: todas as telas ----------
  const p = await novaPagina();
  const login = await api(p, "/api/auth/entrar", { email: "admin@arinibrasil.com.br", senha: process.env.SEED_USER_PASSWORD });
  ok("login da diretoria", login.status === 200, login.corpo);

  const TELAS = ["/admin", "/admin/tarefas", "/admin/operacoes", "/admin/comercial", "/admin/financeiro", "/admin/juridico",
    "/admin/juridico/lgpd", "/admin/marketing", "/admin/suporte", "/admin/seguranca", "/admin/usuarios", "/admin/configuracoes",
    "/admin/imoveis", "/admin/cadastros", "/admin/funil", "/admin/leads", "/admin/comissoes", "/admin/mensalidades",
    "/admin/cartografia", "/admin/regioes", "/admin/auditoria", "/admin/relatorios", "/conta/seguranca", "/suporte"];
  for (const t of TELAS) {
    const r = await p.goto(BASE + t, { waitUntil: "domcontentloaded", timeout: 120000 });
    await espera(600);
    const erro = await p.evaluate(() =>
      document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("[data-nextjs-dialog], [data-nextjs-error-overlay-dialog]")
        ? "overlay de erro"
        : /Application error|Unhandled Runtime Error|This page could not be found/.test(document.body.innerText) ? "erro na página" : "");
    ok(`tela ${t}`, r.status() === 200 && p.url().includes(t) && !erro, `${r.status()} ${erro}`);
  }
  await p.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await p.screenshot({ path: ".capturas/matriz.png", fullPage: true });

  // ---------- tarefa ----------
  const t1 = await api(p, "/api/admin/tarefas", { setor: "juridico", titulo: "TESTE — revisar termo de parceria", criterio_conclusao: "Anexar a revisão do termo", prioridade: "alta", prazo: "2026-10-15" });
  ok("cria tarefa no Jurídico", t1.status === 200, t1.corpo);
  if (t1.json?.id) criados.tarefas.push(t1.json.id);
  const semProva = await api(p, "/api/admin/tarefas", { id: t1.json?.id, status: "concluida" }, "PATCH");
  ok("recusa conclusão sem evidência", semProva.status === 400, semProva.corpo);
  const t2 = await api(p, "/api/admin/tarefas", { id: t1.json?.id, status: "concluida", evidencia: "Versão revisada e conferida pela Matriz." }, "PATCH");
  ok("conclui a tarefa", t2.status === 200, t2.corpo);

  // ---------- suporte ----------
  const s1 = await api(p, "/api/suporte", { nome: "Cliente Teste", email: "cliente.teste@exemplo.com", categoria: "problema", assunto: "TESTE — não consigo enviar fotos", mensagem: "Ao enviar as fotos do anúncio a tela fica parada." });
  ok("abre chamado", s1.status === 200 && /^SUP-/.test(s1.json?.codigo ?? ""), s1.corpo);
  if (s1.json?.id) criados.tickets.push(s1.json.id);
  const s2 = await api(p, "/api/admin/suporte", { id: s1.json?.id, mensagem: "Olá! Qual o tamanho das fotos?" }, "PATCH");
  ok("equipe responde", s2.status === 200, s2.corpo);
  const s3 = await api(p, "/api/admin/suporte", { id: s1.json?.id, mensagem: "Parece limite de upload.", interno: true }, "PATCH");
  ok("nota interna", s3.status === 200, s3.corpo);
  const { data: tk } = await admin.from("support_tickets").select("status, responsavel").eq("id", s1.json?.id).single();
  ok("chamado ficou aguardando o cliente, com responsável", tk?.status === "aguardando_cliente" && !!tk?.responsavel, JSON.stringify(tk));
  await p.goto(`${BASE}/admin/suporte/${s1.json?.id}`, { waitUntil: "networkidle2" });
  await p.screenshot({ path: ".capturas/matriz-chamado.png", fullPage: true });

  // ---------- LGPD ----------
  const l1 = await api(p, "/api/suporte", { nome: "Titular Teste", email: "titular.teste@exemplo.com", categoria: "dados_pessoais", lgpd_tipo: "exclusao", mensagem: "Quero excluir meus dados cadastrais do sistema." });
  ok("pedido LGPD pela página pública", l1.status === 200 && /^LGPD-/.test(l1.json?.codigo ?? ""), l1.corpo);
  const { data: lg } = await admin.from("lgpd_requests").select("id, prazo").eq("codigo", l1.json?.codigo).single();
  if (lg) criados.lgpd.push(lg.id);
  const l2 = await api(p, "/api/admin/lgpd", { id: lg?.id, status: "atendido" }, "PATCH");
  ok("encerrar sem resposta é recusado", l2.status === 400, l2.corpo);
  const l3 = await api(p, "/api/admin/lgpd", { id: lg?.id, status: "atendido", resposta: "Dados excluídos, exceto os de guarda legal.", avisar: false }, "PATCH");
  ok("encerrar com resposta", l3.status === 200, l3.corpo);

  // ---------- financeiro ----------
  const csv = await p.evaluate(async () => { const r = await fetch("/api/admin/financeiro/exportar"); return { s: r.status, t: (await r.text()).slice(0, 90), tipo: r.headers.get("content-type") }; });
  ok("planilha do financeiro", csv.s === 200 && csv.t.includes("tipo;data"), `${csv.tipo} | ${csv.t.replace(/\r?\n/g, " ⏎ ")}`);

  // ---------- membro só do Comercial ----------
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 500 });
  const antigo = lista.users.find((u) => u.email === EMAIL_TESTE);
  if (antigo) await admin.auth.admin.deleteUser(antigo.id);
  const novo = await api(p, "/api/admin/usuarios", { nome: "Teste Setor", email: EMAIL_TESTE, senha: SENHA_TESTE, role: "analista_arini", setores: ["comercial"] });
  ok("diretoria cria membro só do Comercial", novo.status === 200, novo.corpo);
  const { data: lista2 } = await admin.auth.admin.listUsers({ perPage: 500 });
  criados.usuario = lista2.users.find((u) => u.email === EMAIL_TESTE)?.id ?? null;

  const q = await novaPagina();
  const lq = await api(q, "/api/auth/entrar", { email: EMAIL_TESTE, senha: SENHA_TESTE });
  ok("login do membro", lq.status === 200, lq.corpo);
  await q.goto(`${BASE}/admin/comercial`, { waitUntil: "domcontentloaded" });
  ok("entra no Comercial", q.url().endsWith("/admin/comercial"), q.url());
  await q.goto(`${BASE}/admin/financeiro`, { waitUntil: "domcontentloaded" });
  ok("Financeiro devolve para a Matriz", q.url().includes("sem_acesso=financeiro"), q.url());
  const fq = await q.evaluate(async () => (await fetch("/api/admin/financeiro/exportar")).status);
  ok("rota do Financeiro recusa (403)", fq === 403, String(fq));
  const tq = await api(q, "/api/admin/tarefas", { setor: "juridico", titulo: "não deveria entrar", criterio_conclusao: "Confirmar restrição" });
  ok("não cria tarefa em setor alheio (403)", tq.status === 403, tq.corpo);
  await q.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  const menu = await q.evaluate(() => [...new Set([...document.querySelectorAll("aside button[aria-expanded] > span.flex-1")].map((e) => e.textContent.trim()))]);
  ok("menu mostra só Geral + Comercial", menu.join(",") === "Geral,Comercial", menu.join(","));

  // ---------- segundo fator ----------
  await q.goto(`${BASE}/conta/seguranca`, { waitUntil: "networkidle2" });
  await q.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Ativar com aplicativo"))?.click());
  await q.waitForSelector("img[alt^='Código QR']", { timeout: 20000 });
  const segredo = await q.evaluate(() => document.querySelector("p.font-mono.select-all")?.textContent.trim());
  await q.type("#cod", totp(segredo));
  await q.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Confirmar e ativar"))?.click());
  // espera a confirmação na tela (com a bateria inteira, 4 s fixos não bastavam)
  await q.waitForFunction(() => document.body.innerText.includes("Ativa desde") || !!document.querySelector(".text-critico"), { timeout: 30000 }).catch(() => null);
  const ativa = await q.evaluate(() => document.body.innerText.includes("Ativa desde"));
  ok("segundo fator ativado com TOTP", ativa);
  await q.screenshot({ path: ".capturas/conta-seguranca.png", fullPage: true });

  const r = await novaPagina();
  const lr = await api(r, "/api/auth/entrar", { email: EMAIL_TESTE, senha: SENHA_TESTE });
  ok("novo login avisa que falta o segundo fator", lr.json?.mfa === true, lr.corpo);
  await r.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  ok("sem o código, a Central manda para a verificação", r.url().includes("/entrar?mfa=1"), r.url());
  // espera virar a janela de 30 s: o mesmo código não vale duas vezes
  await espera(31000 - (Date.now() % 30000));
  await r.waitForSelector("#mfa", { timeout: 20000 });
  await r.type("#mfa", totp(segredo));
  await r.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Confirmar código"))?.click());
  // com a bateria inteira rodando o servidor demora mais: espera a Central, não um tempo fixo
  await r.waitForFunction(() => location.pathname.startsWith("/admin") || !!document.querySelector(".text-critico"), { timeout: 30000 }).catch(() => null);
  console.log("  mensagem na tela:", await r.evaluate(() => document.querySelector(".text-critico")?.textContent ?? "(nenhuma)"));
  ok("com o código, entra na Central", /\/admin(\/escolher)?$/.test(new URL(r.url()).pathname), r.url());

  const { data: ev } = await admin.from("auth_events").select("evento").eq("user_id", criados.usuario).order("created_at");
  ok("eventos registrados", ["login_ok", "mfa_ativado", "mfa_ok"].every((e) => ev?.some((x) => x.evento === e)), (ev ?? []).map((x) => x.evento).join(","));
} finally {
  // ---------- limpeza ----------
  if (criados.tarefas.length) await admin.from("tasks").delete().in("id", criados.tarefas);
  if (criados.tickets.length) await admin.from("support_tickets").delete().in("id", criados.tickets);
  if (criados.lgpd.length) await admin.from("lgpd_requests").delete().in("id", criados.lgpd);
  if (criados.usuario) await admin.auth.admin.deleteUser(criados.usuario);
  console.log("limpeza feita");
  await b.close();
}
