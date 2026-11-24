// Ferramentas do mapa com clique de verdade: medir distância, medir área e o
// cartão do lote. Mira pelas posições reais dos elementos (não por coordenada
// fixa de tela), então vale em qualquer resolução.
//
// Uso: node scripts/testa-ferramentas-mapa.mjs   (com `npm run dev` rodando)
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let falhas = 0;
const ok = (rotulo, cond, extra = "") => { if (!cond) falhas++; console.log(`${cond ? "✓" : "✗"} ${rotulo}${extra ? " — " + String(extra).slice(0, 200) : ""}`); };
const esp = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1440,900"],
});
try {
  const p = await (await b.createBrowserContext()).newPage();
  await p.evaluateOnNewDocument(() => localStorage.setItem("arini:tour:mapa", "1"));
  await p.setViewport({ width: 1440, height: 900 });
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));
  await p.goto(`${BASE}/acesso`, { waitUntil: "networkidle2", timeout: 180000 });
  const st = await p.evaluate(async (s) => (await fetch("/api/acesso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha: s }) })).status, process.env.SITE_SENHA ?? "");
  ok("passou pela senha do site", st === 200, st);

  // visitante, longe dos lotes (campo aberto) para o clique não cair num lote
  await p.goto(`${BASE}/mapa#pos=15/-19.70/-50.30`, { waitUntil: "networkidle2", timeout: 180000 });
  await esp(6000);
  const canvas = await p.$(".maplibregl-canvas");
  const caixa = await canvas.boundingBox();
  const ponto = (fx, fy) => [caixa.x + caixa.width * fx, caixa.y + caixa.height * fy];

  const botao = async (rotulo) => p.evaluateHandle((r) => [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === r || x.textContent.trim() === r), rotulo);
  const clicarBotao = async (rotulo) => { const h = await botao(rotulo); await h.asElement().click(); await esp(400); };
  const textoResultado = () => p.evaluate(() => document.body.innerText.match(/\d[\d.,]*\s?(m|km|m²|ha|alq)\b[^\n]{0,40}/g) ?? []);

  // ---------- distância ----------
  const antes = await textoResultado();
  await clicarBotao("Medir Distância");
  const dica = await p.evaluate(() => document.body.innerText.includes("Clique nos pontos; duplo clique encerra."));
  ok("medir distância: ativa e mostra a instrução", dica);
  let [x1, y1] = ponto(0.30, 0.30), [x2, y2] = ponto(0.60, 0.45);
  await p.mouse.click(x1, y1); await esp(300);
  await p.mouse.click(x2, y2, { clickCount: 1 }); await esp(150);
  await p.mouse.click(x2, y2, { clickCount: 2 }); await esp(800);
  const depois = await textoResultado();
  const novos = depois.filter((t) => !antes.includes(t));
  ok("medir distância: mostra a medida", novos.some((t) => /\b(m|km)\b/.test(t)), novos.join(" | "));
  const painelLote = await p.evaluate(() => /Consulta territorial/.test(document.body.innerText));
  ok("medir distância: clique não abre cartão de imóvel", !painelLote);
  await p.screenshot({ path: process.env.PRINT_DIST ?? ".capturas/ferramenta-distancia.png" });

  // ---------- área ----------
  await clicarBotao("Medir Área");
  const pts = [ponto(0.35, 0.30), ponto(0.55, 0.30), ponto(0.55, 0.55), ponto(0.35, 0.55)];
  for (const [x, y] of pts.slice(0, -1)) { await p.mouse.click(x, y); await esp(250); }
  const [xu, yu] = pts[pts.length - 1];
  await p.mouse.click(xu, yu); await esp(150);
  await p.mouse.click(xu, yu, { clickCount: 2 }); await esp(800);
  // a medida aparece na mesma barra da instrução (o texto da lista de imóveis não conta)
  const barra = await p.evaluate(() => {
    const el = [...document.querySelectorAll("div")].reverse().find((d) => d.innerText?.startsWith("Clique nos vértices"));
    return el?.innerText ?? "";
  });
  ok("medir área: mostra a área na barra da ferramenta", /\d[\d.,]*\s?(m²|ha)/.test(barra), barra.replace(/\n/g, " "));
  await p.screenshot({ path: process.env.PRINT_AREA ?? ".capturas/ferramenta-area.png" });

  ok("sem erro de JavaScript na página", erros.length === 0, erros.join(" | "));
} finally {
  await b.close();
}
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
