// Teste dos lotes urbanos clicáveis (rodada 4, 01/10/2026): a camada carrega
// no zoom de quadra, o clique abre o cartão com as medidas, as metragens
// aparecem no zoom de lote e o anúncio nasce com a divisa do lote.
//
// Uso: node scripts/testa-lotes.mjs   (com `npm run dev` rodando)
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// ✗ marca a saída com erro: o npm run testa precisa enxergar a falha
const ok = (rotulo, cond, extra = "") => {
  if (!cond) process.exitCode = 1;
  console.log(`${cond ? "✓" : "✗"} ${rotulo}${extra ? " — " + extra : ""}`);
};

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1440,900"],
});
let criado = null;
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const pedidos = [];
  p.on("response", (r) => { if (/\/api\/(geo|tiles)\/lotes/.test(r.url())) pedidos.push(r.status()); });
  const erros = [];
  p.on("pageerror", (e) => erros.push(String(e).slice(0, 160)));

  // senha de bloqueio do site (fase de testes): sem ela toda rota responde "acesso restrito"
  await p.goto(`${BASE}/acesso`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.evaluate(async (s) => {
    await fetch("/api/acesso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha: s }) });
  }, process.env.SITE_SENHA ?? "");

  // centro de um bairro de Iturama, no zoom de lote
  await p.goto(`${BASE}/mapa#pos=18.6/-19.7262/-50.1985`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await espera(26000);
  ok("a camada de lotes foi pedida", pedidos.includes(200), pedidos.join(","));
  const info = await p.evaluate(() => {
    const el = document.querySelector(".maplibregl-map");
    return { existe: !!el };
  });
  ok("mapa montado", info.existe);
  await p.screenshot({ path: ".capturas/lotes-z18.png" });

  // clica no meio do mapa (deve cair num lote) e procura o cartão
  let cartao = "";
  for (const [x, y] of [[1000, 480], [1080, 420], [920, 540], [1150, 520], [860, 400]]) {
    await p.mouse.click(x, y);
    await espera(2500);
    // o cartão do lote é um painel de vidro sobre o mapa, achado pelo atalho de anunciar
    cartao = await p.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent.includes("Este lote é meu"))?.closest("div.absolute")?.innerText ?? "");
    if (cartao) break;
  }
  ok("clique abre o cartão do lote", !!cartao, cartao.replace(/\n/g, " | ").slice(0, 150));
  await p.screenshot({ path: ".capturas/lotes-cartao.png" });
  const href = await p.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent.includes("Este lote é meu"))?.getAttribute("href") ?? "");
  ok("cartão tem o atalho para anunciar", href.startsWith("/painel/novo?lote="), href);

  // anúncio a partir do lote, pela rota (proprietário de teste)
  const loteId = href.split("lote=")[1];
  await p.goto(`${BASE}/entrar`, { waitUntil: "networkidle2" });
  await p.evaluate(async (senha) => {
    await fetch("/api/auth/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "proprietario.teste@arinibrasil.com.br", senha }) });
  }, process.env.SEED_USER_PASSWORD);
  await p.goto(`${BASE}/painel/novo?lote=${loteId}`, { waitUntil: "networkidle2", timeout: 120000 });
  await espera(9000);
  const faixa = await p.evaluate(() => document.body.innerText.match(/Lote da planta urbana[^\n]*/)?.[0] ?? "");
  ok("formulário abre com o lote", !!faixa, faixa);
  await p.screenshot({ path: ".capturas/lotes-anuncio.png" });

  const r = await p.evaluate(async (id) => {
    const fd = new FormData();
    fd.set("dados", JSON.stringify({ tipo: "urbano", titulo: "TESTE AUTOMATIZADO — lote", condicao: "exclusividade", prazo_exclusividade_meses: 6, termo_exclusividade:(await (await fetch("/api/conta/anunciar")).json()).termos[6], aceite_termos: true, lote_id: id }));
    // geometria falsa de propósito: a rota tem de ignorar e usar a do banco
    fd.set("geometria", JSON.stringify({ fonte: "lote", geometry: { type: "Point", coordinates: [0, 0] } }));
    // PDF mínimo válido: desde a 9.5 o upload confere o conteúdo, não só a extensão
    const pdf = new TextEncoder().encode(["%PDF-1.4", "1 0 obj<<>>endobj", "trailer<<>>", "%%EOF", " ".repeat(1024)].join("\n"));
    fd.append("doc_matricula", new File([pdf], "matricula.pdf", { type: "application/pdf" }));
    const res = await fetch("/api/imoveis", { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }, loteId);
  ok("anúncio pelo lote é criado", r.status === 200, JSON.stringify(r.json));
  criado = r.json?.id ?? null;
  const { data: g } = await admin.from("property_geometries").select("fonte, area_m2").eq("property_id", criado).single();
  const { data: l } = await admin.from("urban_lots").select("area_m2").eq("id", loteId).single();
  ok("a divisa gravada é a do lote do banco, não a enviada", g?.fonte === "lote" && Math.abs(Number(g.area_m2) - Number(l.area_m2)) < 2, `${g?.fonte} ${g?.area_m2} × ${l?.area_m2}`);
  console.log("erros de página:", erros.slice(0, 3));
} finally {
  if (criado) {
    const { data: docs } = await admin.from("property_documents").select("storage_path").eq("property_id", criado);
    if (docs?.length) await admin.storage.from("docs").remove(docs.map((d) => d.storage_path));
    await admin.from("properties").delete().eq("id", criado);
  }
  console.log("limpeza feita");
  await b.close();
}
