// Jornada real da aplicação + Supabase de QA; somente o gateway é uma fixture.
// Nunca lê .env.local. Não pode apontar para uma URL pública.
import assert from "node:assert/strict";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {randomBytes} from "node:crypto";
import puppeteer from "puppeteer-core";
import {createClient} from "@supabase/supabase-js";

const env=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),x.slice(i+1)];}));
for(const key of ["BASE_URL","NEXT_PUBLIC_SUPABASE_URL","ASAAS_BASE_URL"]) assert.ok(["127.0.0.1","localhost"].includes(new URL(env[key]).hostname),"QA exige loopback: "+key);
const output=resolve("../auditoria-funcional-2026-11-24/checkout");mkdirSync(output,{recursive:true});
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const email="qa.compra."+Date.now()+"@example.test", senha="Qa!"+randomBytes(12).toString("hex");
const digits=[...randomBytes(9)].map(x=>x%10);
for(const weight of [10,11]) {const sum=digits.reduce((s,d,i)=>s+d*(weight-i),0);const v=11-sum%11;digits.push(v>=10?0:v);}
const cpf=digits.join("");
const results=[];
function check(name,condition,detail){results.push({name,ok:!!condition,...(detail?{detail}: {})});writeFileSync(resolve(output,"resultado.json"),JSON.stringify({syntheticGateway:true,email,results},null,2));assert.ok(condition,name+(detail?": "+JSON.stringify(detail):""));console.log("PASS "+name);}
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,args:["--no-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
const browserErrors=[];page.on("pageerror",e=>browserErrors.push(e.message));
await page.setExtraHTTPHeaders({"x-real-ip":"10.251.124.23"});
const api=(path,body,method="POST",headers={})=>page.evaluate(async(path,body,method,headers)=>{
  const res=await fetch(path,{method,headers:{"Content-Type":"application/json",...headers},...(method==="GET"?{}:{body:JSON.stringify(body)})});let data;try{data=await res.json();}catch{data={error:"notjson"};}return {status:res.status,data};
},path,body,method,headers);
let captured=null;
page.on("request",r=>{if(r.url().endsWith("/api/planos/solicitacoes")&&r.method()==="POST")captured={body:JSON.parse(r.postData()),key:r.headers()["idempotency-key"]};});
try {
  console.log("STEP abrir cadastro");
  await page.goto(env.BASE_URL+"/entrar?cadastro=1&papel=proprietario&nicho=proprietario",{waitUntil:"networkidle2",timeout:180000});
  if(page.url().includes("/acesso")){await api("/api/acesso",{senha:env.SITE_SENHA});await page.goto(env.BASE_URL+"/entrar?cadastro=1&papel=proprietario&nicho=proprietario",{waitUntil:"networkidle2",timeout:180000});}
  await page.waitForSelector("#nome");
  for(const [selector,value] of [["#nome","Pessoa QA Compra Integral"],["#cpf",cpf],["#email",email],["#senha",senha]])await page.type(selector,value);
  await page.click('input[type="checkbox"]');
  const validacao=await page.$eval("form",form=>({valid:form.checkValidity(),invalid:[...form.querySelectorAll("input,select")].filter(e=>!e.checkValidity()).map(e=>({id:e.id,reason:e.validationMessage}))}));
  check("formulário válido antes do envio",validacao.valid,validacao);
  const [cadastro,login]=await Promise.all([
    page.waitForResponse(r=>r.url().endsWith("/api/cadastro"),{timeout:120000}),
    page.waitForResponse(r=>r.url().endsWith("/api/auth/entrar"),{timeout:120000}),
    page.locator('form button:not([type]), form button[type="submit"]').click(),
  ]);
  check("cadastro pela interface",cadastro.status()===200,await cadastro.json());
  check("login automático após cadastro",login.status()===200,await login.json());
  await page.waitForFunction(()=>!location.pathname.startsWith("/entrar"),{timeout:120000});
  const versao="termos-de-uso@2026.11.15,privacidade@2026.11.15";
  const contexto=await api("/api/conta/contexto",{entrada:"vender",aceite:true,versao});check("contexto de proprietário",contexto.status===200,contexto);
  const {data:userRows,error:profileError}=await admin.from("profiles").select("user_id,plan_id,plan_origem").eq("nome","Pessoa QA Compra Integral").order("created_at",{ascending:false}).limit(1);
  assert.ifError(profileError);const userId=userRows[0].user_id, initial=userRows[0];
  await page.goto(env.BASE_URL+"/planos?perfil=vender&pacote=proprietario_completo",{waitUntil:"networkidle2",timeout:180000});
  await page.waitForSelector('button[aria-label="Selecionar Completo"]');await page.click('button[aria-label="Selecionar Completo"]');
  const consent=await page.evaluate(()=>{const label=[...document.querySelectorAll("label")].find(e=>e.textContent.includes("Aceito o plano"));if(!label)return false;label.querySelector("input").click();return true;});check("aceite explícito na página de planos",consent);
  const pedidoResponse=page.waitForResponse(r=>r.url().endsWith("/api/planos/solicitacoes")&&r.request().method()==="POST",{timeout:120000});
  await page.evaluate(()=>[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Contratar e pagar"))?.click());
  const pedido=await pedidoResponse,body=await pedido.json();check("contratação direta pela interface",pedido.status()===200&&body.direta===true,body);
  const id=body.solicitacao.id;
  await page.waitForFunction(()=>location.pathname==="/planos/solicitacoes",{timeout:120000});
  await page.screenshot({path:resolve(output,"01-fatura-pendente.png"),fullPage:true});
  const {data:faturas,error:ef}=await admin.from("faturas_cotadas").select("*").eq("assinatura",id);assert.ifError(ef);
  check("uma fatura e promoção correta",faturas.length===1&&faturas[0].valor===6990,{count:faturas.length,valor:faturas[0]?.valor});
  const f=faturas[0];
  const antes=await admin.from("profiles").select("plan_id,plan_origem").eq("user_id",userId).single();
  check("acesso pago bloqueado antes de confirmar pagamento",antes.data.plan_id===initial.plan_id&&antes.data.plan_origem===initial.plan_origem);
  const requestCaptured=captured;
  const replay=await api("/api/planos/solicitacoes",requestCaptured.body,"POST",{"Idempotency-Key":requestCaptured.key});
  check("retry reutiliza o pedido",replay.status===200&&replay.data.solicitacao.id===id,replay);
  const {data:again}=await admin.from("faturas_cotadas").select("id").eq("assinatura",id);check("retry não duplica a fatura",again.length===1);
  const pix=await api("/api/planos/pix?fatura="+f.id,undefined,"GET");check("Pix da fatura própria",pix.status===200&&pix.data.codigo?.startsWith("000201"),{status:pix.status});
  const fixtureBase=new URL(env.ASAAS_BASE_URL).origin;
  const event=await (await fetch(fixtureBase+"/__qa/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:f.pagamento,status:"CONFIRMED"})})).json();
  const forged=await api("/api/asaas/webhook",event,"POST",{"asaas-access-token":"chave-incorreta"});check("webhook recusa token errado",forged.status===401);
  const paid=await api("/api/asaas/webhook",event,"POST",{"asaas-access-token":env.ASAAS_WEBHOOK_TOKEN});check("webhook pago confirmado",paid.status===200,paid);
  const paidReplay=await api("/api/asaas/webhook",event,"POST",{"asaas-access-token":env.ASAAS_WEBHOOK_TOKEN});check("webhook repetido é idempotente",paidReplay.status===200);
  const {data:profile}=await admin.from("profiles").select("plan_id,plan_origem,plan_valido_ate").eq("user_id",userId).single();check("plano Completo liberado após pagamento",profile.plan_id==="proprietario_completo"&&profile.plan_origem==="assinatura"&&Date.parse(profile.plan_valido_ate)>Date.now(),profile);
  const recurso=await page.goto(env.BASE_URL+"/painel/cofre",{waitUntil:"networkidle2",timeout:180000});check("uso do cofre após compra",recurso.status()===200&&new URL(page.url()).pathname==="/painel/cofre");
  await page.screenshot({path:resolve(output,"02-cofre-apos-compra.png"),fullPage:true});
  const cancel=await api("/api/planos/contratacao",{id,acao:"cancelar"});check("cancelamento de renovação",cancel.status===200,cancel);
  const {data:afterCancel}=await admin.from("profiles").select("plan_id").eq("user_id",userId).single();check("cancelar renovação preserva o período já pago",afterCancel.plan_id==="proprietario_completo");
  const refund=await api("/api/planos/contratacao",{id,acao:"arrependimento"});check("pedido de estorno dentro de sete dias",refund.status===200,refund);
  const refundEvent=await (await fetch(fixtureBase+"/__qa/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:f.pagamento,status:"REFUNDED"})})).json();
  const refunded=await api("/api/asaas/webhook",refundEvent,"POST",{"asaas-access-token":env.ASAAS_WEBHOOK_TOKEN});check("confirmação de estorno",refunded.status===200);
  const {data:afterRefund}=await admin.from("profiles").select("plan_id,plan_origem").eq("user_id",userId).single();check("estorno revoga o acesso adquirido",afterRefund.plan_id===initial.plan_id&&afterRefund.plan_origem===initial.plan_origem,afterRefund);
  await page.goto(env.BASE_URL+"/planos/solicitacoes?pedido="+id,{waitUntil:"networkidle2",timeout:120000});await page.screenshot({path:resolve(output,"03-estorno.png"),fullPage:true});
} catch(e) {writeFileSync(resolve(output,"falha.txt"),String(e.stack));writeFileSync(resolve(output,"browser-falha.json"),JSON.stringify({url:page.url(),errors:browserErrors,text:await page.evaluate(()=>document.body.innerText).catch(()=>""),inputs:await page.evaluate(()=>[...document.querySelectorAll("input")].map(e=>({id:e.id,type:e.type,length:e.value.length,valid:e.checkValidity(),checked:e.checked}))).catch(()=>[])},null,2));await page.screenshot({path:resolve(output,"falha.png"),fullPage:true}).catch(()=>{});throw e;} finally {await browser.close();}
