import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileFunction} from "node:vm";
import ts from "typescript";
import {periodoGargalos} from "../src/lib/matriz.ts";
import {sugerirRedistribuicao} from "../src/lib/redistribuicao.ts";

const pessoa=(id,cap=2,extras={})=>({user_id:id,nome:id,role:"analista_arini",setores:["comercial"],ativo:true,equipe_acesso:"operador",capacidade_tarefas:cap,...extras});
const tarefa=(id,responsavel,extras={})=>({id,titulo:id,setor:"comercial",responsavel,prazo:"2026-11-20",created_at:"2026-11-01T00:00:00Z",concluida_em:null,...extras});
test("período aceita limites opcionais e recusa data impossível/invertida sem ampliar silenciosamente",()=>{
  assert.deepEqual(periodoGargalos(undefined,undefined),{de:"",ate:"",erro:null});
  assert.equal(periodoGargalos("2026-02-30","2026-03-10").erro!==null,true);
  assert.equal(periodoGargalos("2026-11-24","2026-11-01").erro!==null,true);
  assert.deepEqual(periodoGargalos("2026-11-01","2026-11-24"),{de:"2026-11-01",ate:"2026-11-24",erro:null});
});
test("redistribuição considera carga de CRM/leads, elegibilidade setorial e tempo médio no desempate",()=>{
  const pessoas=[pessoa("sobrecarregado",1),pessoa("lento"),pessoa("rapido"),pessoa("leitura",20,{equipe_acesso:"leitura"}),pessoa("inativo",20,{ativo:false}),pessoa("outro",20,{setores:["juridico"]})];
  const abertas=[tarefa("a","sobrecarregado")],historico=[tarefa("h1","rapido",{concluida_em:"2026-11-03T00:00:00Z"}),tarefa("h2","lento",{concluida_em:"2026-11-11T00:00:00Z"})];
  const antes=JSON.stringify({pessoas,abertas,historico});
  const r=sugerirRedistribuicao(pessoas,abertas,historico,[{responsavel:"sobrecarregado"}],["comercial"]);
  assert.equal(r.length,1);assert.equal(r[0].destinoId,"rapido");assert.equal(r[0].mediaDias,2);assert.equal(r[0].amostras,1);
  assert.equal(JSON.stringify({pessoas,abertas,historico}),antes,"sugestão não modifica objetos");
  assert.deepEqual(sugerirRedistribuicao(pessoas,abertas,historico,[{responsavel:"sobrecarregado"}],["juridico"]),[]);
});
test("reservas virtuais não excedem capacidade; histórico inválido não inventa produtividade",()=>{
  const r=sugerirRedistribuicao([pessoa("origem",1),pessoa("destino",1)],[tarefa("a","origem"),tarefa("b","origem"),tarefa("c","origem")],
    [tarefa("h","destino",{concluida_em:"2026-10-01"})],[],["comercial"]);
  assert.equal(r.length,1);assert.equal(r[0].mediaDias,null);assert.equal(r[0].amostras,0);
  assert.deepEqual(sugerirRedistribuicao([pessoa("a",0),pessoa("b",0)],[tarefa("a","a"),tarefa("b","a")],[],[],["comercial"]),[]);
});
function loader(db){
  const deps={"server-only":{},"@/lib/supabase/admin":{supabaseAdmin:()=>db},"@/lib/redistribuicao":{sugerirRedistribuicao},"@/lib/setores":{SETOR_IDS:["comercial","juridico","diretoria"],TAREFA_STATUS_ABERTOS:["aberta","andamento","aguardando","bloqueada"]}};
  const js=ts.transpileModule(readFileSync("src/lib/redistribuicao-servidor.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};compileFunction(js,["require","exports"])(id=>{assert.ok(Object.hasOwn(deps,id));return deps[id]},exports);return exports.lerRedistribuicao;
}
test("loader recusa setor sem Diretoria antes de consultar e suprime recomendação se alguma origem falha",async()=>{
  let consultas=0;
  const db={from(){consultas++;const q=new Proxy({},{get:(_,key)=>key==="then"?(resolve)=>Promise.resolve({data:null,error:{message:"offline"}}).then(resolve):()=>q});return q;}};
  const ler=loader(db);assert.equal((await ler(["comercial"])).pronto,false);assert.equal(consultas,0);
  const r=await ler(["diretoria"]);assert.equal(consultas,5);assert.equal(r.pronto,false);assert.deepEqual(r.sugestoes,[]);
});
