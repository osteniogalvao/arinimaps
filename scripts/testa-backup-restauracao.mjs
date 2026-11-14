// Requer initdb, pg_ctl, pg_dump, pg_restore e psql no PATH. Cria um cluster
// de teste em loopback com registros sintéticos e remove todo o diretório.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync, createCipheriv } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL(".", import.meta.url));
test("backup e recuperação do par com FK entre schemas, ACLs, RLS e gatilho de cadastro", async () => {
  const portaLivre = createServer();
  await new Promise((ok, falha) => portaLivre.once("error", falha).listen(0, "127.0.0.1", ok));
  const porta = String(portaLivre.address().port);
  await new Promise(ok => portaLivre.close(ok));
  const pasta = mkdtempSync(join(tmpdir(), "arini-teste-backup-"));
  const cluster = join(pasta, "db");
  const env = {
    ...process.env, BACKUP_PGHOST: "127.0.0.1", BACKUP_PGPORT: porta, BACKUP_PGUSER: "postgres",
    BACKUP_CHAVE: randomBytes(32).toString("base64"), PG_DUMP: "pg_dump", PG_RESTORE: "pg_restore", PSQL: "psql",
    PGHOST: "127.0.0.1", PGPORT: porta, PGUSER: "postgres", PGPASSWORD: "", PGDATABASE: "postgres", PGSSLMODE: "disable",
  };
  function executar(cmd, args, opcoes = {}) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", timeout: 60000, windowsHide: true, ...opcoes });
    assert.ifError(r.error);
    return r;
  }
  function ok(cmd, args) {
    const r = executar(cmd, args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  const sql = (banco, q) => ok("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", banco, "-c", q]);
  const gerenciado = `
    create schema auth; create schema storage;
    create table auth.schema_migrations(id int primary key);
    create table storage.migrations(id int primary key);
    insert into auth.schema_migrations values (1); insert into storage.migrations values (1);
    create table auth.users(id int primary key);
    create table storage.buckets(id int primary key);
    create table storage.objects(id int primary key, bucket_id int references storage.buckets);
  `;
  const recuperar = (partes, nome = "recuperacao") => [join(scripts,"backup-restaurar.mjs"), partes.public,
    "--par", partes.auth, "--destino", `postgresql://postgres@127.0.0.1:${porta}/${nome}`];
  let iniciado = false;
  try {
    ok("initdb", ["-D", cluster, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    const partida = executar("pg_ctl", ["-D", cluster, "-o", `-h 127.0.0.1 -p ${porta}`, "-l", join(pasta, "postgres.log"), "-w", "start"], { stdio: "ignore" });
    assert.equal(partida.status, 0);
    iniciado = true;
    sql("postgres", "create role anon; create role authenticated; create role service_role;");
    for (const nome of ["postgres", "recuperacao", "incompativel", "resgate"]) {
      if (nome !== "postgres") sql("postgres", `create database ${nome}`);
      sql(nome, gerenciado);
    }
    sql("postgres", `
      create table public.profiles(user_id int primary key references auth.users);
      alter table public.profiles enable row level security;
      create policy logado on public.profiles for select to authenticated using (false);
      grant select on public.profiles to authenticated;
      create function public.fn_handle_new_user() returns trigger language plpgsql security definer as $$
      begin insert into public.profiles values(new.id); return new; end $$;
      revoke all on function public.fn_handle_new_user() from public, anon, authenticated;
      grant execute on function public.fn_handle_new_user() to service_role;
      create trigger trg_on_auth_user_created after insert on auth.users for each row execute function public.fn_handle_new_user();
      insert into auth.users values (1); insert into storage.buckets values(1); insert into storage.objects values(1,1);
    `);
    const dump = (rodada) => {
      const dir = join(pasta, rodada);
      ok(process.execPath, [join(scripts, "backup.mjs"), "--local", dir]);
      const geracao = join(dir,readdirSync(dir)[0]);
      const arquivos = readdirSync(geracao);
      return { public: join(geracao, arquivos.find(n => n.endsWith("-public.dump.enc"))),
        auth: join(geracao, arquivos.find(n => n.endsWith("-auth-storage.dump.enc"))) };
    };
    // Demonstra a falha do roteiro antigo: o perfil não tem a conta no destino.
    const legado = join(pasta, "public-legado.dump");
    ok("pg_dump", ["-Fc", "-n", "public", "--no-privileges", "-f", legado]);
    sql("recuperacao","drop schema public");
    const tentativa = executar("pg_restore", ["-e", "-1", "-d", "recuperacao", legado], { env: { ...env, LC_ALL: "C", LC_MESSAGES: "C" } });
    assert.notEqual(tentativa.status, 0); assert.match(tentativa.stderr, /foreign key constraint|chave estrangeira/i);
    sql("recuperacao","create schema public; grant usage on schema public to public");
    const contasLegadas = join(pasta, "auth-legado.dump");
    ok("pg_dump", ["-Fc", "--data-only", "-n", "auth", "-n", "storage", "--no-privileges", "-f", contasLegadas]);
    const extrair = (original, alvo) => {
      const sal = randomBytes(16), iv = randomBytes(12);
      const cifra = createCipheriv("aes-256-gcm", scryptSync(env.BACKUP_CHAVE, sal, 32), iv);
      const enc = Buffer.concat([Buffer.from("ARINIBK1"), sal, iv, cifra.update(readFileSync(original)), cifra.final(), cifra.getAuthTag()]);
      writeFileSync(original + ".enc", enc);
      ok(process.execPath, [join(scripts, "backup-restaurar.mjs"), original + ".enc", "--extrair-legado", alvo]);
    };
    const dirPublic = join(pasta,"legado-public"), dirAuth = join(pasta,"legado-auth");
    extrair(legado,dirPublic); extrair(contasLegadas,dirAuth);
    ok("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-1", "-d", "resgate", "-f", join(dirAuth, "auth-storage-dados.sql"),
      "-f", join(dirPublic, "pre-data.sql"), "-f", join(dirPublic, "public-dados.sql"), "-f", join(dirPublic, "post-data.sql")]);
    assert.equal(sql("resgate", "select (select count(*) from public.profiles), (select count(*) from storage.objects)"), "1|1");
    assert.equal(sql("resgate","select has_function_privilege('anon','public.fn_handle_new_user()','execute')"), "t");
    const a = dump("par-a"), b = dump("par-b");
    for (const arquivo of [a.public, a.auth]) ok(process.execPath, [join(scripts,"backup-restaurar.mjs"), arquivo, "--conferir"]);
    ok(process.execPath,[join(scripts,"backup-restaurar.mjs"),a.public,"--conferir-par",a.auth]);
    const misto = executar(process.execPath, recuperar({ public: a.public, auth: b.auth }));
    assert.notEqual(misto.status, 0); assert.match(misto.stderr, /mesmo snapshot/);
    sql("incompativel", "drop table storage.objects; create table storage.objects(coluna_incompativel int);");
    assert.notEqual(executar(process.execPath, recuperar(a,"incompativel")).status, 0);
    assert.equal(sql("incompativel","select count(*) from auth.users"), "0");
    ok(process.execPath, recuperar(a));
    assert.equal(sql("recuperacao",`select (select count(*) from auth.users), (select count(*) from public.profiles),
      (select count(*) from storage.objects), (select count(*) from storage.migrations), (select count(*) from auth.schema_migrations)`), "1|1|1|1|1");
    assert.equal(sql("recuperacao",`select has_function_privilege('anon','public.fn_handle_new_user()','execute'),
      has_function_privilege('authenticated','public.fn_handle_new_user()','execute'),
      has_function_privilege('service_role','public.fn_handle_new_user()','execute'),
      has_table_privilege('authenticated','public.profiles','select'), (select relrowsecurity from pg_class where oid='public.profiles'::regclass)`), "f|f|t|t|t");
    assert.match(sql("recuperacao","set role authenticated; select count(*) from public.profiles"), /(?:^|\n)0$/);
    sql("recuperacao","create function public.futura() returns int language sql as 'select 42'");
    assert.equal(sql("recuperacao",`select has_function_privilege('anon','public.futura()','execute'),
      has_function_privilege('authenticated','public.futura()','execute'), has_function_privilege('service_role','public.futura()','execute')`), "f|f|t");
    sql("recuperacao","insert into auth.users values (2)");
    assert.equal(sql("recuperacao","select count(*) from public.profiles"), "2");
    assert.notEqual(executar(process.execPath, recuperar(a)).status, 0);
  } finally {
    if (iniciado) ok("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
    rmSync(pasta, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
});
