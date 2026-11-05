// Backup do banco (roadmap 1.6): cópia CRIPTOGRAFADA e FORA do Supabase.
//
// O backup diário do plano Pro do Supabase fica no próprio Supabase — se a
// conta for perdida, bloqueada ou apagada por engano, ele vai junto. Este
// script gera uma segunda cópia, independente:
//   1. pg_dump em formato custom (compactado) dos schemas que são NOSSOS:
//      `public` inteiro (estrutura + dados) e os DADOS de `auth` (contas) e
//      `storage` (registro dos arquivos). O resto é do Supabase e o projeto
//      novo já traz.
//   2. criptografa com AES-256-GCM (chave derivada de BACKUP_CHAVE por scrypt):
//      quem pegar o arquivo sem a chave não lê CPF, documento nem senha.
//   3. envia para a Cloudflare R2 (`backups/banco/AAAA-MM-DD/`) e apaga os
//      antigos: 7 diários, 4 semanais (domingo) e 12 mensais (dia 1).
//   Sem as variáveis da R2, grava só na pasta local (--local, ou por padrão).
//
// Metas: RPO 24 h (no pior caso perde-se o dia), RTO 2 h (restaurar e apontar o
// app). Restauração e teste: scripts/backup-restaurar.mjs e docs/BACKUP.md.
//
// Variáveis: BACKUP_CHAVE (obrigatória; guardar FORA do servidor também — sem
// ela o backup é inútil), SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD,
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_BACKUP (ou R2_BUCKET),
// PG_DUMP (caminho do pg_dump, se não estiver no PATH).
// Uso: node scripts/backup.mjs [--local <pasta>]
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const l of readFileSync(join(raiz, ".env.local"), "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* na VPS as variáveis vêm do ambiente */ }

const args = process.argv.slice(2);
const iLocal = args.indexOf("--local");
const PASTA = resolve(iLocal >= 0 ? args[iLocal + 1] : process.env.BACKUP_PASTA ?? join(raiz, "..", "backups"));
const CHAVE = process.env.BACKUP_CHAVE;
if (!CHAVE || CHAVE.length < 16) {
  console.error("Defina BACKUP_CHAVE (16+ caracteres; ex.: openssl rand -base64 32) e guarde uma cópia fora do servidor.");
  process.exit(1);
}
const PG_DUMP = process.env.PG_DUMP ?? "pg_dump";
const conexao = {
  // BACKUP_PGHOST/BACKUP_PGUSER: o host direto db.<ref> é só IPv6 e a VPS não sai por IPv6;
  // lá se usa o pooler em modo sessão (aws-0-sa-east-1.pooler.supabase.com, usuário postgres.<ref>).
  PGHOST: process.env.BACKUP_PGHOST ?? `db.${process.env.SUPABASE_PROJECT_REF}.supabase.co`, PGPORT: "5432",
  PGUSER: process.env.BACKUP_PGUSER ?? "postgres",
  PGPASSWORD: process.env.SUPABASE_DB_PASSWORD, PGDATABASE: "postgres", PGSSLMODE: "require",
};

const hoje = new Date();
const dia = hoje.toISOString().slice(0, 10);
mkdirSync(PASTA, { recursive: true });

function dump(nome, extra) {
  const arquivo = join(PASTA, `${dia}-${nome}.dump`);
  return new Promise((ok, falha) => {
    const p = spawn(PG_DUMP, ["-Fc", "-Z", "6", "--no-owner", "--no-privileges", "-f", arquivo, ...extra],
      { env: { ...process.env, ...conexao }, stdio: ["ignore", "inherit", "pipe"] });
    let erro = "";
    p.stderr.on("data", (d) => { erro += d; });
    p.on("error", falha);
    p.on("close", (c) => (c === 0 ? ok(arquivo) : falha(new Error(`pg_dump ${nome} saiu com ${c}: ${erro.slice(-500)}`))));
  });
}

/** Formato do arquivo: "ARINIBK1" + sal(16) + iv(12) + dados cifrados + tag(16). */
async function cifrar(arquivo) {
  const sal = randomBytes(16), iv = randomBytes(12);
  const chave = scryptSync(CHAVE, sal, 32);
  const cifra = createCipheriv("aes-256-gcm", chave, iv);
  const destino = `${arquivo}.enc`;
  const saida = createWriteStream(destino);
  saida.write(Buffer.concat([Buffer.from("ARINIBK1"), sal, iv]));
  await pipeline(createReadStream(arquivo), cifra, saida, { end: false });
  saida.end(cifra.getAuthTag());
  await new Promise((ok) => saida.on("close", ok));
  unlinkSync(arquivo);
  return destino;
}

const t0 = Date.now();
const arquivos = [];
arquivos.push(await cifrar(await dump("public", ["-n", "public"])));
// contas e registro dos arquivos: só dados (a estrutura vem com o projeto Supabase novo)
arquivos.push(await cifrar(await dump("auth-storage", ["--data-only", "-n", "auth", "-n", "storage",
  "--exclude-table=auth.sessions", "--exclude-table=auth.refresh_tokens", "--exclude-table=auth.audit_log_entries"])));
for (const a of arquivos) console.log(`${a} · ${(statSync(a).size / 1e6).toFixed(1)} MB`);

// ---------------------------------------------------------------- envio e retenção
const r2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every((v) => process.env[v]);
const Bucket = process.env.R2_BUCKET_BACKUP ?? process.env.R2_BUCKET;
if (r2 && Bucket) {
  const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  for (const a of arquivos) {
    await s3.send(new PutObjectCommand({ Bucket, Key: `backups/banco/${dia}/${a.split(/[\\/]/).pop()}`, Body: readFileSync(a) }));
  }
  console.log(`enviado para r2://${Bucket}/backups/banco/${dia}/`);

  // retenção: 7 diários + domingos das últimas 4 semanas + dia 1 dos últimos 12 meses
  const dias = new Set();
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: "backups/banco/", ContinuationToken: token }));
    for (const o of r.Contents ?? []) dias.add(o.Key.split("/")[2]);
    token = r.NextContinuationToken;
  } while (token);
  const manter = (d) => {
    const dt = new Date(`${d}T12:00:00Z`), idade = (hoje - dt) / 86_400_000;
    return idade <= 7 || (dt.getUTCDay() === 0 && idade <= 31) || (dt.getUTCDate() === 1 && idade <= 366);
  };
  const apagar = [...dias].filter((d) => d && !manter(d));
  for (const d of apagar) {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `backups/banco/${d}/` }));
    const objs = (r.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (objs.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objs } }));
  }
  if (apagar.length) console.log(`retenção: ${apagar.length} dia(s) antigo(s) apagado(s)`);
} else {
  console.log("R2 não configurada: backup ficou só na pasta local (configure R2_* para a cópia externa).");
}
console.log(`backup concluído em ${Math.round((Date.now() - t0) / 1000)} s`);
