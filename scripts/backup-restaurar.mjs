// Restauração do backup (roadmap 1.6 e 9.6).
//
//   node scripts/backup-restaurar.mjs <arquivo.dump.enc> --conferir
//       decifra e confere o arquivo (integridade AES-GCM e leitura integral pelo pg_restore),
//       sem gravar em banco nenhum. Rodar todo mês: backup que não abre não é backup.
//   node scripts/backup-restaurar.mjs <public.dump.enc> --destino <postgres://...>
//       restaura num banco VAZIO com PostGIS (projeto Supabase novo ou o container
//       postgis/postgis na VPS). Nunca na homologação: lá não entra dado real (LGPD).
//
// Variáveis: BACKUP_CHAVE (a mesma do backup), PG_RESTORE (caminho, se não estiver no PATH).
import { createDecipheriv, scryptSync } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync, createReadStream, createWriteStream, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const l of readFileSync(join(raiz, ".env.local"), "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* ambiente */ }
const [arquivo, ...resto] = process.argv.slice(2);
const destino = resto[0] === "--destino" && resto.length === 2 ? resto[1] : undefined;
const conferir = resto.length === 0 || (resto.length === 1 && resto[0] === "--conferir");
const PG_RESTORE = process.env.PG_RESTORE ?? "pg_restore";
if (!arquivo || !process.env.BACKUP_CHAVE || (!conferir && !destino)) {
  console.error("uso: backup-restaurar.mjs <arquivo.enc> --conferir | --destino <url> (com BACKUP_CHAVE)");
  process.exit(1);
}

function executarRestore(args, capturar = false) {
  const r = spawnSync(PG_RESTORE, args, { encoding: "utf8", stdio: ["ignore", capturar ? "pipe" : "ignore", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new Error(`Falha ao iniciar pg_restore (${r.error.code ?? "erro"})`);
  if (r.status !== 0) throw new Error(`pg_restore falhou (${r.status ?? r.signal}): ${(r.stderr ?? "").slice(-1000)}`);
  return r.stdout;
}

// Cabeçalho "ARINIBK1" + sal(16) + iv(12); tag(16) no fim.
const tamanho = statSync(arquivo).size;
if (tamanho <= 52) throw new Error("Arquivo de backup incompleto");
const fd = openSync(arquivo, "r");
const cab = Buffer.alloc(36), tag = Buffer.alloc(16);
try {
  if (readSync(fd, cab, 0, cab.length, 0) !== cab.length ||
      readSync(fd, tag, 0, tag.length, tamanho - tag.length) !== tag.length ||
      cab.subarray(0, 8).toString() !== "ARINIBK1") throw new Error("Cabeçalho de backup inválido");
} finally {
  closeSync(fd);
}
const decifra = createDecipheriv("aes-256-gcm", scryptSync(process.env.BACKUP_CHAVE, cab.subarray(8, 24), 32), cab.subarray(24, 36));
decifra.setAuthTag(tag);
const pasta = mkdtempSync(join(tmpdir(), "arini-restore-"));
const dump = join(pasta, "backup.dump");
try {
  await pipeline(createReadStream(arquivo, { start: 36, end: tamanho - 17 }), decifra,
    createWriteStream(dump, { flags: "wx", mode: 0o600 }));
  if (destino) {
    const itens = executarRestore(["--list", dump], true);
    // pg_dump -n public inclui CREATE SCHEMA public. O banco novo já tem esse
    // esquema. Omita somente essa entrada, mantendo erros de tabelas e dados.
    const lista = join(pasta, "itens.list");
    writeFileSync(lista, itens.split("\n").filter(l => !/^\d+;\s+\d+\s+\d+\s+SCHEMA - public(?:\s|$)/.test(l)).join("\n"));
    executarRestore(["--use-list", lista, "--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", "-d", destino, dump]);
    console.log("Restauração concluída.");
  } else {
    // --list lê só o índice. Materializar o SQL inteiro no dispositivo nulo
    // também verifica que o conteúdo comprimido de cada tabela é legível.
    executarRestore(["--file", devNull, dump]);
    console.log("Backup decifrado e lido integralmente pelo pg_restore.");
  }
} finally {
  rmSync(pasta, { recursive: true, force: true });
}
