import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

globalThis.AsyncLocalStorage = AsyncLocalStorage;
const jiti = createJiti(import.meta.url, { fsCache: false, alias: {
  "@": fileURLToPath(new URL("../src", import.meta.url)),
  "server-only": fileURLToPath(new URL("../node_modules/server-only/empty.js", import.meta.url)),
} });
const { lerArquivos } = await jiti.import("../src/lib/cartografia/servidor.ts");
const { limitarFluxo, CorpoMuitoGrande } = await jiti.import("../src/lib/seguranca/corpo-limitado.ts");
const { converterDxf } = await jiti.import("../src/lib/geo/dxf.ts");
const { POST: whatsapp } = await jiti.import("../src/app/api/webhooks/whatsapp/route.ts");
const { GET: feed } = await jiti.import("../src/app/api/feeds/portais/route.ts");
const { config } = await jiti.import("../src/proxy.ts");
const { unstable_doesMiddlewareMatch } = await jiti.import("next/experimental/testing/server");

for (const [nome, conteudo, valido] of [
  ["planta.pdf", "<html><script>1</script></html>", false],
  ["foto.jpeg", "%PDF-1.3", false],
  ["planta.pdf", "%PDF-1.7", true],
  ["terreno.kmz", Uint8Array.of(80,75,3,4), true],
  ["terreno.kml", "<?xml version='1.0'?><kml/>", true],
  ["terreno.kml", "<?xml version='1.0'?><root/>", false],
  ["terreno.kml", "<?xml-stylesheet type='text/xsl' href='arquivo.xsl'?><kml/>", false],
  ["terreno.dxf", "AutoCAD Binary DXF\r\n\x1a\0", true],
]) {
  const formulario = new FormData();
  formulario.append("arquivos", new File([conteudo], nome));
  assert.equal((await lerArquivos(formulario)).erro === null, valido, nome);
}

const dxf = new TextEncoder().encode("0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n-50\n20\n-20\n11\n-50.001\n21\n-20.001\n0\nENDSEC\n0\nEOF\n");
function fragmentos(bytes) {
  return new ReadableStream({ start(c) {
    c.enqueue(bytes.subarray(0, 7));
    c.enqueue(bytes.subarray(7));
    c.close();
  } });
}
assert.equal((await converterDxf(limitarFluxo(fragmentos(dxf), dxf.length))).linhas, 1);
await assert.rejects(converterDxf(limitarFluxo(fragmentos(dxf), dxf.length - 1)), CorpoMuitoGrande);

process.env.WHATSAPP_APP_SECRET = "segredo-sintetico";
const endpoint = "https://example.invalid/api/webhooks/whatsapp";
assert.equal(unstable_doesMiddlewareMatch({ config, url: endpoint }), false);
assert.equal(unstable_doesMiddlewareMatch({ config, url: "https://example.invalid/api/webhooks/whatsappextra" }), true);
assert.equal((await whatsapp({ headers: new Headers(), get body() { throw Error("corpo lido sem assinatura"); } })).status, 401);
const bytes = new TextEncoder().encode('{"entry":[],"texto":"área ção"}');
const assinatura = "sha256=" + createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(bytes).digest("hex");
function evento(conteudo, sig = assinatura) {
  return new Request(endpoint, { method:"POST", body:fragmentos(conteudo), duplex:"half", headers:{"x-hub-signature-256":sig} });
}
assert.equal((await whatsapp(evento(new Uint8Array(8 * 1024 * 1024 + 1)))).status, 413);
assert.equal((await whatsapp(evento(bytes, "sha256=" + "0".repeat(64)))).status, 401);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://qa.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "segredo-sintetico";
const consultas = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  assert.equal(u.hostname, "qa.invalid");
  if (u.pathname.endsWith("/properties")) consultas.push(u.searchParams.get("publicacoes.canal"));
  else assert.equal(u.pathname, "/rest/v1/settings");
  return Response.json([]);
};
assert.equal((await whatsapp(evento(bytes))).status, 200);
function catalogo(canal) {
  return feed(new Request("https://example.invalid/api/feeds/portais?canal=" + canal, {headers:{"x-real-ip":"192.0.2.11"}}));
}
const primeiros = await Promise.all([catalogo("site"),catalogo("site"),catalogo("portais")]);
assert.deepEqual(consultas.sort(), ["eq.portais","eq.site"]);
for (const resposta of primeiros) {
  assert.equal(resposta.status, 200);
  assert.match(await resposta.text(), /<Listings>/);
}
for (let i = 3; i < 60; i++) assert.equal((await catalogo("site")).status, 200);
assert.equal((await catalogo("site")).status, 429);
console.log("Anexos, DXF em fluxo, assinatura e limite do WhatsApp e carga do feed conferidos.");
