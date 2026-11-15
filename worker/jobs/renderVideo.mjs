// Grava o tour 3D como MP4: Puppeteer (SwiftShader, sem GPU) captura frame a
// frame com clock determinístico via window.__ARINI_TOUR.seek(t); ffmpeg monta.
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import { caminhoChromium, liberarAcesso } from "./acessoSite.mjs";

const FPS = 30;
const LARGURA = 1280;
const ALTURA = 720;

function supa() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export async function renderVideo(payload, db) {
  const { property_id, codigo } = payload;
  const url = `${process.env.SITE_URL}/imovel/${codigo}/tour?record=1`;

  const browser = await puppeteer.launch({
    executablePath: caminhoChromium(),
    headless: "shell",
    args: [
      "--no-sandbox", "--disable-dev-shm-usage",
      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      `--window-size=${LARGURA},${ALTURA}`,
    ],
  });

  try {
    const page = await browser.newPage();
    await liberarAcesso(page);
    const expira = String(Date.now()+5*60_000);
    const assinatura = createHmac("sha256",process.env.SAUDE_TOKEN).update("tour:"+codigo+":"+expira).digest("hex");
    await browser.setCookie({name:"arini_render",value:expira+"."+assinatura,domain:new URL(url).hostname,
      path:"/imovel/"+codigo+"/tour",secure:new URL(url).protocol==="https:",httpOnly:true,expires:Math.floor(Number(expira)/1000)});
    await page.setViewport({ width: LARGURA, height: ALTURA });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
    await page.waitForFunction("window.__ARINI_TOUR !== undefined", { timeout: 60000 });
    const duracao = await page.evaluate("window.__ARINI_TOUR.duracao");
    const totalFrames = Math.ceil(duracao * FPS);

    // ffmpeg lendo PNGs do stdin
    const saida = join(tmpdir(), `${codigo}.mp4`);
    const ffmpeg = spawn("ffmpeg", [
      "-y", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
      "-movflags", "+faststart", saida,
    ], { stdio: ["pipe", "ignore", "inherit"] });

    for (let f = 0; f <= totalFrames; f++) {
      const t = f / FPS;
      await page.evaluate((tt) => window.__ARINI_TOUR.seek(tt), t);
      // espera tiles carregarem no primeiro frame e a cada salto grande
      if (f === 0 || f % (FPS * 5) === 0) {
        await page.waitForFunction("window.__ARINI_TOUR.pronto()", { timeout: 30000 }).catch(() => undefined);
      }
      const png = await page.screenshot({ type: "png" });
      const ok = ffmpeg.stdin.write(png);
      if (!ok) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    }
    ffmpeg.stdin.end();
    await new Promise((resolve, reject) => {
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com ${code}`))));
    });

    // sobe para o storage público
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(saida);
    const path = `videos/${property_id}/${codigo}.mp4`;
    const { error } = await supa().storage.from("media").upload(path, buf, {
      contentType: "video/mp4", upsert: true,
    });
    if (error) throw new Error(`upload: ${error.message}`);

    await db.query(
      `update presentations set status = 'pronto', output_path = $2, duracao_s = $3
       where property_id = $1 and tipo = 'video'`,
      [property_id, path, Math.round(duracao)]
    );
  } finally {
    await browser.close();
  }
}
