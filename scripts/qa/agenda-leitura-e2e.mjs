// UI/API reais em QA; conta e tarefas sintéticas exclusivas. Nenhuma DDL ou integração externa.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createClient} from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
const env=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,"")]}));
const base=process.env.BASE_URL??"http://127.0.0.1:3005";for(const u of [base,env.NEXT_PUBLIC_SUPABASE_URL])assert.ok(["127.0.0.1","localhost"].includes(new URL(u).hostname));
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),stamp=Date.now();
const email=`qa.leitura.${stamp}@example.invalid`,hoje=new Date().toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
const {data:criado,error:ce}=await db.auth.admin.createUser({email,password:env.SEED_USER_PASSWORD,email_confirm:true,user_metadata:{nome:"QA Leitura"}});assert.ifError(ce);
assert.ifError((await db.from("profiles").update({role:"analista_arini",ativo:true,setores:["comercial"],equipe_acesso:"leitura"}).eq("user_id",criado.user.id)).error);
const comercial=`QA Agenda Comercial ${stamp}`,financeiro=`QA Agenda Financeiro ${stamp}`;
const {data:tasks,error:te}=await db.from("tasks").insert([{titulo:comercial,setor:"comercial",prazo:hoje},{titulo:financeiro,setor:"financeiro",prazo:hoje}]).select("id,titulo");assert.ifError(te);
const b=await puppeteer.launch({executablePath:env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true}),p=await b.newPage(),errors=[],results=[];
p.on("pageerror",e=>errors.push(e.message));const ok=n=>{results.push({name:n,ok:true});console.log("OK "+n);};
try{
  await p.setViewport({width:1440,height:1000});await p.goto(base+"/entrar",{waitUntil:"domcontentloaded",timeout:90000});
  await p.evaluate(async(s,e,pw)=>{await fetch('/api/acesso',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({senha:s})});const r=await fetch('/api/auth/entrar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,senha:pw})});if(!r.ok)throw Error('Login '+r.status);},env.SITE_SENHA,email,env.SEED_USER_PASSWORD);
  const pagina=await p.goto(base+`/admin/agenda-setores?setor=financeiro&de=${hoje}&ate=${hoje}`,{waitUntil:"networkidle2",timeout:90000});
  console.log("Agenda HTTP",pagina.status(),new URL(p.url()).pathname);
  await p.waitForFunction(()=>document.querySelector('h1')?.textContent?.includes('Agenda dos setores'),{timeout:30000});
  const text=await p.evaluate(()=>document.body.textContent);assert.ok(text.includes("Agenda dos setores"));assert.ok(text.includes("Acesso de leitura"));assert.ok(text.includes(comercial));assert.ok(!text.includes(financeiro));
  assert.ok(!text.includes("Não foi possível consultar"));ok("Agenda real preserva Comercial e ignora tentativa de ampliar setor pela URL");
  await p.screenshot({path:"../auditoria-funcional-2026-11-24/crm/04-agenda-leitura.png",fullPage:true});
  const id=tasks.find(t=>t.titulo===comercial).id;
  const r=await p.evaluate(async id=>{const r=await fetch('/api/admin/tarefas',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,titulo:'NÃO DEVE ALTERAR',status:'concluida',evidencia:'Teste sintético'})});return{status:r.status,body:await r.json()};},id);
  assert.equal(r.status,403);assert.match(r.body.error,/somente de leitura/i);assert.equal((await db.from('tasks').select('titulo,status').eq('id',id).single()).data.titulo,comercial);ok("Leitura consulta a agenda mas API bloqueia alteração e preserva tarefa");
  assert.deepEqual(errors,[]);ok("Agenda Leitura sem erro JavaScript");
}catch(e){results.push({ok:false,error:e.stack,url:p.url()});console.error(e.stack);writeFileSync("../auditoria-funcional-2026-11-24/crm/agenda-leitura-falha.txt",await p.evaluate(()=>document.body.innerText));await p.screenshot({path:"../auditoria-funcional-2026-11-24/crm/agenda-leitura-falha.png",fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{writeFileSync("../auditoria-funcional-2026-11-24/crm/agenda-leitura.json",JSON.stringify({base,results,errors},null,2));await b.close();}
