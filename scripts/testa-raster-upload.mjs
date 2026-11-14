import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileFunction } from "node:vm";
import { randomUUID } from "node:crypto";
import pg from "pg";
import ts from "typescript";

const modulo = (fonte) => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(fonte, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString("base64");
const arquivos = modulo(await readFile(new URL("../src/lib/seguranca/arquivos.ts", import.meta.url), "utf8"));
const raster = (await readFile(new URL("../src/lib/cartografia/rasterUpload.ts", import.meta.url), "utf8"))
  .replace('"../seguranca/arquivos"', JSON.stringify(arquivos));
const { lerRaster, ErroRaster } = await import(modulo(raster));
const stream = (bytes) => new Blob([bytes]).stream();

test("TIFF e BigTIFF em ambas as ordens de bytes, PNG e JPEG recebem extensão e MIME pelo conteúdo", async () => {
  const exemplos = [
    [[0x49, 0x49, 42, 0, 8, 0, 0, 0], "tif", "image/tiff"],
    [[0x4d, 0x4d, 0, 42, 0, 0, 0, 8], "tif", "image/tiff"],
    [[0x49, 0x49, 43, 0, 8, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0], "tif", "image/tiff"],
    [[0x4d, 0x4d, 0, 43, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16], "tif", "image/tiff"],
    [[137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0], "png", "image/png"],
    [[255, 216, 255, 224, 0, 4, 0, 0, 255, 217], "jpg", "image/jpeg"],
  ];
  for (const [cab, ext, contentType] of exemplos) {
    const bytes = Uint8Array.from(cab);
    const r = await lerRaster(stream(bytes), bytes.length);
    assert.equal(r.ext, ext);
    assert.equal(r.contentType, contentType);
    assert.deepEqual(r.bytes, Buffer.from(bytes));
  }
});

test("tipo declarado e nome de arquivo não transformam texto em raster", async () => {
  const request = new Request("http://localhost/upload?arquivo=planta.tif", {
    method: "POST", headers: { "Content-Type": "image/tiff" }, body: "arquivo de texto de exemplo",
  });
  await assert.rejects(lerRaster(request.body, 1024), { status: 415 });
  await assert.rejects(lerRaster(stream(new Uint8Array()), 1024), { status: 415 });
});

test("corpo sem Content-Length é interrompido ao passar do limite e não consome o restante", async () => {
  let cancelado = false;
  let partes = 0;
  const corpo = new ReadableStream({
    pull(controller) { partes++; controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelado = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(lerRaster(corpo, 10), { status: 413 });
  assert.equal(cancelado, true);
  assert.equal(partes, 2);
});

test("falha do fluxo chega ao chamador e o bloqueio de leitura é liberado", async () => {
  const corpo = new ReadableStream({ pull(controller) { controller.error(new Error("envio interrompido")); } });
  await assert.rejects(lerRaster(corpo, 1024), /envio interrompido/);
  assert.equal(corpo.locked, false);
});

const rotaFonte = await readFile(new URL("../src/app/api/admin/cartografia/route.ts",import.meta.url),"utf8");
function rota(db) {
  const deps = {
    "next/server":{NextResponse:Response}, "@/lib/supabase/admin":{supabaseAdmin:()=>db}, "@/lib/audit":{logAudit:async()=>{}},
    "@/lib/authz":{ator:async()=>({userId:randomUUID()}),temSetor:()=>true},"@/lib/seguranca/origem":{conferirOrigem:()=>({ok:true})},
    "@/lib/geo/dxf":{converterDxf:async()=>({bbox:[0,0,1,1],centro:[0,0],zona:22,linhas:1,layersCad:[],diagnostico:{segundos:1},geojson:{type:"FeatureCollection",features:[]}})},
    "@/lib/geo/plantaPublica":{caminhoPlantaPublica:()=> "cartografia/publico/"+randomUUID()+".geojson"},
    "@/lib/geo/deslocar":{centroDe:()=>[0,0]}, "@/lib/cartografia/rasterUpload":{lerRaster,ErroRaster},
    "@/lib/erros":{falha:(status,codigo,error)=>Response.json({codigo,error},{status}),falhaBanco:(codigo,e)=>Response.json({codigo,error:e.message},{status:500})},
  };
  const js=ts.transpileModule(rotaFonte,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exp={};compileFunction(js,["require","exports"])(id=>deps[id],exp);return exp.POST;
}
test("erros de upload ou da fila não confirmam publicação e limpam as cópias novas",async()=>{
  const mun=randomUUID();
  const enviar=(db,nome)=>rota(db)(new Request("https://local.invalid/api?nome=Planta&arquivo="+nome+"&municipality_id="+mun,
    {method:"POST",body:Uint8Array.from([137,80,78,71,13,10,26,10])}));
  const erro={code:"23514",message:"job rejeitado"};
  for (const [nome,falhaNaCopia,bucket] of [["img.png",false,"docs"],["planta.dxf",false,"media"],["planta.dxf",true,"media"]]) {
    const salvos=new Set();let fila=0;
    const db={storage:{from:(b)=>{
      assert.equal(b,bucket);
      return {upload:async(path)=>{
        if(falhaNaCopia && salvos.size) return {error:erro};
        salvos.add(path);return {};
      },remove:async(paths)=>{for(const p of paths) salvos.delete(p);return {};}};
    }},rpc:async(fn)=>{
      if(fn==="fn_confere_planta") return {data:null};
      assert.equal(fn,nome.endsWith("dxf")?"fn_publicar_dxf":"fn_enfileirar_raster");fila++;return {error:erro};
    }};
    const r=await enviar(db,nome);
    assert.equal(r.ok,false);assert.equal(salvos.size,0);assert.equal(fila,falhaNaCopia?0:1);
  }
  assert.equal((await enviar({},"planta.dwg")).status,400);
});
test("perda da resposta depois do commit conserva o original de um raster enfileirado",async()=>{
  const mun=randomUUID(); let id;
  const db={storage:{from:b=>{assert.equal(b,"docs");return {upload:async()=>({}),remove:()=>assert.fail("original publicado não pode ser apagado")};}},
    rpc:async(fn,args)=>{assert.equal(fn,"fn_enfileirar_raster");id=args.p_layer_id;return {error:{code:"",message:"timeout"}};},
    from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id}})};return q;}};
  const r=await rota(db)(new Request("https://local.invalid/api?nome=Planta&arquivo=original.jpg&municipality_id="+mun,
    {method:"POST",body:Uint8Array.from([255,216,255,0,0,4,0,0])}));
  assert.equal(r.status,200);assert.equal((await r.json()).id,id);
});
const url=process.env.TEST_RASTER_PG_URL;
test("Postgres desfaz a camada raster e mantém a versão vetorial anterior quando o job não grava", {skip:!url}, async()=>{
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname));
  const db=new pg.Client({connectionString:url});await db.connect();
  const mun=randomUUID(),antiga=randomUUID(),rasterId=randomUUID(),novo=randomUUID();
  try {
    await db.query("begin");
    await db.query(`create role anon;create role authenticated;create role service_role;create table public.municipalities(id uuid primary key);
      create table public.cartography_layers(id uuid primary key,municipality_id uuid references public.municipalities(id),nome text,tipo text,source_path text,
        bytes bigint, tiles_path text,status text,min_zoom int,max_zoom int,opacidade_padrao numeric,diagnostico jsonb,publico_path text,publico_bytes bigint,publico_centro jsonb,
        edicoes_geometria jsonb default '[]',ajustes_locais jsonb default '[]',linhas_excluidas text[],layers_ocultos text[],pontos_controle jsonb,
        offset_leste_m numeric,offset_norte_m numeric,escala numeric,rotacao_graus numeric,datum text,espessura_linha numeric);
      create table public.urban_lots(layer_id uuid references public.cartography_layers on delete cascade);
      create table public.cartografia_lotes_excluidos(layer_id uuid references public.cartography_layers on delete cascade);
      create table public.jobs(tipo text,payload jsonb, constraint falha_teste check(false));`);
    await db.query(await readFile(new URL("../supabase/migrations/0082_cartografia_raster_fila.sql",import.meta.url),"utf8"));
    await db.query("insert into public.municipalities values($1)",[mun]);
    await db.query("insert into public.cartography_layers(id,municipality_id,tipo,source_path) values ($1,$2,'vector','cartografia/vetor/anterior.geojson')",[antiga,mun]);
    const imagem=()=>db.query("select public.fn_enfileirar_raster($1,$2,'imagem','png',8)",[rasterId,mun]);
    const vetor=()=>db.query("select public.fn_publicar_dxf($1,$2,'planta','original','publico',800,'[0,0]','{}')",[novo,mun]);
    for(const executar of [imagem,vetor]) {
      await db.query("savepoint tentativa");await assert.rejects(executar,{code:"23514"});await db.query("rollback to tentativa");
      assert.deepEqual((await db.query("select id from cartography_layers")).rows,[{id:antiga}]);
    }
    await db.query("alter table public.jobs drop constraint falha_teste");
    for (const sql of ["insert into public.urban_lots values($1)","insert into public.cartografia_lotes_excluidos values($1)",
      "update public.cartography_layers set edicoes_geometria='[{}]' where id=$1","update public.cartography_layers set source_path='manual' where id=$1"]) {
      await db.query("savepoint antiga"); await db.query(sql,[antiga]);await db.query("savepoint recusada");
      await assert.rejects(vetor,{code:"55000"});await db.query("rollback to recusada");
      assert.equal((await db.query("select count(*)::int n from cartography_layers where id=$1",[antiga])).rows[0].n,1);
      await db.query("rollback to antiga");
    }
    await imagem();await vetor();
    const {rows}=await db.query("select tipo,payload from jobs order by tipo");
    assert.deepEqual(rows,[{tipo:"gerar_lotes",payload:{layer_id:novo}},
      {tipo:"tile_raster",payload:{layer_id:rasterId,source_bucket:"docs",source_path:`raster/${mun}/${rasterId}.png`}}]);
    assert.deepEqual((await db.query("select id from cartography_layers order by tipo")).rows,[{id:rasterId},{id:novo}]);
  } finally {await db.query("rollback");await db.end();}
});
