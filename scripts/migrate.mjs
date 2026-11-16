// Aplica migrations de supabase/migrations/ em ordem, registrando em _migrations.
// Uso: node scripts/migrate.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const args = process.argv.slice(2);
const ate = args[0]?.match(/^--ate=([0-9]{4})$/)?.[1];
if (args.length && (!ate || args.length !== 1)) throw new Error("Uso: node scripts/migrate.mjs [--ate=NNNN]");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// lê .env.local manualmente (sem dotenv)
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const ref = process.env.SUPABASE_PROJECT_REF;
const password = process.env.SUPABASE_DB_PASSWORD;

const candidates = [
  { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
  { host: "aws-0-sa-east-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}` },
  { host: "aws-1-sa-east-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}` },
];

async function connect() {
  for (const c of candidates) {
    const client = new pg.Client({
      host: c.host, port: c.port, user: c.user, password,
      database: "postgres", ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
    });
    try {
      await client.connect();
      console.log(`conectado via ${c.host}`);
      return client;
    } catch (e) {
      console.log(`falhou ${c.host}: ${e.message}`);
    }
  }
  throw new Error("nenhum host de banco acessível");
}

const client = await connect();
await client.query(`create table if not exists _migrations (name text primary key, applied_at timestamptz default now())`);
const done = new Set((await client.query(`select name from _migrations`)).rows.map(r => r.name));

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter(f => f.endsWith(".sql") && (!ate || f.slice(0,4) <= ate)).sort();
for (const f of files) {
  if (done.has(f)) { console.log(`pulando ${f} (já aplicada)`); continue; }
  console.log(`aplicando ${f}...`);
  const sql = readFileSync(join(dir, f), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(`insert into _migrations (name) values ($1)`, [f]);
    await client.query("commit");
    console.log(`ok ${f}`);
  } catch (e) {
    await client.query("rollback");
    console.error(`ERRO em ${f}: ${e.message}`);
    process.exitCode = 1;
    break;
  }
}
// PostgREST (API do Supabase) só enxerga funções novas depois do reload do schema
await client.query(`notify pgrst, 'reload schema'`);
await client.end();
