import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileFunction} from "node:vm";
import ts from "typescript";
const current={userId:"00000000-0000-4000-8000-000000000001",ehArini:true,setores:["comercial"]};
function route(file){
 const exports={};const noDatabase=()=>assert.fail("Entrada inválida não deveria consultar/gravar no banco");
 const deps={"next/server":{NextResponse:{json:Response.json}},"@/lib/supabase/admin":{supabaseAdmin:()=>({from:noDatabase,rpc:noDatabase})},"@/lib/authz":{ator:async()=>current},"@/lib/notificacoes":{notificar:noDatabase},"@/lib/seguranca/limite":{limitar:async()=>({permitido:true}),respostaLimite:noDatabase},"@/lib/setores":{setorPorId:()=>null},"@/lib/audit":{logAudit:noDatabase},"@/lib/ponto-terminal":{podeOperarTerminal:async()=>true}};
 const code=ts.transpileModule(readFileSync(new URL("../src/app/api/admin/"+file+"/route.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 compileFunction(code,["exports","require"])(exports,name=>{assert.ok(name in deps,"Dependência inesperada: "+name);return deps[name];});return exports;
}
const request=body=>new Request("http://localhost/api/qa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
test("chat recusa envelope/identificadores/textos inválidos com400 antes do banco",async()=>{
 const app=route("chat");for(const body of [null,[],42,"texto",{},...[null,123,{},[],"   ","a".repeat(4001)].map(texto=>({acao:"enviar",conversa:"00000000-0000-4000-8000-000000000002",texto})),{acao:"direta",com:"1".repeat(36)}])assert.equal((await app.POST(request(body))).status,400,JSON.stringify(body)?.slice(0,80));
});
test("PIN próprio recusa envelope ou PIN de tipo inválido e PIN óbvio",async()=>{
 const app=route("ponto/pin");for(const body of [null,[],42,{pin:7429},{pin:{}},{pin:"1234"},{pin:"7777"},{pin:""}])assert.equal((await app.POST(request(body))).status,400,JSON.stringify(body));
});
test("terminal recusa envelope/UUID/PIN inválidos antes da consulta",async()=>{
 const app=route("ponto/terminal");for(const body of [null,[],42,{user_id:"1".repeat(36),pin:"7429"},{user_id:current.userId,pin:7429},{user_id:current.userId,pin:{}},{user_id:current.userId,pin:""}])assert.equal((await app.POST(request(body))).status,400,JSON.stringify(body));
});
