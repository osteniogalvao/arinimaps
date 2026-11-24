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
const check=(name,ok,detail)=>{results.push({name,ok:!!ok,...(detail?{detail}:{})});writeFileSync(resolve(out,"organizacao-resultados.json"),JSON.stringify({syntheticGateway:true,results},null,2));assert.ok(ok,name+" "+JSON.stringify(detail??{}));console.log("PASS "+name);};
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
const broker=await novo("corretor","corretor_imobiliaria","corretor","10.251.124.24");
const key=randomUUID(),body={planoId:"corretor_essencial",ciclo:"mensal",adicionais:[],contratar:true,aceito:true};
const pedido=await broker.api("/api/planos/solicitacoes",body,"POST",{"Idempotency-Key":key});check("corretor contrata escritório diretamente",pedido.status===200&&pedido.data.direta===true,pedido);
const id=pedido.data.solicitacao.id;
const {data:assinatura,error:asErr}=await admin.from("assinaturas_cotadas").select("org,plano").eq("id",id).single();assert.ifError(asErr);check("escritório criado para a assinatura",!!assinatura.org);
const {data:membros}=await admin.from("organization_members").select("user_id,papel_org").eq("org_id",assinatura.org);check("titular é administrador do escritório",membros.length===1&&membros[0].user_id===broker.id&&membros[0].papel_org==="admin");
const {data:faturas}=await admin.from("faturas_cotadas").select("id,pagamento,valor").eq("assinatura",id);check("mensalidade de corretor correta",faturas.length===1&&faturas[0].valor===9700,faturas);
const f=faturas[0],fixtureBase=new URL(env.ASAAS_BASE_URL).origin;
const estado=(await (await fetch(fixtureBase+"/__qa/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:f.pagamento,status:"CONFIRMED"})})).json());
const pago=await broker.api("/api/asaas/webhook",estado,"POST",{"asaas-access-token":env.ASAAS_WEBHOOK_TOKEN});check("pagamento do escritório",pago.status===200,pago);
const {data:org}=await admin.from("organizations").select("plan_id,plan_valido_ate").eq("id",assinatura.org).single();check("plano aplicado ao escritório após pagamento",org.plan_id==="corretor_essencial"&&Date.parse(org.plan_valido_ate)>Date.now(),org);
const atendimento=randomUUID();
const abrir=await broker.api("/api/painel/crm",{id:atendimento,nome:"Contato QA próprio",assunto:"Imóvel sintético após compra"});check("uso real do CRM após comprar",abrir.status===201,abrir);
const detalhe=await broker.api("/api/painel/crm?id="+atendimento,undefined,"GET");check("leitura do atendimento recém-criado",detalhe.status===200,detalhe);
const duplicado=await broker.api("/api/planos/solicitacoes",body,"POST",{"Idempotency-Key":key});check("repetição de contratação não cria outro escritório",duplicado.status===200&&duplicado.data.solicitacao.id===id);
const {data:assinaturas}=await admin.from("assinaturas_cotadas").select("id").eq("titular",broker.id).not("aceite","is",null);check("somente uma assinatura aceita",assinaturas.length===1);
const outro=await novo("corretor","corretor_imobiliaria","corretor","10.251.124.25");
const ver=await outro.api("/api/painel/crm?id="+atendimento,undefined,"GET");check("outro corretor não lê o atendimento",[403,404].includes(ver.status),ver);
const pagarOutro=await outro.api("/api/planos/contratacao",{id,acao:"cancelar"});check("outro titular não cancela assinatura",[403,409].includes(pagarOutro.status),pagarOutro);
const pixOutro=await outro.api("/api/planos/pix?fatura="+f.id,undefined,"GET");check("Pix não expõe cobrança de outro titular",pixOutro.status===404,pixOutro);
for(const [perfil,assunto] of [["instituicao","Proposta · Sou órgão público ou instituição"],["correspondente","Avise-me · Sou correspondente bancário"]]){
  const antes=(await (await fetch(fixtureBase+"/__qa/state")).json()).payments.length;
  const solicitar=await broker.api("/api/suporte",{nome:"QA Proposta "+perfil,email:"qa.proposta@example.test",assunto,categoria:"outro",mensagem:assunto+"\nOrganização sintética QA\nIturama MG\nSolicito demonstração e proposta antes de contratar."});
  check(perfil+" proposta gera protocolo",solicitar.status===200&&!!solicitar.data.codigo,solicitar);
  const {data:ticket}=await admin.from("support_tickets").select("id,assunto,status").eq("id",solicitar.data.id).single();check(perfil+" proposta chega à Central",ticket?.assunto===assunto,ticket);
  const depois=(await (await fetch(fixtureBase+"/__qa/state")).json()).payments.length;check(perfil+" proposta não gera cobrança automática",depois===antes);
}
