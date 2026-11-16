import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { PDFDocument } from "pdf-lib";

const pasta = mkdtempSync(join(tmpdir(), "arini-pdf-area-"));
const mock = (nome, codigo) => {
  const caminho = join(pasta, nome + ".cjs");
  writeFileSync(caminho, codigo);
  return caminho;
};
try {
  const jiti = createJiti(import.meta.url, { fsCache:false, alias:{
    "@":fileURLToPath(new URL("../src", import.meta.url)),
    "server-only":fileURLToPath(new URL("../node_modules/server-only/empty.js", import.meta.url)),
    "@/lib/supabase/server":mock("sessao", "exports.currentUser = async () => globalThis.qaArea.userId && {id:globalThis.qaArea.userId}"),
    "@/lib/supabase/admin":mock("banco", "exports.supabaseAdmin = () => globalThis.qaArea.db"),
    "@/lib/planos-servidor":mock("acesso", "exports.acessoAtual = async () => globalThis.qaArea"),
    "@/lib/geo/limiteMemoria":mock("limite", "exports.limiteLeituraMapa = async () => null"),
  }});
  const {GET} = await jiti.import("../src/app/api/consulta/area/[chave]/relatorio/route.ts");
  const {chaveCacheConsulta} = await jiti.import("../src/lib/geo/consultaArea.ts");
  const id = "a".repeat(40);
  const area = {area_ha:2, municipio:"Sintético", created_at:"2026-11-16", geometry:{
    type:"Polygon", coordinates:[[[0,0],[0,1],[1,0],[0,0]]],
  }};
  const lidas = [];
  const db = {
    rpc(nome, args) {
      assert.equal(nome,"fn_ler_area_propria");
      assert.equal(args.p_chave,"geo:"+id);
      return {data:["titular-a","titular-b"].includes(args.p_user) ? area : null, error:null};
    },
    from(tabela) {
      if (tabela === "fontes_externas") return { select:() => ({ order:() => ({data:[{id:"anm",nome:"ANM",orgao:"ANM",ativa:true,tipo:"arcgis"}]}) }) };
      assert.equal(tabela,"consultas_area");
      const filtros = {};
      const consulta = {
        eq(nome, valor) { filtros[nome]=valor; return consulta; },
        then(resolve) { lidas.push(filtros); resolve({data:[]}); },
      };
      return {select:() => consulta};
    },
  };
  const acesso = {recursos:new Set(["consulta_area","relatorio_territorial"]), cotas:{}};
  globalThis.qaArea = {userId:null, acesso, db};
  async function pedir(opcoes) {
    return GET(new Request("https://example.invalid/api/consulta/area/"+id+"/relatorio?"+opcoes), {params:Promise.resolve({chave:id})});
  }
  const completo = "modelo=completo&personalizar=1&secao=fontes&raio_m=5000";
  assert.equal((await pedir(completo)).status,401);
  globalThis.qaArea.userId = "outra-conta";
  assert.equal((await pedir(completo)).status,404);
  assert.equal(lidas.length,0);
  globalThis.qaArea.userId = "titular-a";
  acesso.recursos.delete("relatorio_territorial");
  assert.equal((await pedir(completo)).status,403);
  assert.equal((await pedir("personalizar=1&secao=fontes")).status,400);
  assert.equal((await pedir("personalizar=1&secao=cadastro")).status,200);
  acesso.recursos.add("relatorio_territorial");
  for (const titular of ["titular-a","titular-b"]) {
    globalThis.qaArea.userId = titular;
    const r = await pedir(completo);
    assert.equal(r.status,200);
    assert.equal(r.headers.get("cache-control"),"private, no-store");
    assert.equal((await PDFDocument.load(await r.arrayBuffer())).getPageCount(),1);
    assert.deepEqual(lidas.at(-1), {chave:chaveCacheConsulta("geo:"+id,titular),raio_m:5000});
  }
  assert.notEqual(lidas[0].chave,lidas[1].chave);
  assert.notEqual(lidas[0].chave,"geo:"+id);
  assert.equal(chaveCacheConsulta("car:exemplo","titular-a"),"car:exemplo");
  console.log("PDF privado: sessão, titular, plano, seções e cache separado para dois autores da mesma geometria.");
} finally {
  delete globalThis.qaArea;
  rmSync(pasta,{recursive:true,force:true});
}
