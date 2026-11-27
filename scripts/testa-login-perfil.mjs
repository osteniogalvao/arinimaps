import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileFunction} from "node:vm";
import ts from "typescript";

async function entrar({profile={role:"proprietario",ativo:true,entrada_ativa:"proprietario"},profileError=null,passwordError=null}={}){
 const calls=[],events=[];
 const auth={signInWithPassword:async()=>({data:{user:passwordError?null:{id:"qa-user"}},error:passwordError}),
  signOut:async options=>{calls.push(["signOut",options]);return {error:null};},
  mfa:{getAuthenticatorAssuranceLevel:async()=>{calls.push(["mfa"]);return {data:{currentLevel:"aal1",nextLevel:"aal1"},error:null};}}};
 const query={select:()=>query,eq:()=>query,single:async()=>({data:profile,error:profileError})};
 const deps={"next/server":{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  "@/lib/supabase/server":{supabaseServer:async()=>({auth})},
  "@/lib/supabase/admin":{supabaseAdmin:()=>({from:()=>query})},
  "@/lib/seguranca/limite":{ipDoPedido:()=>"127.0.0.1",consultarLimite:async()=>({permitido:true}),limitar:async()=>({permitido:true}),respostaLimite:()=>assert.fail("Sem bloqueio de limite")},
  "@/lib/seguranca/eventos":{registrarEvento:async(_r,name)=>events.push(name)},
  "@/lib/seguranca/alertas":{analisarEntrada:async()=>calls.push(["analisarEntrada"]),analisarFalha:async()=>calls.push(["analisarFalha"])},
  "@/lib/organizacoes-servidor":{vincularConvites:async()=>calls.push(["vincularConvites"])},
  "@/lib/planos-servidor":{acessoDe:async()=>({equipe:false,cotas:{}})},
  "@/lib/seguranca/uso":{COOKIE_APARELHO:"arini_aparelho",entrarComAparelho:async()=>events.push("aparelho")}};
 const code=ts.transpileModule(readFileSync(new URL("../src/app/api/auth/entrar/route.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={};compileFunction(code,["require","exports","Response"])(id=>{assert.ok(Object.hasOwn(deps,id),id);return deps[id];},mod,Response);
 const response=await mod.POST(new Request("http://localhost/api/auth/entrar",{method:"POST",body:JSON.stringify({email:"qa@example.test",senha:"senha-sintetica"})}));
 return {status:response.status,body:await response.json(),cookie:response.headers.get("set-cookie"),calls,events};
}
for(const [name,options] of [["erro de leitura do perfil",{profile:null,profileError:{code:"503"}}],["perfil ausente",{profile:null}]])test(name+" não autentica como comprador",async()=>{
 const r=await entrar(options);assert.equal(r.status,503);assert.equal(r.body.ok,undefined);assert.equal(r.body.role,undefined);
 assert.deepEqual(r.calls,[["signOut",{scope:"local"}]]);assert.ok(!r.events.includes("login_ok"));
});
test("credencial inválida continua401 sem avaliar perfil ou vincular convite",async()=>{
 const r=await entrar({passwordError:{message:"Invalid credentials"}});assert.equal(r.status,401);assert.deepEqual(r.events,["login_falhou"]);assert.deepEqual(r.calls,[["analisarFalha"]]);
});
test("conta desativada continua403 e encerra a sessão",async()=>{
 const r=await entrar({profile:{role:"proprietario",ativo:false}});assert.equal(r.status,403);assert.equal(r.calls[0][0],"signOut");assert.equal(r.calls.length,1);assert.deepEqual(r.events,["login_bloqueado"]);
});
test("perfil válido mantém papel real, registra sucesso e vincula convites",async()=>{
 const r=await entrar();assert.equal(r.status,200);assert.equal(r.body.role,"proprietario");assert.equal(r.body.ok,true);assert.deepEqual(r.events,["login_ok","aparelho"]);assert.deepEqual(r.calls,[["mfa"],["analisarEntrada"],["vincularConvites"]]);
 assert.match(r.cookie??"",/^arini_aparelho=[0-9a-f-]{36}; Path=\/;.*HttpOnly/);
});
