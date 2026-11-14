// Conferência integral ou recuperação transacional do par no Supabase vazio.
// Preparação do destino, recuperação de arquivos e cópias legadas em docs/BACKUP.md.
import { createDecipheriv, scryptSync } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, fstatSync, createReadStream, createWriteStream, mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const linha of readFileSync(join(raiz, ".env.local"), "utf8").split("\n")) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* ambiente */ }

const [arquivo, ...resto] = process.argv.slice(2);
const conferir = !resto.length || (resto[0] === "--conferir" && resto.length === 1);
const conferirPar = resto[0] === "--conferir-par" && resto.length === 2;
const extracao = resto.length === 2 && resto[0] === "--extrair-legado" ? resto[1] : undefined;
const destino = resto.length === 4 && resto[0] === "--par" && resto[2] === "--destino" ? resto[3] : undefined;
const PG_RESTORE = process.env.PG_RESTORE || "pg_restore";
if (!arquivo || !process.env.BACKUP_CHAVE || (!conferir && !conferirPar && !destino && !extracao)) {
  console.error("Uso com BACKUP_CHAVE: <arquivo.enc> --conferir | <public.enc> --conferir-par <auth-storage.enc> | <public.enc> --par <auth-storage.enc> --destino <url do banco vazio> | <legado.enc> --extrair-legado <nova-pasta-privada>.");
  process.exit(1);
}

