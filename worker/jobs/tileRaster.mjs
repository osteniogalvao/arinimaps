// Cartografia urbana: GeoTIFF/imagem georreferenciada → pirâmide de tiles.
// GDAL no container: gdalwarp (EPSG:3857) → gdal2tiles → upload por tile.
import { spawn } from "node:child_process";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} saiu com ${code}`))));
  });
}

async function* tilesDe(dir, prefixo = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const caminho = join(dir, entry.name);
    if (entry.isDirectory()) yield* tilesDe(caminho, `${prefixo}${entry.name}/`);
    else if (entry.name.endsWith(".png")) yield { caminho, rel: `${prefixo}${entry.name}` };
  }
}

export async function tileRaster(payload, db) {
  const { layer_id, source_path } = payload;
  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await db.query(`update cartography_layers set status = 'processando' where id = $1`, [layer_id]);

  const dir = await mkdtemp(join(tmpdir(), "carto-"));
  try {
    // baixa o original
    // Jobs antigos guardam o original em media. Novos originais são privados;
    // apenas os tiles gerados são enviados ao bucket de mídia pública.
    const bucketOrigem = payload.source_bucket === "docs" ? "docs" : "media";
    const { data, error } = await supa.storage.from(bucketOrigem).download(source_path);
    if (error) throw new Error(`download: ${error.message}`);
    const original = join(dir, "original");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(original, Buffer.from(await data.arrayBuffer()));

    const warped = join(dir, "warped.tif");
    const tilesDir = join(dir, "tiles");
    // reprojeta e transforma branco em transparência ("só as riscas")
    await sh("gdalwarp", ["-t_srs", "EPSG:3857", "-dstalpha", "-srcnodata", "255 255 255", original, warped]);
    await sh("gdal2tiles.py", ["--xyz", "-z", "12-19", "-w", "none", "--processes=2", warped, tilesDir]);

    let enviados = 0;
    for await (const tile of tilesDe(tilesDir)) {
      const buf = await readFile(tile.caminho);
      const destino = `tiles/${layer_id}/${tile.rel}`;
      const { error: upErr } = await supa.storage.from("media").upload(destino, buf, {
        contentType: "image/png", upsert: true,
      });
      if (upErr) throw new Error(`upload ${tile.rel}: ${upErr.message}`);
      enviados++;
    }

    await db.query(
      `update cartography_layers set status = 'pronto', tiles_path = $2 where id = $1`,
      [layer_id, `tiles/${layer_id}`]
    );
    console.log(`camada ${layer_id}: ${enviados} tiles no ar`);
  } catch (e) {
    await db.query(`update cartography_layers set status = 'erro', erro = $2 where id = $1`,
      [layer_id, e instanceof Error ? e.message : String(e)]);
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
