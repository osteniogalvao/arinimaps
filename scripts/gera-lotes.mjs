// Gera os lotes urbanos clicáveis das plantas vetoriais publicadas.
//
// Mesmo código do worker (worker/jobs/gerarLotes.mjs). Existe como script
// porque a geração leva mais de um minuto por cidade e precisa de conexão
// direta com o banco — não cabe numa requisição web.
//
// Rode de novo depois de: enviar uma planta nova, mudar a calibração ou mudar
// as camadas ocultas. O painel de Cartografia avisa quando os lotes de uma
// planta ficaram defasados.
//
// Uso: node scripts/gera-lotes.mjs [--forcar] [id-da-planta ...]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { gerarLotes, assinaturaDe } from "../worker/jobs/gerarLotes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const linha of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const forcar = process.argv.includes("--forcar");
const so = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const db = new pg.Pool({
  host: `db.${process.env.SUPABASE_PROJECT_REF}.supabase.co`, port: 5432, user: "postgres",
  password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false }, max: 2,
});

const { rows } = await db.query(`
  select id, nome, lotes_total, lotes_assinatura, layers_ocultos, offset_leste_m, offset_norte_m, rotacao_graus, escala, ajustes_locais, edicoes_geometria
  from cartography_layers where tipo = 'vector' and status = 'pronto' and tiles_path is not null order by nome`);

for (const c of rows) {
  if (so.length && !so.includes(c.id)) continue;
  if (!forcar && c.lotes_total != null && c.lotes_assinatura === assinaturaDe(c)) {
    console.log(`— ${c.nome}: ${c.lotes_total} lotes já gerados com a calibração atual (use --forcar)`);
    continue;
  }
  const t0 = Date.now();
  try {
    const r = await gerarLotes({ layer_id: c.id }, db);
    console.log(`✓ ${c.nome}: ${r.lotes} lotes em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (e) {
    console.log(`✗ ${c.nome}: ${e.message}`);
  }
}
await db.end();
