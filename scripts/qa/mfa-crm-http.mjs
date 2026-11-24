// Prova direta PostgREST: a conta gestora aal1 não ganha leitura pela API pública.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHmac} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
const env=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,"")]}));
assert.ok(["127.0.0.1","localhost"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname));
const fator=JSON.parse(readFileSync("../auditoria-funcional-2026-11-24/infra/mfa-qa.private.json","utf8")).accounts.find(x=>x.email==="admin@arinibrasil.com.br");assert.ok(fator);
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {error:entrada}=await db.auth.signInWithPassword({email:fator.email,password:env.SEED_USER_PASSWORD});assert.ifError(entrada);
try{
  assert.equal((await db.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel,"aal1");
  const antes=await db.from("profiles").select("user_id");assert.ifError(antes.error);assert.deepEqual(antes.data.map(p=>p.user_id),[fator.userId]);
  const papel=await db.rpc("fn_role");assert.ifError(papel.error);assert.equal(papel.data,null);
  const setor=await db.rpc("fn_tem_setor",{p_setor:"financeiro"});assert.ifError(setor.error);assert.equal(setor.data,false);
  const bits=[...fator.secret.toUpperCase().replace(/=+$/,"")].map(c=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2))),contador=Buffer.alloc(8);contador.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const mac=createHmac("sha1",bytes).update(contador).digest(),offset=mac[mac.length-1]&15,code=((mac.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,"0");
  const confirmacao=await db.auth.mfa.challengeAndVerify({factorId:fator.factorId,code});assert.ifError(confirmacao.error);
  assert.equal((await db.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel,"aal2");
  assert.equal((await db.rpc("fn_role")).data,"admin_central");assert.equal((await db.rpc("fn_tem_setor",{p_setor:"financeiro"})).data,true);
  const depois=await db.from("profiles").select("user_id");assert.ifError(depois.error);assert.ok(depois.data.length>1);
  const resultado={ok:true,antes:{aal:"aal1",perfis:antes.data.length,privilegioFinanceiro:false},depois:{aal:"aal2",perfis:depois.data.length,privilegioFinanceiro:true}};
  writeFileSync("../auditoria-funcional-2026-11-24/crm/mfa-http.json",JSON.stringify(resultado,null,2));console.log(JSON.stringify(resultado));
}finally{await db.auth.signOut({scope:"local"});}
