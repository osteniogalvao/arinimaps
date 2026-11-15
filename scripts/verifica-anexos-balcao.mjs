import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileFunction } from "node:vm";
import ts from "typescript";
import { conferirArquivo, extensao, ACEITA } from "../src/lib/seguranca/arquivos.ts";
import { limparCofre } from "../worker/jobs/limparCofre.mjs";

// Rotas reais com autenticação simulada. As funções de acesso rodam no Postgres
// local; o adaptador do bucket grava bytes reais em uma pasta temporária.
export async function verificarAnexosBalcao(pool,org) {
  const sql=(q,v=[])=>pool.query(q,v), dono=crypto.randomUUID(),outro=crypto.randomUUID();
  const x=await org("ente_publico"),y=await org("ente_publico");
  await sql("insert into profiles(user_id,role,nicho) values($1,'comprador','comprador_investidor'),($2,'comprador','comprador_investidor')",[dono,outro]);
  const regra=(await sql("select fn_balcao_regra($1,'Projeto','Apresente o projeto.',array['Título'],null) id",[x.u])).rows[0].id;
  await sql(`create schema storage; create table storage.objects(name text primary key,bucket_id text,created_at timestamptz default now());
    create table cofre_documentos(storage_path text);create table fin_documentos(storage_path text);
    create table propriedade_claims(prova_path text);create table cartography_layers(tipo text,source_path text)`);
  const pasta=await mkdtemp(join(tmpdir(),"arini-balcao-"));
  const local=path=>{assert.match(path,/^balcao\/[\da-f-]+\.[\da-z]+$/);return join(pasta,path.split("/")[1]);};
  const bucket={
    async upload(path,conteudo) {await writeFile(local(path),Buffer.from(conteudo),{flag:"wx"});await sql("insert into storage.objects(name,bucket_id) values($1,'docs')",[path]);return {error:null};},
    async download(path) {return {data:new Blob([await readFile(local(path))]),error:null};},
    async remove(paths) {for(const path of paths){await unlink(local(path));await sql("delete from storage.objects where name=$1",[path]);}return {error:null};},
  };
  const db={storage:{from(nome){assert.equal(nome,"docs");return bucket;}},rpc(nome,args) {
    assert.ok(["balcao_preparar_anexo","balcao_gravar_anexo","balcao_obter_arquivo"].includes(nome));
    const chaves=Object.keys(args);
    const q=`select * from ${nome}(${chaves.map((c,i)=>c+"=>$"+(i+1)).join(",")})`;
    const p=sql(q,Object.values(args)).then(r=>({data:nome==="balcao_preparar_anexo"?r.rows[0][nome]:r.rows[0]??null,error:null}))
      .catch(e=>({data:null,error:{code:e.code,message:e.message}}));
    return Object.assign(p,{single:()=>p,maybeSingle:()=>p});
  }};
  let usuario=dono;
  const deps={"node:crypto":crypto,"@/lib/authz":{ator:()=>usuario?{userId:usuario}:null},"@/lib/erros":{falha:(s,c,m)=>Response.json({codigo:c,error:m},{status:s})},
    "@/lib/seguranca/arquivos":{conferirArquivo,extensao,ACEITA},"@/lib/seguranca/documentos":{registrarAcessoDocumento:async()=>{}},
    "@/lib/seguranca/limite":{limitar:()=>({permitido:true})},"@/lib/solicitacoes-planos-servidor":{ehUuid:v=>typeof v==="string" && /^[a-f\d-]{36}$/.test(v)},
    "@/lib/supabase/admin":{supabaseAdmin:()=>db}};
  const texto=await readFile(new URL("../src/app/api/territorio/anexos/route.ts",import.meta.url),"utf8");
  const js=ts.transpileModule(texto,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const rota={};compileFunction(js,["require","exports"])(id=>{assert.ok(deps[id],id);return deps[id];},rota);
  const base="http://localhost/api/territorio/anexos",bytes="%PDF-1.4\nProjeto municipal de teste\n%%EOF";
  const abrir={acao:"protocolar",chave:crypto.randomUUID(),regra,dados:{"Título":"Planta de teste"}};
  const enviar=async(campos,conteudo=bytes)=>{
    const f=new FormData();f.set("operacao",JSON.stringify(campos));f.set("arquivo",new File([conteudo],"planta.pdf"));
    return rota.POST(new Request(base,{method:"POST",body:f}));
  };
  const baixar=(ator,id)=>{usuario=ator;return rota.GET(new Request(base+"?id="+id));};
  const pedidos=async(u,i)=>(await sql("select fn_balcao_pedidos($1,$2) p",[u,i])).rows[0].p;
  try {
    assert.equal((await enviar(abrir,"<html>não é PDF</html>")).status,400);
    const respostas=await Promise.all([enviar(abrir),enviar(abrir)]);
    for(const r of respostas)assert.equal(r.status,200,await r.text());
    let [p]=await pedidos(dono,false);
    assert.equal(p.andamentos.length,1);const primeiro=p.andamentos[0].arquivo.id;
    assert.equal((await sql("select count(*)::int n from storage.objects")).rows[0].n,1);
    assert.equal((await enviar(abrir,"%PDF-1.4 alterado")).status,409);
    for(const ator of [dono,x.u]) {
      const r=await baixar(ator,primeiro);assert.equal(r.status,200);assert.match(r.headers.get("content-disposition"),/^attachment/);
      assert.equal(r.headers.get("location"),null);assert.match(r.headers.get("cache-control"),/no-store/);assert.equal(await r.text(),bytes);
    }
    assert.equal((await baixar(null,primeiro)).status,401);
    for(const ator of [outro,y.u])assert.equal((await baixar(ator,primeiro)).status,404);
    assert.deepEqual(await pedidos(outro,false),[]);assert.deepEqual(await pedidos(y.u,true),[]);
    await sql("select fn_balcao_andar($1,$2,$3,'pendencia','Enviar planta revisada.')",[x.u,p.id,p.revisao]);
    p=(await pedidos(dono,false))[0];const resposta={acao:"andamento",etapa:"resposta",id:p.id,chave:crypto.randomUUID(),revisao:p.revisao,texto:"Segue a revisão."};
    usuario=outro;assert.equal((await enviar(resposta)).status,403);
    usuario=dono;const revisado=bytes+"\nRevisão";assert.equal((await enviar(resposta,revisado)).status,200);assert.equal((await enviar(resposta,revisado)).status,200);
    const [depois]=await pedidos(x.u,true);assert.equal(depois.andamentos.length,3);const ultimo=depois.andamentos[2].arquivo.id;
    assert.equal(await (await baixar(x.u,ultimo)).text(),revisado);
    await sql("update org_modulos_contratados set ativo=false where org_id=$1",[x.id]);
    assert.equal((await baixar(x.u,ultimo)).status,404);assert.deepEqual(await pedidos(x.u,true),[]);assert.equal((await baixar(dono,ultimo)).status,200);
    await assert.rejects(sql("set role authenticated;select * from balcao_anexos"),{code:"42501"});
    const orfao="balcao/"+crypto.randomUUID()+".pdf";await bucket.upload(orfao,Buffer.from(bytes));
    await sql("update storage.objects set created_at=now()-interval '3 hours'");
    await limparCofre({},pool,null,bucket);assert.equal((await sql("select count(*)::int n from storage.objects")).rows[0].n,2);
    await sql("delete from balcao_andamentos where protocolo=$1",[p.id]);
    await sql("delete from balcao_protocolos where id=$1",[p.id]);await limparCofre({},pool,null,bucket);
    assert.equal((await sql("select count(*)::int n from storage.objects")).rows[0].n,0);
  } finally {await rm(pasta,{force:true,recursive:true});}
}
