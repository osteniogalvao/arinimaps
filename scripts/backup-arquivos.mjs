// Backup dos ARQUIVOS (fotos, vídeos, documentos, selfies, plantas) — o
// pg_dump só guarda o registro de cada arquivo, não o conteúdo.
//
// Cópia incremental de todos os buckets do Supabase Storage para a Cloudflare
// R2 (`backups/arquivos/<bucket>/<caminho>`): só sobe o que ainda não está lá
// ou teve a versão alterada. Arquivo apagado no Supabase é conservado por
// 30 dias (proteção contra exclusão por engano); depois sai.
// Os documentos e selfies vão para um bucket PRIVADO da R2, como estão no Supabase.
//
// Sem as variáveis da R2: modo ensaio (lista o que seria copiado).
// Variáveis: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_BACKUP (ou R2_BUCKET).
// Uso: node scripts/backup-arquivos.mjs
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

async function listar(supa, bucket, prefixo = "") {
  const saida = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supa.storage.from(bucket).list(prefixo, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`${bucket}/${prefixo}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`Resposta incompleta ao listar ${bucket}/${prefixo}`);
    for (const item of data) {
      const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
      if (item.id === null) saida.push(...await listar(supa, bucket, caminho)); // pasta
      else {
        const etag = item.metadata?.eTag ?? item.metadata?.etag;
        const versao = etag || item.version || item.updated_at
          ? JSON.stringify([item.id, etag, item.version, item.updated_at])
          : null;
        saida.push({ caminho, tamanho: item.metadata?.size, versao });
      }
    }
    if (data.length < 1000) break;
  }
  return saida;
}

const MANIFESTO = "backups/controle/arquivos-v1.json";
const PREFIXO = "backups/arquivos/";
const RETENCAO = 30 * 86_400_000;

async function lerManifesto(s3, Bucket) {
  let r;
  try {
    r = await s3.send(new GetObjectCommand({ Bucket, Key: MANIFESTO }));
  } catch (e) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return { arquivos: new Map() };
    throw e;
  }
  const salvo = JSON.parse(await r.Body.transformToString());
  if (salvo.formato !== 1 || !Array.isArray(salvo.arquivos) || !r.ETag) throw new Error("Manifesto de arquivos inválido");
  return { arquivos: new Map(salvo.arquivos), etag: r.ETag };
}

export async function copiarArquivos(supa, s3, Bucket, agora = Date.now()) {
  // Leia o estado antes da origem. A gravação condicional impede um inventário
  // que rodou em paralelo de substituir as datas de ausência mais recentes.
  const anterior = s3 ? await lerManifesto(s3, Bucket) : { arquivos: new Map() };
  const vivos = new Map();
  for (let offset = 0; ; offset += 100) {
    const { data: buckets, error } = await supa.storage.listBuckets({ limit: 100, offset, sortColumn: "name", sortOrder: "asc" });
    if (error) throw error;
    if (!Array.isArray(buckets)) throw new Error("Resposta incompleta ao listar os buckets");
    for (const b of buckets) {
      const arquivos = await listar(supa, b.name);
      for (const a of arquivos) vivos.set(`${PREFIXO}${b.name}/${a.caminho}`, { ...a, bucket: b.name });
      console.log(`${b.name}: ${arquivos.length} arquivos`);
    }
    if (buckets.length < 100) break;
  }
  if (!s3) {
    console.log("ENSAIO: R2 não configurada — nada copiado.");
    return;
  }
  const copia = new Map();
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: PREFIXO, ContinuationToken: token }));
    for (const o of r.Contents ?? []) copia.set(o.Key, o);
    token = r.NextContinuationToken;
    if (r.IsTruncated && !token) throw new Error("Listagem do destino ficou incompleta");
  } while (token);

  const registros = new Map();
  let enviados = 0;
  for (const [chave, a] of vivos) {
    const antigo = anterior.arquivos.get(chave);
    const objeto = copia.get(chave);
    if (a.versao && antigo?.versao === a.versao && antigo.etag && antigo.etag === objeto?.ETag) {
      registros.set(chave, { versao: a.versao, etag: objeto.ETag });
      continue;
    }
    const { data, error } = await supa.storage.from(a.bucket).download(a.caminho, {}, { cache: "no-store" });
    if (error || !data) throw new Error(`Falha no download de ${a.bucket}/${a.caminho}: ${error?.message ?? "resposta vazia"}`);
    const corpo = Buffer.from(await data.arrayBuffer());
    if (a.tamanho != null && corpo.length !== Number(a.tamanho)) throw new Error(`Tamanho mudou na leitura de ${chave}`);
    const salvo = await s3.send(new PutObjectCommand({ Bucket, Key: chave, Body: corpo, ContentType: data.type || undefined }));
    if (!salvo.ETag) throw new Error(`Upload sem ETag para ${chave}`);
    registros.set(chave, { versao: a.versao, etag: salvo.ETag });
    enviados++;
  }

  const vencidos = [];
  for (const [chave, objeto] of copia) {
    if (vivos.has(chave)) continue;
    if (!objeto.ETag) throw new Error(`Objeto sem ETag na listagem de ${chave}`);
    const antigo = anterior.arquivos.get(chave);
    // Um arquivo legado ou substituído começa a contar na primeira ausência
    // observada. A idade do upload é independente da data em que a origem sumiu.
    const ausenteDesde = antigo?.etag === objeto.ETag && Number.isFinite(antigo.ausenteDesde)
      ? antigo.ausenteDesde : agora;
    registros.set(chave, { etag: objeto.ETag, ausenteDesde });
    if (agora - ausenteDesde >= RETENCAO) vencidos.push(objeto);
  }
  const confirmados = [];
  for (const o of vencidos) {
    const rel = o.Key.slice(PREFIXO.length);
    const barra = rel.indexOf("/");
    if (barra < 1) throw new Error(`Caminho de backup inesperado: ${o.Key}`);
    const { data, error } = await supa.storage.from(rel.slice(0, barra)).exists(rel.slice(barra + 1));
    if (data === true) {
      registros.set(o.Key, { etag: o.ETag });
      continue;
    }
    const status = Number(error?.statusCode ?? error?.status ?? error?.originalError?.status);
    if (data !== false || (error && ![400, 404].includes(status))) throw error ?? new Error("Falha ao confirmar ausência na origem");
    confirmados.push(o);
  }
  await s3.send(new PutObjectCommand({
    Bucket, Key: MANIFESTO, ContentType: "application/json",
    Body: JSON.stringify({ formato: 1, arquivos: [...registros] }),
    ...(anterior.etag ? { IfMatch: anterior.etag } : { IfNoneMatch: "*" }),
  }));
  for (const o of confirmados) {
    await s3.send(new DeleteObjectCommand({ Bucket, Key: o.Key, IfMatch: o.ETag }));
  }
  console.log(`${enviados} arquivo(s) copiado(s) · ${confirmados.length} removido(s) da cópia`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    for (const l of readFileSync(join(raiz, ".env.local"), "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ambiente */ }
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
  const Bucket = process.env.R2_BUCKET_BACKUP ?? process.env.R2_BUCKET;
  const configurado = Bucket && ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every((v) => process.env[v]);
  const s3 = configurado ? new S3Client({
    region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  }) : null;
  await copiarArquivos(supa, s3, Bucket);
}
