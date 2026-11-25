// Otimiza o vídeo que o anunciante enviou (08/10/2026).
//
// O vídeo chega como sai do celular: 1080p ou 4K, até 500 MB, muitas vezes HEVC
// em .mov (iPhone) — que o Chrome e o Android não tocam. Aqui ele vira MP4
// H.264 720p, áudio AAC, "faststart" (começa a tocar antes de baixar tudo):
// toca em qualquer aparelho e pesa 4 a 6 vezes menos para quem assiste no 4G.
// Também sai um quadro de capa (poster) em JPEG.
//
// O original só é apagado depois que o otimizado subiu e o registro foi
// trocado; se algo falhar no meio, o anúncio continua com o vídeo original.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function rodar(args) {
  return new Promise((ok, falha) => {
    const p = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let erro = "";
    p.stderr.on("data", (d) => { erro = (erro + d).slice(-1500); });
    p.on("error", falha);
    p.on("close", (c) => (c === 0 ? ok() : falha(new Error(`ffmpeg saiu com ${c}: ${erro.split("\n").slice(-3).join(" ")}`))));
  });
}

export async function otimizarVideo(payload, db) {
  const { media_id } = payload;
  const { rows: [m] } = await db.query(`select id, property_id, storage_path from property_media where id = $1 and tipo = 'video'`, [media_id]);
  if (!m) return; // vídeo removido antes de processar
  if (m.storage_path.endsWith("-otimizado.mp4")) return; // já feito

  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const pasta = await mkdtemp(join(tmpdir(), "video-"));
  try {
    // baixa direto para o disco: vídeo de até 500 MB não cabe bem na memória do worker
    const { data: link, error } = await supa.storage.from("media").createSignedUrl(m.storage_path, 3600);
    if (error || !link) throw new Error(`baixar original: ${error?.message ?? "sem link"}`);
    const resp = await fetch(link.signedUrl);
    if (!resp.ok || !resp.body) throw new Error(`baixar original: HTTP ${resp.status}`);
    const entrada = join(pasta, "original");
    await pipeline(Readable.fromWeb(resp.body), createWriteStream(entrada));

    const saida = join(pasta, "otimizado.mp4");
    await rodar([
      "-y", "-i", entrada,
      // 720 de altura (ou de largura, se o vídeo for em pé), sem aumentar vídeo pequeno; até 30 fps
      "-vf", "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)',fps='min(30,source_fps)'",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2",
      "-movflags", "+faststart", "-map_metadata", "-1", // sem metadados (inclui GPS do celular)
      saida,
    ]).catch(async () => {
      // ffmpeg antigo sem `source_fps`: tenta sem limitar o fps
      await rodar([
        "-y", "-i", entrada,
        "-vf", "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", "-map_metadata", "-1", saida,
      ]);
    });
    const poster = join(pasta, "poster.jpg");
    await rodar(["-y", "-ss", "1", "-i", saida, "-frames:v", "1", "-q:v", "4", poster]).catch(() => undefined);

    const base = m.storage_path.replace(/\.[^.\/]+$/, "");
    const novo = `${base}-otimizado.mp4`;
    const up = await supa.storage.from("media").upload(novo, await readFile(saida), { contentType: "video/mp4", upsert: true });
    if (up.error) throw new Error(`enviar otimizado: ${up.error.message}`);
    await supa.storage.from("media").upload(`${base}-poster.jpg`, await readFile(poster).catch(() => Buffer.alloc(0)), {
      contentType: "image/jpeg", upsert: true,
    }).catch(() => undefined);

    await db.query(`update property_media set storage_path = $2 where id = $1`, [m.id, novo]);
    await supa.storage.from("media").remove([m.storage_path]);
    const antes = (await stat(entrada)).size, depois = (await readFile(saida)).length;
    console.log(`[video] ${m.id}: ${(antes / 1e6).toFixed(1)} MB → ${(depois / 1e6).toFixed(1)} MB`);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
