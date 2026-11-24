// Ferramentas do mapa com clique de verdade: medir distância, medir área e o
// cartão do lote. Mira pelas posições reais dos elementos (não por coordenada
// fixa de tela), então vale em qualquer resolução.
//
// Uso: node scripts/testa-ferramentas-mapa.mjs   (com `npm run dev` rodando)
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
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
  if(process.env.QA_EXPORT_EMAIL){
    if(new URL(BASE).hostname!=='127.0.0.1')throw new Error('Conta de exportação somente no QA local');
    const login=await p.evaluate(async(email,senha)=>(await fetch('/api/auth/entrar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,senha})})).status,process.env.QA_EXPORT_EMAIL,process.env.SEED_USER_PASSWORD);
    ok('sessão da conta de exportação',login===200,login);
  }

  // visitante, longe dos lotes (campo aberto) para o clique não cair num lote
  await p.goto(`${BASE}/mapa#pos=15/-19.70/-50.30`, { waitUntil: "networkidle2", timeout: 180000 });
  await esp(6000);
  const canvas = await p.waitForSelector(".maplibregl-canvas",{timeout:90000});
  const caixa = await canvas.boundingBox();
  const ponto = (fx, fy) => [caixa.x + caixa.width * fx, caixa.y + caixa.height * fy];

  const clicarBotao = async (rotulo) => {
    const seletor=await p.$(`button[aria-label=${JSON.stringify(rotulo)}]`)?`button[aria-label=${JSON.stringify(rotulo)}]`:`button::-p-text(${rotulo})`;
    await p.locator(seletor).click();await esp(400);
  };
  const textoResultado = () => p.evaluate(() => [...document.querySelectorAll('.tabular-nums')].map(e=>e.textContent).filter(t=>/\d[\d.,]*\s?(m|km|m²|ha|alq)\b/i.test(t)));

  // ---------- distância ----------
  const antes = await textoResultado();
  await clicarBotao("Medir Distância");
  const dica = await p.evaluate(() => document.body.innerText.includes("Toque nos pontos; Concluir (ou duplo clique) encerra."));
  ok("medir distância: ativa e mostra a instrução", dica);
  if(!dica){console.log(await p.evaluate(()=>document.body.innerText.slice(-2200)));await p.screenshot({path:process.env.PRINT_DIST??'.capturas/ferramenta-distancia.png'});throw new Error('Ferramenta não ativou; conferir permissão/aviso capturado')}
  let [x1, y1] = ponto(0.30, 0.30), [x2, y2] = ponto(0.60, 0.45);
  await p.mouse.click(x1, y1); await esp(300);
  await p.mouse.click(x2, y2, { clickCount: 1 }); await esp(150);
  await clicarBotao("Concluir"); await esp(800);
  const depois = await textoResultado();
  const novos = depois.filter((t) => !antes.includes(t));
  ok("medir distância: mostra a medida", novos.some((t) => /\b(m|km)\b/i.test(t)), novos.join(" | "));
  const painelLote = await p.evaluate(() => [...document.querySelectorAll('aside')].some(e => /Consulta territorial/.test(e.innerText) && !!e.querySelector('a[href^="/imovel/"]')));
  ok("medir distância: clique não abre cartão de imóvel", !painelLote);
  await p.screenshot({ path: process.env.PRINT_DIST ?? ".capturas/ferramenta-distancia.png" });

  // ---------- área ----------
  await clicarBotao("Medir Área");
  const pts = [ponto(0.35, 0.30), ponto(0.55, 0.30), ponto(0.55, 0.55), ponto(0.35, 0.55)];
  for (const [x, y] of pts.slice(0, -1)) { await p.mouse.click(x, y); await esp(250); }
  const [xu, yu] = pts[pts.length - 1];
  await p.mouse.click(xu, yu); await esp(150);
  await clicarBotao("Concluir"); await esp(800);
  // a medida aparece na mesma barra da instrução (o texto da lista de imóveis não conta)
  const barra = await p.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find((d) => d.textContent === "Medição")?.parentElement;
    return el?.innerText ?? "";
  });
  ok("medir área: mostra a área na barra da ferramenta", /\d[\d.,]*\s?(m²|ha)/i.test(barra), barra.replace(/\n/g, " "));
  ok("medir área: libera exportações da geometria concluída", await p.evaluate(()=>document.body.innerText.includes("Baixar a área:") && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='KML')));
  if (process.env.QA_EXPORT_DIR) {
    if (new URL(BASE).hostname !== '127.0.0.1') throw new Error('Exportações automatizadas somente no QA local');
    const dir=resolve(process.env.QA_EXPORT_DIR,String(Date.now()));mkdirSync(dir,{recursive:true});
    const cdp=await p.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
    for (const [rotulo,ext] of [['KML','.kml'],['KMZ','.kmz'],['DXF (UTM)','.dxf'],['Memorial descritivo','.doc']]) {
      await clicarBotao(rotulo);let nome;
      for(let i=0;i<100;i++){nome=readdirSync(dir).find(n=>n.endsWith(ext));if(nome)break;await esp(200)}
      ok('exportação '+rotulo+': arquivo baixado',!!nome);if(!nome)continue;
      const bytes=readFileSync(resolve(dir,nome));let valido=false;
      if(ext==='.kml')valido=/<Polygon>[\s\S]*<coordinates>/.test(bytes.toString())&&bytes.toString().includes('-50.');
      if(ext==='.kmz'){const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(bytes);const kml=Object.values(zip.files).find(f=>f.name.endsWith('.kml'));valido=!!kml&&/<Polygon>/.test(await kml.async('string'))}
      if(ext==='.dxf'){const {default:DxfParser}=await import('dxf-parser');valido=new DxfParser().parseSync(bytes.toString()).entities.some(e=>['LWPOLYLINE','POLYLINE'].includes(e.type))}
      if(ext==='.doc')valido=/SIRGAS/.test(bytes.toString())&&/vértice|vertice/i.test(bytes.toString());
      ok('exportação '+rotulo+': conteúdo geométrico válido',valido);
    }
  }
  await p.screenshot({ path: process.env.PRINT_AREA ?? ".capturas/ferramenta-area.png" });

  ok("sem erro de JavaScript na página", erros.length === 0, erros.join(" | "));
} finally {
  await b.close();
}
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