function executar(bin, args, capturar = false) {
  const r = spawnSync(bin, args, { encoding: "utf8", stdio: ["ignore", capturar ? "pipe" : "ignore", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new Error(`Falha ao iniciar ${bin} (${r.error.code ?? "erro"})`);
  // Erros de COPY podem conter o registro completo, inclusive credenciais e dados pessoais.
  if (r.status !== 0) {
    const codigo = r.stderr?.match(/\b(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/i)?.[1];
    throw new Error(`${bin} falhou (${r.status ?? r.signal}${codigo ? ", SQLSTATE " + codigo : ""}). Confira a versão, o destino vazio, as extensões e os privilégios descritos em docs/BACKUP.md.`);
  }
  return r.stdout;
}

async function decifrar(caminho, dump) {
  const fd = openSync(caminho, "r");
  const cab = Buffer.alloc(36), tag = Buffer.alloc(16);
  try {
    const tamanho = fstatSync(fd).size;
    if (tamanho <= 52 || readSync(fd, cab, 0, cab.length, 0) !== cab.length ||
        readSync(fd, tag, 0, tag.length, tamanho - tag.length) !== tag.length) throw new Error("Backup incompleto");
    const versao = cab.toString("ascii", 0, 8);
    if (!["ARINIBK1", "ARINIBK2"].includes(versao)) throw new Error("Cabeçalho de backup inválido");
    const sal = cab.subarray(8, 24);
    const cifra = createDecipheriv("aes-256-gcm", scryptSync(process.env.BACKUP_CHAVE, sal, 32), cab.subarray(24));
    if (versao === "ARINIBK2") cifra.setAAD(cab);
    cifra.setAuthTag(tag);
    await pipeline(createReadStream(caminho, { fd, autoClose: false, start: 36, end: tamanho - 17 }), cifra,
      createWriteStream(dump, { flags: "wx", mode: 0o600 }));
    return { versao, id: sal.toString("hex") };
  } finally {
    closeSync(fd);
  }
}

// O destino já traz seus históricos de migração e schemas da plataforma.
// Recusar contas existentes também impede disparar gatilhos da aplicação no meio da cópia.
const preparar = `
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'Restore as role postgres (application owner and default privileges subject)';
  end if;
  if to_regclass('public.profiles') is not null or
     exists (select from auth.users) or exists (select from storage.buckets) or
     exists (select from storage.objects) or
     exists (select from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'trg_on_auth_user_created') then
    raise exception 'Destination already contains ARINI data or signup trigger';
  end if;
end $$;
-- Global default privileges from migration 0046 are outside the public schema.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres grant execute on functions to service_role;
`;
const finalizar = `
-- Trigger from migration 0001 belongs to auth, outside the public snapshot.
create trigger trg_on_auth_user_created after insert on auth.users
  for each row execute function public.fn_handle_new_user();
do $$ begin
  if has_function_privilege('anon', 'public.fn_handle_new_user()', 'execute') or
     has_function_privilege('authenticated', 'public.fn_handle_new_user()', 'execute') then
    raise exception 'Unexpected execute privilege on signup function';
  end if;
end $$;
`;

const pasta = mkdtempSync(join(tmpdir(), "arini-restore-"));
try {
  const principal = join(pasta, "public.dump");
  const primeiro = await decifrar(arquivo, principal);
  if (conferir) {
    executar(PG_RESTORE, ["--file", devNull, principal]);
    console.log("Backup autenticado e lido integralmente pelo pg_restore.");
  } else if (extracao) {
    if (primeiro.versao !== "ARINIBK1") throw new Error("Use o par autenticado para cópias do formato atual.");
    if (existsSync(extracao)) throw new Error("A extração requer uma pasta nova.");
    const itens = executar(PG_RESTORE, ["--list", principal], true);
    const geridos = / TABLE DATA auth users /.test(itens) && / TABLE DATA storage objects /.test(itens);
    if (!geridos && !/ TABLE DATA public profiles /.test(itens)) throw new Error("Arquivo legado de conteúdo desconhecido.");
    mkdirSync(extracao, { mode: 0o700 });
    try {
      // O destino reconstruído deve manter suas próprias versões da plataforma e migrações.
      const lista = join(pasta, "dados.list");
      writeFileSync(lista, itens.split("\n").filter(l => !/ TABLE DATA (?:auth schema_migrations|storage migrations|public _migrations) /.test(l)).join("\n"));
      const dados = join(extracao, geridos ? "auth-storage-dados.sql" : "public-dados.sql");
      writeFileSync(dados, "", { flag: "wx", mode: 0o600 });
      executar(PG_RESTORE, ["--data-only", "--no-owner", "--no-privileges", "--use-list", lista, "--file", dados, principal]);
      if (!geridos) {
        // Em staging descartável, criar FKs e índices depois das linhas evita
        // falhas em referências circulares. A segurança virá das migrations.
        for (const secao of ["pre-data", "post-data"]) {
          const esquema = join(extracao, secao + ".sql");
          writeFileSync(esquema, "", { flag: "wx", mode: 0o600 });
          const semSchema = join(pasta, "esquema.list");
          writeFileSync(semSchema, itens.split("\n").filter(l => !/^\d+;\s+\d+\s+\d+\s+SCHEMA - public(?:\s|$)/.test(l)).join("\n"));
          executar(PG_RESTORE, ["--section", secao, "--no-owner", "--no-privileges", "--use-list", semSchema, "--file", esquema, principal]);
        }
      }
      console.log("Dados legados extraídos sem gravar em banco. A pasta privada agora contém dados em claro.");
    } catch (e) {
      rmSync(extracao, { recursive: true, force: true });
      throw e;
    }
  } else {
    if (primeiro.versao !== "ARINIBK2") throw new Error("Dump legado sem ACLs e snapshot do par. Recuperação isolada conforme docs/BACKUP.md.");
    const auth = join(pasta, "auth.dump");
    const segundo = await decifrar(resto[1], auth);
    if (segundo.versao !== primeiro.versao || segundo.id !== primeiro.id) throw new Error("Os arquivos não pertencem ao mesmo snapshot.");
    const itens = executar(PG_RESTORE, ["--list", principal], true);
    const contas = executar(PG_RESTORE, ["--list", auth], true);
    if (!/ TABLE DATA public profiles /.test(itens) || !/ TABLE DATA auth users /.test(contas) ||
        !/ TABLE DATA storage objects /.test(contas) || !/ ACL .*FUNCTION /.test(itens))
      throw new Error("Par inválido ou sem os privilégios de função da aplicação.");
    if (conferirPar) {
      executar(PG_RESTORE, ["--file", devNull, auth]);
      executar(PG_RESTORE, ["--file", devNull, principal]);
      console.log("Par autenticado do mesmo snapshot. Os dois dumps foram lidos integralmente.");
    } else {
      // O destino fornece CREATE SCHEMA public. Aplicar também as ACLs registradas para o schema.
      const lista = join(pasta, "itens.list");
      writeFileSync(lista, itens.split("\n").filter(l => !/^\d+;\s+\d+\s+\d+\s+SCHEMA - public(?:\s|$)/.test(l)).join("\n"));
      const authSql = join(pasta, "gerenciado.sql"), publicSql = join(pasta, "public.sql");
      executar(PG_RESTORE, ["--no-owner", "--file", authSql, auth]);
      executar(PG_RESTORE, ["--no-owner", "--use-list", lista, "--file", publicSql, principal]);
      executar(process.env.PSQL || "psql", ["-X", "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose", "--single-transaction",
        "--dbname", destino, "-c", preparar, "-f", authSql, "-f", publicSql, "-c", finalizar]);
      console.log("Banco restaurado com contas, metadados, privilégios e gatilho de cadastro.");
    }
  }
} finally {
  rmSync(pasta, { recursive: true, force: true });
}
