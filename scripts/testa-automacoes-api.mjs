import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import ts from 'typescript';
function app(falha=null, autorizado=true){
 const calls=[],logs=[];
 const deps={
  'next/server':{NextResponse:Response},
  '@/lib/authz':{ator:async()=>({userId:'diretoria-qa'}),temSetor:()=>autorizado},
  '@/lib/supabase/admin':{supabaseAdmin:()=>({rpc:async nome=>{calls.push(nome);return nome===falha?{data:null,error:{message:'falha sintética'}}:{data:nome==='fn_matriz_resumo'?3:{[nome]:1},error:null}}})},
  '@/lib/audit':{logAudit:async evento=>logs.push(evento)},
 };
 const js=ts.transpileModule(readFileSync(new URL('../src/app/api/admin/automacoes/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};compileFunction(js,['require','exports'])(id=>{assert.ok(Object.hasOwn(deps,id));return deps[id]},exports);
 return {...exports,calls,logs};
}
test('somente Diretoria executa o motor',async()=>{const a=app(null,false);assert.equal((await a.POST()).status,403);assert.equal(a.calls.length,0)});
test('falha em qualquer módulo é comunicada como execução parcial, preservando os resultados confirmados',async()=>{
 for(const fn of ['fn_central_modulos','fn_matriz_pendencias_origem','fn_matriz_cobranca','fn_matriz_resumo']){const a=app(fn);const r=await a.POST(),j=await r.json();assert.equal(r.status,503,fn);assert.equal(j.parcial,true);assert.equal(j.resultado.fn_central_automacoes,1);assert.equal(a.logs[0].acao,'automacoes_parciais')}
});
test('resumo da Ari informa quantos resumos foram produzidos',async()=>{const a=app();const r=await a.POST(),j=await r.json();assert.equal(r.status,200);assert.equal(j.resultado.resumo_ari,3);assert.equal(a.logs[0].acao,'automacoes_rodadas')});
