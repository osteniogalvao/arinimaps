import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { copiarArquivos } from "./backup-arquivos.mjs";

const arquivo = "backups/arquivos/media/planta";
const dia = 86_400_000;
const etag = (v) => createHash("sha256").update(v).digest("hex");

function ambiente() {
  const estado = { corpo: "abc", versao: 1, falharDownload: false, objetos: new Map(), enviados: 0 };
  const supa = { storage: {
    listBuckets: async () => ({ data: [{ name: "media" }] }),
    from: () => ({
      list: async () => ({ data: estado.corpo === null ? [] : [{
        name: "planta", id: "id", updated_at: String(estado.versao), metadata: { size: estado.corpo.length },
      }] }),
      download: async () => estado.falharDownload ? { error: new Error("offline") } : { data: new Blob([estado.corpo]) },
      exists: async () => ({ data: estado.reapareceu || estado.corpo !== null }),
    }),
  } };
  const s3 = { send: async (command) => {
    const { Bucket, Key, Prefix, IfMatch, IfNoneMatch, Body } = command.input;
    assert.equal(Bucket, "bucket-configurado");
    const obj = estado.objetos.get(Key);
    switch (command.constructor.name) {
      case "ListObjectsV2Command":
        return { Contents: [...estado.objetos.keys()].filter(k => k.startsWith(Prefix))
          .map(Key => ({ Key, ETag: etag(estado.objetos.get(Key)), LastModified: new Date(0) })) };
      case "GetObjectCommand":
        if (obj === undefined) throw Object.assign(new Error(), { name: "NoSuchKey" });
        return { ETag: etag(obj), Body: { transformToString: () => obj } };
      case "PutObjectCommand":
        if (IfMatch) assert.equal(IfMatch, etag(obj));
        if (IfNoneMatch === "*") assert.equal(obj, undefined);
        if (Key === arquivo) estado.enviados++;
        estado.objetos.set(Key, Buffer.from(Body).toString());
        return { ETag: etag(Body) };
      case "DeleteObjectCommand":
        assert.equal(IfMatch, etag(obj));
        if (estado.falharExclusao) throw new Error("Exclusão indisponível");
        estado.objetos.delete(Key);
        return {};
      default: assert.fail(command.constructor.name);
    }
  } };
  return { estado, rodar: (d) => copiarArquivos(supa, s3, "bucket-configurado", d * dia) };
}

test("incremental detecta mesma quantidade de bytes e retém por 30 dias após a última exclusão", async () => {
  const { estado, rodar } = ambiente();
  await rodar(1);
  await rodar(2);
  assert.equal(estado.enviados, 1);
  estado.corpo = "xyz"; estado.versao++;
  await rodar(3);
  assert.equal(estado.objetos.get(arquivo), "xyz");
  estado.corpo = null;
  await rodar(100);
  await rodar(129);
  assert.ok(estado.objetos.has(arquivo));
  estado.corpo = "xyz";
  await rodar(130);
  estado.corpo = null;
  await rodar(131);
  await rodar(160);
  assert.ok(estado.objetos.has(arquivo));
  await rodar(161);
  assert.ok(!estado.objetos.has(arquivo));
});

test("arquivo legado ausente ganha 30 dias a partir do primeiro inventário", async () => {
  const { estado, rodar } = ambiente();
  estado.objetos.set(arquivo, "abc"); estado.corpo = null;
  await rodar(100);
  await rodar(129);
  assert.ok(estado.objetos.has(arquivo));
  await rodar(130);
  assert.ok(!estado.objetos.has(arquivo));
});

test("falha de download propaga erro e preserva objeto e manifesto anteriores", async () => {
  const { estado, rodar } = ambiente();
  await rodar(1);
  const antes = new Map(estado.objetos);
  estado.corpo = "xyz"; estado.versao++; estado.falharDownload = true;
  await assert.rejects(rodar(50), /Falha no download/);
  assert.deepEqual(estado.objetos, antes);
  estado.falharDownload = false;
  await rodar(51);
  assert.equal(estado.objetos.get(arquivo), "xyz");
});

test("retorno do arquivo entre listagem e exclusão reinicia a retenção, e erro de exclusão permite nova tentativa", async () => {
  const { estado, rodar } = ambiente();
  await rodar(1);
  estado.corpo = null;
  await rodar(2);
  estado.reapareceu = true;
  await rodar(32);
  estado.reapareceu = false;
  await rodar(33);
  await rodar(62);
  assert.ok(estado.objetos.has(arquivo));
  estado.falharExclusao = true;
  await assert.rejects(rodar(63), /Exclusão indisponível/);
  assert.ok(estado.objetos.has(arquivo));
  estado.falharExclusao = false;
  await rodar(64);
  assert.ok(!estado.objetos.has(arquivo));
});
