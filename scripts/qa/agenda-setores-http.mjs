// Consulta real do loader no Supabase isolado; não escreve dados e recusa produção.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {compileFunction} from "node:vm";
import ts from "typescript";
import {createClient} from "@supabase/supabase-js";
import * as agenda from "../../src/lib/agenda-setores.ts";
const env=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,"")]}));
assert.ok(["127.0.0.1","localhost"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname));
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const deps={"server-only":{},"@/lib/supabase/admin":{supabaseAdmin:()=>db},"@/lib/agenda-setores":agenda};
const js=ts.transpileModule(readFileSync("src/lib/agenda-setores-servidor.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={};compileFunction(js,["require","exports"])(id=>{assert.ok(Object.hasOwn(deps,id));return deps[id]},mod);
const resultados=[];
for(const setores of [["comercial"],["juridico"],["financeiro"],["comercial","juridico","financeiro"]]){
  const r=await mod.lerAgendaSetores(setores,"2026-01-01","2027-01-01");assert.deepEqual(r.falhas,[]);assert.ok(r.itens.every(i=>setores.includes(i.setor)));
  resultados.push({setores,compromissos:r.itens.length,limitado:r.limitado,ok:true});
}
writeFileSync("../auditoria-funcional-2026-11-24/crm/agenda-http.json",JSON.stringify(resultados,null,2));console.log(JSON.stringify(resultados));
