// Fixtures exclusivamente locais + loaders reais contra PostgREST. Não transfere nenhuma tarefa.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {compileFunction} from "node:vm";
import ts from "typescript";
import {createClient} from "@supabase/supabase-js";
import * as matriz from "../../src/lib/matriz.ts";
import * as redistribuicao from "../../src/lib/redistribuicao.ts";
import * as setores from "../../src/lib/setores.ts";
const env=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,"")]}));
assert.ok(["127.0.0.1","localhost"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname));
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),stamp=Date.now();
const deps={"server-only":{},"@/lib/supabase/admin":{supabaseAdmin:()=>db},"@/lib/matriz":matriz,"@/lib/redistribuicao":redistribuicao,"@/lib/setores":setores};
function carregar(path){const js=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={};compileFunction(js,["require","exports"])(id=>{assert.ok(Object.hasOwn(deps,id));return deps[id]},mod);return mod;}
const {data:conta,error:ce}=await db.auth.admin.createUser({email:`qa.redistribuicao.${stamp}@example.invalid`,password:env.SEED_USER_PASSWORD,email_confirm:true,user_metadata:{nome:"QA Redistribuição"}});assert.ifError(ce);
assert.ifError((await db.from("profiles").update({role:"analista_arini",ativo:true,setores:["comercial"],capacidade_tarefas:1,equipe_acesso:"operador"}).eq("user_id",conta.user.id)).error);
const titulo=`QA Prazo Janeiro ${stamp}`,fora=`QA Prazo Fevereiro ${stamp}`,privado=`QA Prazo Financeiro ${stamp}`;
const {data:tasks,error:te}=await db.from("tasks").insert([{titulo,setor:"comercial",prazo:"1900-01-01",responsavel:conta.user.id},{titulo:fora,setor:"comercial",prazo:"1900-02-01",responsavel:conta.user.id},{titulo:privado,setor:"financeiro",prazo:"1900-01-01"}]).select("id,titulo,responsavel");assert.ifError(te);
const {dadosMatriz}=carregar("src/lib/matriz-servidor.ts"),{lerRedistribuicao}=carregar("src/lib/redistribuicao-servidor.ts");
const hoje=new Date().toISOString().slice(0,10),results=[];
const r=await dadosMatriz(["comercial"],hoje,{setor:"financeiro",tipo:"",de:"1900-01-01",ate:"1900-01-31"});
assert.equal(r.pronto,true);assert.equal(r.filtro.setor,"");assert.ok(r.gargalos.some(t=>t.titulo===titulo));assert.ok(!r.gargalos.some(t=>[fora,privado].includes(t.titulo)));results.push({name:"Loader Matriz filtra prazo sem ampliar setor",ok:true});
const invalido=await dadosMatriz(["comercial"],hoje,{setor:"",tipo:"",de:"2026-02-30",ate:"2026-03-01"});assert.ok(invalido.erroPeriodo);assert.equal(invalido.gargalos.length,0);results.push({name:"Intervalo inválido é explicitado e não expõe fila irrestrita",ok:true});
const sugs=await lerRedistribuicao(["diretoria"]);assert.equal(sugs.pronto,true,sugs.erro);assert.ok(sugs.sugestoes.some(s=>s.titulo===titulo));
assert.equal((await db.from("tasks").select("responsavel").eq("id",tasks[0].id).single()).data.responsavel,conta.user.id);results.push({name:"Loader Capacidade gera sugestão sem transferir tarefa",ok:true});
writeFileSync("../auditoria-funcional-2026-11-24/crm/matriz-redistribuicao-http.json",JSON.stringify({results,fixture:{titulo,fora,privado,userId:conta.user.id,tasks},sugestoes:sugs.sugestoes},null,2));console.log(JSON.stringify(results));
