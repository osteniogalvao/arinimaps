// Homologação navegável local. Recusa URLs de produção e não envia mensagens externas.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
const env=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const n=l.indexOf("=");return [l.slice(0,n),l.slice(n+1).replace(/^['"]|['"]$/g,"")];}));
const base=process.env.BASE_URL??"http://127.0.0.1:3005";
for(const url of [base,env.NEXT_PUBLIC_SUPABASE_URL])assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname),"Somente QA local");
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const contas=JSON.parse(readFileSync("../auditoria-funcional-2026-11-24/infra/accounts.json","utf8")).accounts;
const conta=email=>contas.find(a=>a.email===email);
const fatores=JSON.parse(readFileSync("../auditoria-funcional-2026-11-24/infra/mfa-qa.private.json","utf8")).accounts;
function totp(secret){
  const bits=[...secret.toUpperCase().replace(/=+$/,"")].map(c=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)));const contador=Buffer.alloc(8);contador.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const mac=createHmac("sha1",bytes).update(contador).digest(),offset=mac[mac.length-1]&15;
  return ((mac.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,"0");
}
const saida=resolve("../auditoria-funcional-2026-11-24/crm");mkdirSync(saida,{recursive:true});
const resultados=[],errosBrowser=[];
const b=await puppeteer.launch({executablePath:env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const log=(nome,dados={})=>{resultados.push({nome,ok:true,...dados});console.log("OK "+nome);};
const texto=async p=>p.evaluate(()=>document.body?.innerText??"");
const clicar=async(p,t)=>{
  console.log("Etapa: botão "+t);
  await p.waitForFunction(t=>[...document.querySelectorAll('button')].some(el=>el.textContent.trim()===t&&Object.keys(el).some(k=>k.startsWith('__reactProps$'))),{timeout:90000},t);
  const h=await p.evaluateHandle(t=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===t),t);
  assert.ok(h.asElement(),"Botão encontrado: "+t);await h.asElement().scrollIntoView();await h.asElement().click();
};
const post=(p,url,body)=>p.evaluate(async(url,body)=>{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},url,body);
async function login(email){
  console.log("Etapa: abrindo login "+email);
  const ctx=await b.createBrowserContext();const p=await ctx.newPage();await p.setViewport({width:1440,height:1000});
  p.on("pageerror",e=>{errosBrowser.push({email,url:p.url(),error:e.message});console.log('BROWSER '+p.url()+' '+e.message)});
  await p.goto(base+"/entrar",{waitUntil:"networkidle2",timeout:180000});
  console.log("Etapa: login carregado "+new URL(p.url()).pathname);
  if(!(await p.$('input[type=email]')) && (await texto(p)).includes("ACESSO RESTRITO")){
    await p.type("input[type=password]",env.SITE_SENHA);
    const acesso=p.waitForResponse(r=>r.url().endsWith("/api/acesso")&&r.request().method()==="POST",{timeout:90000});
    const navegacao=p.waitForNavigation({waitUntil:"domcontentloaded",timeout:180000});
    await p.focus("input[type=password]");await p.keyboard.press("Enter");assert.equal((await acesso).status(),200);await navegacao;
    await p.goto(base+"/entrar",{waitUntil:"networkidle2",timeout:180000});
  }
  // O HTML do formulário pode chegar antes da hidratação no servidor de QA.
  // Aguardar o handler evita digitar em um nó que o React ainda vai substituir.
  await p.waitForFunction(()=>{const el=document.querySelector('input[type=email]');return el&&Object.keys(el).some(k=>k.startsWith('__reactProps$')&&typeof el[k]?.onChange==='function');},{timeout:90000});
  await p.locator("input[type=email]").fill(email);await p.locator("input[type=password]").fill(env.SEED_USER_PASSWORD);
  await p.waitForFunction(email=>document.querySelector('input[type=email]')?.value===email,{timeout:30000},email);
  console.log("Etapa: enviando login "+email);
  const r=p.waitForResponse(r=>r.url().endsWith("/api/auth/entrar")&&r.request().method()==="POST",{timeout:90000});
  await p.click('form button:not([type]), form button[type="submit"]');const resposta=await r;assert.equal(resposta.status(),200);
  if((await resposta.json()).mfa){
    const fator=fatores.find(f=>f.email===email);assert.ok(fator,"MFA QA previamente configurado");
    await p.waitForSelector("#mfa",{visible:true});await p.type("#mfa",totp(fator.secret));await clicar(p,"Confirmar código");
  }
  await p.waitForFunction(()=>!location.pathname.endsWith("/entrar"),{timeout:180000});
  log("Login real formulário "+email);return p;
}
try{
  const admin=await login("admin@arinibrasil.com.br");
  await admin.goto(base+"/admin/crm",{waitUntil:"networkidle2",timeout:180000});await clicar(admin,"Novo funil");
  await admin.waitForSelector('input[placeholder="Nome do funil"]',{visible:true});
  await admin.select("form select","comercial");await admin.type('input[placeholder="Nome do funil"]',"QA Jornada CRM "+Date.now());
  let espera=admin.waitForResponse(r=>r.url().endsWith("/api/admin/crm")&&r.request().method()==="POST",{timeout:90000});await clicar(admin,"Criar");
  let res=await espera;assert.equal(res.status(),200);const {id:pipe}=await res.json();await admin.waitForFunction(id=>location.pathname.endsWith(id),{timeout:90000},pipe);
  log("Diretoria cria funil pela tela",{pipe});
  await admin.goto(base+"/admin/crm/"+pipe,{waitUntil:"networkidle2",timeout:180000});await clicar(admin,"Novo item");
  await admin.waitForSelector('input[placeholder="Título"]',{visible:true});
  const titulo="QA Compra até entrega "+Date.now();await admin.type('input[placeholder="Título"]',titulo);
  espera=admin.waitForResponse(r=>r.url().endsWith("/api/admin/crm")&&r.request().method()==="POST",{timeout:90000});await clicar(admin,"Criar");res=await espera;assert.equal(res.status(),200);const {id:item}=await res.json();
  await admin.goto(base+"/admin/crm/item/"+item,{waitUntil:"networkidle2",timeout:180000});await admin.waitForFunction(t=>[...document.querySelectorAll('input')].some(e=>e.value===t),{timeout:30000},titulo);
  await admin.screenshot({path:resolve(saida,"01-item-dono.png"),fullPage:true});log("Diretoria cria item pelo quadro e abre ficha",{item});
  const juridico=conta("juridico.teste@arinibrasil.com.br");await admin.select('select[aria-label="Delegar para"]',juridico.id);
  espera=admin.waitForResponse(r=>r.url().endsWith("/api/admin/crm")&&r.request().method()==="POST",{timeout:90000});await clicar(admin,"Delegar");res=await espera;assert.equal(res.status(),200);log("Diretoria delega item ao Jurídico pela tela");
  const jur=await login(juridico.email);await jur.goto(base+"/admin/crm/item/"+item,{waitUntil:"networkidle2",timeout:180000});
  assert.ok((await texto(jur)).includes("Este item foi delegado a você"));await jur.screenshot({path:resolve(saida,"02-item-delegado.png"),fullPage:true});
  espera=jur.waitForResponse(r=>r.url().endsWith("/api/admin/crm")&&r.request().method()==="POST",{timeout:90000});await clicar(jur,"Concluir");res=await espera;assert.equal(res.status(),200);
  assert.equal((await db.from("crm_itens").select("status").eq("id",item).single()).data.status,"concluido");log("Jurídico abre item delegado de outro setor e conclui pela tela");
  const comercial=await login("comercial.teste@arinibrasil.com.br");
  const proibida=await post(comercial,"/api/admin/financeiro/alugueis",{acao:"pagar",id:item});assert.equal(proibida.status,403);log("Comercial bloqueado na API financeira");
  const r=await comercial.goto(base+"/admin/financeiro/alugueis",{waitUntil:"networkidle2",timeout:180000});
  assert.equal(new URL(comercial.url()).pathname,"/admin");log("Comercial bloqueado na tela financeira",{http:r.status(),destino:new URL(comercial.url()).pathname});
  // Dados sintéticos exclusivos deste run para testar aluguel pelo formulário real.
  const inquilino="QA Inquilino "+Date.now();
  const {data:contrato,error:ce}=await db.from("contratos_locacao").insert({proprietario_nome:"QA Proprietário",inquilino_nome:inquilino,valor_aluguel:1000,taxa_administracao:10,inicio:"2026-01-01",dia_vencimento:10}).select("id").single();assert.ifError(ce);
  const comp=new Date().toISOString().slice(0,7)+"-01";const {data:parcela,error:pe}=await db.rpc("fn_aluguel_gerar_parcela",{p_contrato:contrato.id,p_competencia:comp});assert.ifError(pe);
  await admin.goto(base+"/admin/financeiro/alugueis",{waitUntil:"networkidle2",timeout:180000});
  const linha=await admin.evaluateHandle(nome=>[...document.querySelectorAll("tr")].find(e=>e.innerText.includes(nome)),inquilino);assert.ok(linha.asElement());
  const recebido=await linha.asElement().$$('button');let alvo;for(const btn of recebido)if(await btn.evaluate(e=>e.innerText)==="Recebido")alvo=btn;assert.ok(alvo);await alvo.click();
  espera=admin.waitForResponse(r=>r.url().endsWith("/api/admin/financeiro/alugueis")&&r.request().method()==="POST",{timeout:90000});await clicar(admin,"Confirmar");res=await espera;assert.equal(res.status(),200);
  const pago=(await db.from("alugueis_parcelas").select("status,valor_pago,valor_repasse").eq("id",parcela).single()).data;assert.equal(pago.status,"pago");assert.equal(pago.valor_repasse,900);
  log("Dono recebe aluguel na tela, repasse calculado em900",{parcela});await admin.screenshot({path:resolve(saida,"03-aluguel-recebido.png"),fullPage:true});
  await admin.reload({waitUntil:"networkidle2"});
  espera=admin.waitForResponse(r=>r.url().endsWith("/api/admin/financeiro/alugueis")&&r.request().method()==="POST",{timeout:90000});const repasseRow=await admin.evaluateHandle(nome=>[...document.querySelectorAll("tr")].find(e=>e.innerText.includes(nome)),inquilino);
  const repasseButtons=await repasseRow.asElement().$$('button');let repasseButton;for(const btn of repasseButtons)if((await btn.evaluate(e=>e.innerText)).trim()==="Repassado")repasseButton=btn;
  assert.ok(repasseButton);await repasseButton.scrollIntoView();await repasseButton.click();res=await espera;assert.equal(res.status(),200);
  assert.equal((await db.from("alugueis_parcelas").select("repasse_status").eq("id",parcela).single()).data.repasse_status,"repassado");log("Dono confirma repasse na tela");
  assert.deepEqual(errosBrowser,[]);log("Nenhum erro JavaScript nas jornadas navegadas");
}catch(e){resultados.push({ok:false,error:e.stack});console.error(e.stack);process.exitCode=1;
  for(const [i,p] of (await b.pages()).entries()) if(p.url()!=="about:blank") { await p.screenshot({path:resolve(saida,`falha-${i}.png`),fullPage:true}).catch(()=>{});writeFileSync(resolve(saida,`falha-${i}.txt`),await texto(p)); }
}
finally{writeFileSync(resolve(saida,"browser-resultados.json"),JSON.stringify({base,resultados,errosBrowser},null,2));await b.close();}
