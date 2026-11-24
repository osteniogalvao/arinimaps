// Mede quanta nuvem cada fonte de satélite tem sobre os municípios do piloto.
//
// Existe porque "tirar a nuvem do mapa" foi decidido duas vezes no olho e voltou
// as duas vezes: o mosaico atual da Esri MUDA sem aviso, e a nuvem entrou numa
// atualização. Aqui a escolha do release vira número, não impressão.
//
// Uso:
//   node scripts/mede-nuvem.mjs                      # compara as fontes candidatas
//   node scripts/mede-nuvem.mjs --releases 12        # varre releases do Wayback
//
// Como conta: pixel claro (valor > 0,70) e sem cor (saturação < 0,18) é nuvem.
// Telhado branco também cai nessa conta, por isso o número nunca é zero absoluto
// numa cidade — o que importa é a COMPARAÇÃO entre fontes no mesmo tile.
import puppeteer from "puppeteer-core";

// Conferidas em 17/09/2026 contra o centro das plantas publicadas (bbox no
// diagnóstico da camada). União de Minas estava em -19.7669: ~26 km ao sul da
// cidade, em área rural — a medição de nuvem dela não olhava a mancha urbana.
const CIDADES = {
  "Iturama": [-19.7243, -50.2035],
  "Limeira do Oeste": [-19.5545, -50.5787],
  "União de Minas": [-19.5298, -50.3320],
};
const Z = 15;
const CONFIG_WAYBACK = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";

const RELEASE_EM_USO = "49059"; // World Imagery (Wayback 2026-04-30) — ver src/lib/map/config.ts
const FONTES = {
  "World Imagery (atual)": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  "Clarity": "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  [`Wayback ${RELEASE_EM_USO} (em uso)`]: `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${RELEASE_EM_USO}/{z}/{y}/{x}`,
};

const varrerReleases = process.argv.includes("--releases");
const quantos = Number(process.argv[process.argv.indexOf("--releases") + 1]) || 12;

function tile(lat, lon, z) {
  const n = 2 ** z;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
  };
}

const fontes = { ...FONTES };
if (varrerReleases) {
  const cfg = await fetch(CONFIG_WAYBACK).then((r) => r.json());
  for (const [rel, v] of Object.entries(cfg).slice(0, quantos * 3).filter((_, i) => i % 3 === 0)) {
    fontes[v.itemTitle.replace("World Imagery ", "")] =
      v.itemURL.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}") + `#${rel}`;
  }
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage();
  await page.goto("about:blank");

  // o navegador decodifica JPEG/PNG por nós; o canvas devolve os pixels
  const medir = (urls) =>
    page.evaluate(async (lista) => {
      const conta = (img) => {
        const c = document.createElement("canvas");
        c.width = 96; c.height = 96;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 96, 96);
        const { data } = ctx.getImageData(0, 0, 96, 96);
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const s = max === 0 ? 0 : (max - min) / max;
          if (max > 0.70 && s < 0.18) n++;
        }
        return (100 * n) / (96 * 96);
      };
      const saida = [];
      for (const u of lista) {
        try {
          const img = await new Promise((ok, falhou) => {
            const i = new Image();
            i.crossOrigin = "anonymous";
            i.onload = () => ok(i);
            i.onerror = () => falhou(new Error("404 ou bloqueado"));
            i.src = u;
          });
          saida.push(conta(img));
        } catch {
          saida.push(null);
        }
      }
      return saida;
    }, urls);

  const larg = Math.max(...Object.keys(fontes).map((f) => f.length));
  for (const [cidade, [lat, lon]] of Object.entries(CIDADES)) {
    const { x, y } = tile(lat, lon, Z);
    console.log(`\n== ${cidade} — z${Z}, 3x3 tiles (~4 km) ==`);
    for (const [nome, tpl] of Object.entries(fontes)) {
      const urls = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          urls.push(tpl.split("#")[0].replace("{z}", Z).replace("{x}", x + dx).replace("{y}", y + dy));
      const vals = (await medir(urls)).filter((v) => v !== null);
      if (!vals.length) { console.log(`  ${nome.padEnd(larg)}  sem imagem`); continue; }
      const media = vals.reduce((s, v) => s + v, 0) / vals.length;
      console.log(`  ${nome.padEnd(larg)}  média ${media.toFixed(1).padStart(5)}%   pior ${Math.max(...vals).toFixed(1).padStart(5)}%`);
    }
  }
} finally {
  await browser.close();
}
