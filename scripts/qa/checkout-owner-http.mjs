// HTTP real da aplicação e banco de QA; gateway sintético em loopback.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {randomBytes,randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
const env=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),x.slice(i+1)];}));
for(const k of ["BASE_URL","NEXT_PUBLIC_SUPABASE_URL","ASAAS_BASE_URL"])assert.ok(["127.0.0.1","localhost"].includes(new URL(env[k]).hostname));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const out=resolve("../auditoria-funcional-2026-11-24/checkout");mkdirSync(out,{recursive:true});const results=[];
const check=(name,ok,detail)=>{results.push({name,ok:!!ok,...(detail?{detail}:{})});writeFileSync(resolve(out,"proprietario-http-resultados.json"),JSON.stringify({syntheticGateway:true,results},null,2));assert.ok(ok,name+" "+JSON.stringify(detail??{}));console.log("PASS "+name);};
function cliente(ip){const jar=new Map();return async(path,body,method="POST",headers={})=>{
  const r=await fetch(env.BASE_URL+path,{method,headers:{"Content-Type":"application/json","Cookie":[...jar].map(([k,v])=>k+"="+v).join("; "),"x-real-ip":ip,...headers},...(method==="GET"?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)});
  for(const c of r.headers.getSetCookie()){const pair=c.split(";")[0],i=pair.indexOf("=");jar.set(pair.slice(0,i),pair.slice(i+1));}
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={html:true};}return {status:r.status,data};
};}
const versao="termos-de-uso@2026.11.15,privacidade@2026.11.15";
async function novo(role,nicho,entrada,ip){
  const api=cliente(ip);await api("/api/acesso",{senha:env.SITE_SENHA});
  const email="qa."+role+"."+Date.now()+"@example.test",senha="Qa!"+randomBytes(12).toString("hex"),d=[...randomBytes(9)].map(x=>x%10);
  for(const w of [10,11]){const s=d.reduce((a,v,i)=>a+v*(w-i),0),n=11-s%11;d.push(n>=10?0:n);}
  const nome="QA Compra "+role+" "+Date.now();
  const cadastro=await api("/api/cadastro",{email,senha,nome,cpf:d.join(""),role,nicho,aceite_termos:true,versao_termos:versao});check(role+" cadastro HTTP",cadastro.status===200,cadastro);
  const login=await api("/api/auth/entrar",{email,senha});check(role+" login HTTP",login.status===200,login);
  const contexto=await api("/api/conta/contexto",{entrada,aceite:true,versao});check(role+" contexto",contexto.status===200,contexto);
  const {data:profile,error}=await admin.from("profiles").select("user_id,plan_id").eq("nome",nome).single();assert.ifError(error);
  return {api,id:profile.user_id};
}
const owner=await novo("proprietario","proprietario","vender","10.251.124.26");
const {data:initial}=await admin.from("profiles").select("plan_id,plan_origem").eq("user_id",owner.id).single();
const key=randomUUID(),body={planoId:"proprietario_completo",ciclo:"mensal",adicionais:[{id:"propriedade_adicional",quantidade:1}],contratar:true,aceito:true};
const pedido=await owner.api("/api/planos/solicitacoes",body,"POST",{"Idempotency-Key":key});check("proprietário contrata Completo com uma vaga adicional",pedido.status===200&&pedido.data.direta===true,pedido);
const id=pedido.data.solicitacao.id;
const {data:faturas}=await admin.from("faturas_cotadas").select("id,pagamento,valor,status").eq("assinatura",id);check("promoção 69,90 + adicional 15,00",faturas.length===1&&faturas[0].valor===8490,faturas);
const f=faturas[0],fixtureBase=new URL(env.ASAAS_BASE_URL).origin;
const perfil=async()=>{const {data,error}=await admin.from("profiles").select("plan_id,plan_origem,plan_valido_ate").eq("user_id",owner.id).single();assert.ifError(error);return data;};
check("nenhum direito pago antes do pagamento",(await perfil()).plan_id===initial.plan_id);
const replay=await owner.api("/api/planos/solicitacoes",body,"POST",{"Idempotency-Key":key});check("idempotência reaproveita o pedido",replay.data.solicitacao.id===id);
const {count:fcount}=await admin.from("faturas_cotadas").select("id",{count:"exact",head:true}).eq("assinatura",id);check("retry não duplica cobranças",fcount===1);
const pix=await owner.api("/api/planos/pix?fatura="+f.id,undefined,"GET");check("Pix da própria fatura disponível",pix.status===200&&pix.data.codigo?.startsWith("000201"),{status:pix.status,data:pix.status===200?undefined:pix.data});
const estado=await (await fetch(fixtureBase+"/__qa/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:f.pagamento,status:"CONFIRMED"})})).json();
const semToken=await owner.api("/api/asaas/webhook",estado);check("webhook sem token é recusado",semToken.status===401);
const forjado=await owner.api("/api/asaas/webhook",{...estado,payment:{...estado.payment,value:1}},"POST",{"asaas-access-token":env.ASAAS_WEBHOOK_TOKEN});check("valor divergente não libera acesso",forjado.status===200&&(await perfil()).plan_id===initial.plan_id);
const pagar=await owner.api("/api/asaas/webhook",estado,"POST",{"asaas-access-token":env.ASAAS_WEBHOOK_TOKEN});check("confirmação real pela rota do webhook",pagar.status===200,pagar);
const ativo=await perfil();check("plano Completo aplicado após confirmação",ativo.plan_id==="proprietario_completo"&&ativo.plan_origem==="assinatura"&&Date.parse(ativo.plan_valido_ate)>Date.now(),ativo);
const webhookRetry=await owner.api("/api/asaas/webhook",estado,"POST",{"asaas-access-token":env.ASAAS_WEBHOOK_TOKEN});check("webhook repetido não prolonga período",webhookRetry.status===200&&(await perfil()).plan_valido_ate===ativo.plan_valido_ate);
const cofre=await owner.api("/api/painel/cofre",undefined,"GET");check("vaga adicional provisionada no cofre",cofre.status===200&&cofre.data.limite===4,cofre);
const propriedades=[];
for(let n=1;n<=4;n++){const p={id:randomUUID(),nome:"QA Propriedade "+n,municipio:"Iturama MG",area_ha:10+n};const r=await owner.api("/api/painel/cofre",p);check("cadastrar propriedade "+n+" após compra",r.status===200,r);propriedades.push(p);}
const extra=await owner.api("/api/painel/cofre",{id:randomUUID(),nome:"QA Quinta",municipio:"Iturama MG",area_ha:15});check("quinta propriedade excede quota e é recusada",extra.status===409,extra);
const editar=await owner.api("/api/painel/cofre",{...propriedades[0],nome:"QA Propriedade Editada"},"PATCH");check("editar propriedade própria",editar.status===200,editar);
const listar=await owner.api("/api/painel/cofre",undefined,"GET");check("alteração persiste na leitura",listar.data.total===4&&listar.data.propriedades.some(p=>p.nome==="QA Propriedade Editada"));
const cancel=await owner.api("/api/planos/contratacao",{id,acao:"cancelar"});check("cancelar renovação preserva período pago",cancel.status===200&&(await perfil()).plan_id==="proprietario_completo",cancel);
const refund=await owner.api("/api/planos/contratacao",{id,acao:"arrependimento"});check("pedido de estorno em sete dias",refund.status===200,refund);
const devolvido=await (await fetch(fixtureBase+"/__qa/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:f.pagamento,status:"REFUNDED"})})).json();
const baixa=await owner.api("/api/asaas/webhook",devolvido,"POST",{"asaas-access-token":env.ASAAS_WEBHOOK_TOKEN});check("estorno revoga plano pago",baixa.status===200&&(await perfil()).plan_id===initial.plan_id);
const restaurado=await owner.api("/api/painel/cofre",undefined,"GET");check("estorno remove vaga paga e preserva dados existentes",restaurado.status===200&&restaurado.data.limite===3&&restaurado.data.total===4,restaurado);
