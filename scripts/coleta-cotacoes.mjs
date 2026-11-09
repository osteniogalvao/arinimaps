// Roda a coleta de cotações uma vez (mesmo código do job `coletar_cotacoes` do
// worker), com as variáveis do .env.local.
// Uso: node scripts/coleta-cotacoes.mjs [--seco] [--historico]
//   --seco       só busca e imprime; não grava nada no banco
//   --historico  carga inicial: ~1 ano (CEPEA .xls, AwesomeAPI diário, Yahoo 1y)
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { coletar, gravarCotacoes } from "../worker/jobs/cotacoes.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const seco = process.argv.includes("--seco");
const historico = process.argv.includes("--historico");

const resultado = await coletar({ historico });

const fmt = (n, casas) => n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
let ok = 0, falhas = 0;
for (const r of resultado) {
  const nome = r.serie ? `${r.serie.nome}${r.serie.praca ? ` · ${r.serie.praca}${r.serie.uf ? `/${r.serie.uf}` : ""}` : ""}` : r.chave;
  if (r.erro) {
    falhas++;
    console.log(`FALHA  ${nome}: ${r.erro}`);
    continue;
  }
  ok++;
  const u = r.pontos.at(-1);
  const v = u?.variacao == null ? "" : ` (${u.variacao > 0 ? "+" : ""}${fmt(u.variacao, 2)}%)`;
  console.log(
    `ok     ${r.serie.slug.padEnd(44)} ${u ? `${u.data}  ${fmt(u.valor, r.serie.casas)} ${r.serie.unidade}${v}` : "sem valor hoje"}` +
    `  · ${r.pontos.length} ponto(s)${r.pontos.length > 1 ? ` desde ${r.pontos[0].data}` : ""}${r.serie.destaque ? "  [faixa]" : ""}${r.aviso ? `  [${r.aviso}]` : ""}`,
  );
}
console.log(`\n${ok} série(s) lidas, ${falhas} falha(s)${historico ? " · modo histórico" : ""}`);

if (seco) {
  console.log("--seco: nada foi gravado.");
  process.exit(0);
}

// grava pelo Postgres direto, como o worker
const env = { ...process.env };
const arqEnv = join(raiz, ".env.local");
if (existsSync(arqEnv)) {
  for (const l of readFileSync(arqEnv, "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
}
env.DATABASE_URL ??= `postgres://postgres:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@db.${env.SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`;
const { default: pg } = await import("pg");
const db = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
try {
  const r = await gravarCotacoes(db, resultado);
  console.log(`gravado: ${r.series} série(s), ${r.valores} valor(es) novos ou alterados.`);
} finally {
  await db.end();
}
