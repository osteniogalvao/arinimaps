// 100 contas sintéticas, jornadas HTTP reais na aplicação e Supabase isolados.
// Não equivale a 100 sessões de navegador nem a teste de carga/compra externa.
// node --experimental-strip-types scripts/qa/100-clientes-e2e.mjs [--limit=2]
// Somente .env.audit. Nenhuma leitura/fallback de .env.local.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,unlinkSync} from "node:fs";
import {resolve,dirname,sep} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {createServerClient} from "@supabase/ssr";
import ts from "typescript";
import {compileFunction} from "node:vm";
import {assinatura} from "../../src/lib/juridico/versoes.ts";

// Lê os literais reais do catálogo sem reimplementar defaults nem importar módulos Next server-only.
const catalogSource=readFileSync(new URL("../../src/lib/planos.ts",import.meta.url),"utf8");
function catalog(name){const source=catalogSource.match(new RegExp("export const "+name+"[^=]*= \\[([\\s\\S]*?)\\n\\];"))?.[0];assert.ok(source,"Catálogo ausente: "+name);const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const exports={};compileFunction(code,["exports"])(exports);return exports[name];}
const PERSONAS_PLANOS=catalog("PERSONAS_PLANOS"),NICHOS=catalog("NICHOS");

const env=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const n=l.indexOf("=");return [l.slice(0,n),l.slice(n+1)];}));
assert.equal(env.SUPABASE_PROJECT_REF,"arini-qa-20261124","Somente projeto QA");
for(const k of ["BASE_URL","NEXT_PUBLIC_SUPABASE_URL","DATABASE_URL"])assert.ok(["127.0.0.1","localhost"].includes(new URL(env[k]).hostname),"Somente loopback: "+k);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).port,"55421");
const base=env.BASE_URL.replace(/\/$/,"");
const resumeFile=process.argv.find(v=>v.startsWith("--resume="))?.slice(9);
if(resumeFile)assert.ok(resolve(resumeFile).toLowerCase().startsWith(resolve("../auditoria-funcional-2026-11-24/clientes-100").toLowerCase()+sep),"Checkpoint deve estar na pasta QA de clientes");
const previous=resumeFile?JSON.parse(readFileSync(resumeFile,"utf8")):null;
const limit=previous?.expectedClients??Number(process.argv.find(v=>v.startsWith("--limit="))?.split("=")[1]??100);
assert.ok(Number.isInteger(limit)&&limit>=1&&limit<=100);
const runId=previous?.runId??new Date().toISOString().replace(/[^0-9]/g,"");
const output=resumeFile?dirname(resolve(resumeFile)):resolve("../auditoria-funcional-2026-11-24/clientes-100",runId);
mkdirSync(output,{recursive:true});
const appRoot=resolve(process.argv.find(v=>v.startsWith("--app-root="))?.slice(11)??"../auditoria-funcional-2026-11-24/app");
assert.ok(appRoot.toLowerCase().startsWith(resolve("../auditoria-funcional-2026-11-24").toLowerCase()+sep),"Fonte do app deve estar no ambiente isolado");
function appDigest(){const root=resolve(appRoot,"src"),hash=createHash("sha256");if(!existsSync(root))return null;const walk=(dir)=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=resolve(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()){hash.update(file.slice(root.length));hash.update(readFileSync(file));}}};walk(root);return hash.digest("hex");}
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const matrix=await admin.from("matriz_personas").select("id",{count:"exact",head:true});
assert.ifError(matrix.error);assert.equal(matrix.count,915,"Importe a configuração dos915 itens antes da auditoria; migrations sozinhas não preenchem a matriz");
const recoveredUsers=new Map();
if(previous){for(let page=1;;page++){const r=await admin.auth.admin.listUsers({page,perPage:1000});assert.ifError(r.error);for(const u of r.data.users)if(u.email?.startsWith(`qa100.${runId}.`))recoveredUsers.set(u.email,u.id);if(r.data.users.length<1000)break;}}
const report=previous??{runId,startedAt:new Date().toISOString(),base,appSourceDigestStart:appDigest(),method:"100 contas fixture; HTTP da aplicação, Auth, PostgREST e RLS reais; concorrência4; sem pagamentos externos, sem simulação de cliques",limits:["Cadastros preparados com AuthAdmin; não são100 cadastros públicos pela interface","Empresa/instituição provisionadas pelaMatriz como fixture","As jornadas não validam cada módulo do produto nem desempenho sob100 acessos simultâneos"],expectedClients:limit,clients:[],supportFixtures:[],summary:null};
if(previous){assert.equal(report.base,base);(report.resumptions??=[]).push({at:new Date().toISOString(),appSourceDigest:appDigest(),completedBefore:report.clients.filter(c=>c.ok).length});delete report.pausedAt;if(existsSync(resolve(output,"PAUSE")))unlinkSync(resolve(output,"PAUSE"));}
let stopRequested=false;process.on("SIGINT",()=>{stopRequested=true;console.log("Pausa solicitada: concluindo apenas jornadas ativas antes do checkpoint.");});
function save(){writeFileSync(resolve(output,"resultado.json"),JSON.stringify(report,null,2));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function jarSession(index){
  const jar=new Map();
  const setCookies=list=>{for(const c of list){const first=c.split(";")[0],n=first.indexOf("="),name=first.slice(0,n),value=first.slice(n+1);if(/max-age=0/i.test(c)||!value)jar.delete(name);else jar.set(name,value);}};
  async function call(path,{method="GET",body}={}){
    const start=performance.now();const response=await fetch(base+path,{method,redirect:"manual",headers:{"Content-Type":"application/json",Origin:base,"x-real-ip":`10.251.224.${index+1}`,"User-Agent":"ARINI-isolated-functional-QA/100","Cookie":[...jar].map(([k,v])=>`${k}=${v}`).join("; ")},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(path.startsWith("/planos")?180000:60000)});
    setCookies(response.headers.getSetCookie());const raw=await response.text();let data=null;try{data=JSON.parse(raw)}catch{}
    return {status:response.status,data,text:raw,durationMs:Math.round(performance.now()-start),location:response.headers.get("location")};
  }
  async function signOut(){
    const sb=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{
      cookies:{
        getAll:()=>[...jar].map(([name,value])=>({name,value})),
        setAll:list=>{for(const {name,value,options} of list){if(options?.maxAge===0||!value)jar.delete(name);else jar.set(name,value);}},
      },
    });
    return sb.auth.signOut();
  }
  return {call,signOut};
}
function check(client,name,condition,response,detail){client.checks.push({name,ok:!!condition,...(response?{status:response.status,durationMs:response.durationMs}:{}),...(detail?{detail}:{} )});save();return !!condition;}
async function provision(email,nome,role,nicho,existingId){
  let id=existingId;if(!id){const created=await admin.auth.admin.createUser({email,password:env.SEED_USER_PASSWORD,email_confirm:true,user_metadata:{nome,role}});assert.ifError(created.error);id=created.data.user.id;}
  const updated=await admin.from("profiles").update({nome,role,nicho,avisos_email:false,aceite_termos_at:new Date().toISOString(),aceite_termos_versao:assinatura("termos-de-uso","privacidade")}).eq("user_id",id).select("user_id,role,nicho,plan_id,entrada_ativa").single();assert.ifError(updated.error);
  if(role==="proprietario") {const existing=await admin.from("owners").select("id").eq("profile_id",id).limit(1);assert.ifError(existing.error);if(!existing.data.length){const own=await admin.from("owners").insert({profile_id:id,status:"ativo",aceite_termos_at:new Date().toISOString()});assert.ifError(own.error);}}
  if(["corretor","engenheiro","leiloeiro"].includes(role)){const existing=await admin.from("partners").select("id").eq("profile_id",id).eq("tipo",role).limit(1);assert.ifError(existing.error);if(!existing.data.length){const partner=await admin.from("partners").insert({profile_id:id,tipo:role,razao_social:nome,status:"solicitado",aceite_termos_at:new Date().toISOString()});assert.ifError(partner.error);}}
  return updated.data;
}
const personas=PERSONAS_PLANOS.filter(p=>p.id!=="divulgador");assert.equal(personas.length,10);
const savedSentinel=report.supportFixtures[0];
const sentinel=savedSentinel?{user_id:savedSentinel.userId}:await provision(`qa100.sentinel.${runId}@example.test`,"QA100 somente isolamento","proprietario","proprietario");
const sentinelId=savedSentinel?.propertyId??randomUUID();
if(!savedSentinel){const sent=await admin.rpc("cofre_salvar_propriedade",{p_titular:sentinel.user_id,p_id:sentinelId,p_nome:"QA100 COFRE SENTINELA PRIVADO",p_municipio:"Iturama MG",p_area_ha:1,p_car:null,p_matricula:null,p_nova:true});assert.ifError(sent.error);report.supportFixtures.push({type:"cofre sentinela, fora das100contas avaliadas",userId:sentinel.user_id,propertyId:sentinelId});}save();

async function journey(index){
  const persona=personas[index%personas.length],nicho=persona.nichos[0],role=persona.papel??NICHOS.find(n=>n.id===nicho).papeis[0];
  const code="C"+String(index+1).padStart(3,"0"),nome=`QA100 ${code} ${persona.id}`,email=`qa100.${runId}.${code.toLowerCase()}@example.test`;
  let client=report.clients.find(c=>c.code===code);
  if(client){(client.previousAttempts??=[]).push({startedAt:client.startedAt,finishedAt:client.finishedAt,checks:client.checks,ok:client.ok,error:client.error,interrupted:client.ok===undefined});client.checks=[];client.startedAt=new Date().toISOString();delete client.error;delete client.ok;delete client.finishedAt;}else{client={code,persona:persona.id,role,nicho,email,fixtureProvisioning:persona.papel?"AuthAdmin imitando cadastro de persona":"Acesso atribuído pela Matriz (fixture)",startedAt:new Date().toISOString(),checks:[]};report.clients.push(client);}save();const totalStart=performance.now();const session=jarSession(index);
  try {
    client.userId??=recoveredUsers.get(email);save();
    const fixture=await provision(email,nome,role,nicho,client.userId);client.userId=fixture.user_id;client.initialPlan=fixture.plan_id;save();
    if(client.fixtureVaultId){const clean=await admin.from("cofre_propriedades").delete().eq("id",client.fixtureVaultId).eq("titular_id",fixture.user_id);assert.ifError(clean.error);delete client.fixtureVaultId;}
    const gate=await session.call("/api/acesso",{method:"POST",body:{senha:env.SITE_SENHA}});check(client,"senha de acesso da homologação",gate.status===200,gate);
    const login=await session.call("/api/auth/entrar",{method:"POST",body:{email,senha:env.SEED_USER_PASSWORD}});
    if(!check(client,"login real na aplicação, papel e ausência de MFA pendente",login.status===200&&login.data?.role===role&&login.data?.mfa===false,login,{returnedRole:login.data?.role,error:login.data?.error}))throw new Error("Login não confirmado; dependentes nãoexecutados");
    const context=await session.call("/api/conta/contexto",{method:"POST",body:{entrada:persona.id,aceite:true,versao:assinatura("termos-de-uso","privacidade")}});
    check(client,"selecionar contexto da persona",context.status===200,context,{error:context.data?.error});
    const actual=await admin.from("profiles").select("role,nicho,entrada_ativa,plan_id").eq("user_id",fixture.user_id).single();
    check(client,"papel, nicho e entrada persistem corretos",!actual.error&&actual.data?.role===role&&actual.data?.nicho===nicho&&actual.data?.entrada_ativa===persona.id,null,actual.data);
    const prefs=await session.call("/api/conta/preferencias");check(client,"ler apenas preferências da própria conta",prefs.status===200&&prefs.data?.nome===nome,prefs);
    const tema=index%2?"escuro":"claro";
    const patch=await session.call("/api/conta/preferencias",{method:"PATCH",body:{tema,mapa_base:"mapa",emails_novidades:false}});check(client,"alterar preferências",patch.status===200&&patch.data?.preferencias?.tema===tema,patch);
    const again=await session.call("/api/conta/preferencias");check(client,"preferências persistem numa nova leitura",again.status===200&&again.data?.preferencias?.tema===tema&&again.data?.preferencias?.mapa_base==="mapa",again);
    const profile=await session.call("/api/conta",{method:"PATCH",body:{nome:nome+" Atualizado",avisos_email:false,role:"admin_central",setores:["diretoria"]}});
    const profileAfter=await admin.from("profiles").select("role,setores,nome").eq("user_id",fixture.user_id).single();
    check(client,"editar perfil próprio sem autoelevar papel/setor",profile.status===200&&profileAfter.data?.nome===nome+" Atualizado"&&profileAfter.data?.role===role&&!profileAfter.data?.setores?.includes("diretoria"),profile);
    const plans=await session.call("/planos?perfil="+persona.id);check(client,"página de planos correspondente responde e identifica persona",plans.status===200&&plans.text.includes(persona.nome),plans);
    const orders=await session.call("/api/planos/solicitacoes");check(client,"conta nova não recebe pedidos de outros clientes",orders.status===200&&Array.isArray(orders.data?.solicitacoes)&&orders.data.solicitacoes.length===0,orders);
    const denied=await session.call("/api/admin/planos",{method:"PATCH",body:{id:"qa100_deve_ser_negado",nome:"NÃO CRIAR"}});check(client,"bloquear cliente tentando administrar planos",denied.status===403,denied);
    const ownVault=["proprietario","produtor_rural"].includes(nicho);
    const vault=await session.call("/api/painel/cofre");check(client,"capacidade de cofre respeita persona e não vaza outra conta",vault.status===(ownVault?200:403)&&(!ownVault||Array.isArray(vault.data?.propriedades)&&!vault.data.propriedades.some(p=>p.id===sentinelId)),vault);
    const foreign=await session.call("/api/painel/cofre/documentos?propriedade="+sentinelId);check(client,"IDOR: documentos de outro titular bloqueados",foreign.status===(ownVault?404:403),foreign);
    const attempt=await session.call("/api/painel/cofre",{method:"PATCH",body:{id:sentinelId,nome:"TENTATIVA INDEVIDA",municipio:"Iturama",area_ha:2}});check(client,"IDOR: alteração de propriedade alheia bloqueada",attempt.status===(ownVault?404:403),attempt);
    if(ownVault){
      const ownId=randomUUID();client.fixtureVaultId=ownId;save();const data={id:ownId,nome:`Cofre ${code}`,municipio:"Iturama MG",area_ha:2};
      const add=await session.call("/api/painel/cofre",{method:"POST",body:data});check(client,"incluir propriedade própria pelo produto",add.status===200&&add.data?.id===ownId,add,{error:add.data?.error});
      const list=await session.call("/api/painel/cofre");check(client,"propriedade criada aparece apenas no próprio cofre",list.status===200&&list.data?.propriedades?.some(p=>p.id===ownId)&&!list.data?.propriedades?.some(p=>p.id===sentinelId),list);
      const edit=await session.call("/api/painel/cofre",{method:"PATCH",body:{...data,area_ha:3}});const verify=await admin.from("cofre_propriedades").select("area_ha,titular_id").eq("id",ownId).maybeSingle();
      check(client,"editar propriedade persiste valor e titular",edit.status===200&&Number(verify.data?.area_ha)===3&&verify.data?.titular_id===fixture.user_id,edit);
      const del=await session.call("/api/painel/cofre?id="+ownId,{method:"DELETE"});const absent=await admin.from("cofre_propriedades").select("id").eq("id",ownId).maybeSingle();check(client,"excluir propriedade própria remove registro",del.status===200&&!absent.error&&!absent.data,del);
    }
    const event=await session.call("/api/auth/evento",{method:"POST",body:{evento:"logout"}});check(client,"registrar evento de saída",event.status===200,event);
    const signout=await session.signOut();check(client,"logout real no Supabase e remoção de cookies",!signout.error,null,{error:signout.error?.message});
    const after=await session.call("/api/conta/preferencias");check(client,"sessão encerrada perde acesso privado",after.status===401,after);
    const audit=await admin.from("auth_events").select("evento").eq("user_id",fixture.user_id).in("evento",["login_ok","logout"]);
    check(client,"login e logout registrados no histórico",!audit.error&&audit.data.some(e=>e.evento==="login_ok")&&audit.data.some(e=>e.evento==="logout"));
  } catch(error){client.error=String(error.message).slice(0,300);client.checks.push({name:"execução sem interrupção",ok:false,detail:client.error});if(/schema cache|ECONNREFUSED|fetch failed/i.test(client.error)){stopRequested=true;(report.infrastructureInterruptions??=[]).push({at:new Date().toISOString(),client:client.code,error:client.error});}}
  finally{client.finishedAt=new Date().toISOString();client.durationMs=Math.round(performance.now()-totalStart);client.ok=client.checks.length>0&&client.checks.every(c=>c.ok);save();console.log(`${client.ok?"PASS":"FAIL"} ${code} ${persona.id} ${client.checks.filter(c=>c.ok).length}/${client.checks.length} ${client.durationMs}ms`);}
}
// Quatro jornadas simultâneas, sem resetar contadores de abuso e com IPs QA distintos.
const pending=Array.from({length:limit},(_,i)=>i).filter(i=>!report.clients.find(c=>c.code==="C"+String(i+1).padStart(3,"0"))?.ok);
let next=0;await Promise.all([0,1,2,3].map(async()=>{while(!stopRequested&&next<pending.length){if(existsSync(resolve(output,"PAUSE"))){stopRequested=true;break;}const i=pending[next++];await journey(i);await sleep(100);}}));
if(stopRequested){report.pausedAt=new Date().toISOString();save();console.log("Checkpoint salvo. Retome com --resume="+resolve(output,"resultado.json"));process.exit(0);}
const sentinelAfter=await admin.from("cofre_propriedades").select("nome,area_ha,titular_id").eq("id",sentinelId).single();
report.sentinelUnchanged=!sentinelAfter.error&&sentinelAfter.data.nome==="QA100 COFRE SENTINELA PRIVADO"&&Number(sentinelAfter.data.area_ha)===1&&sentinelAfter.data.titular_id===sentinel.user_id;
report.clients.sort((a,b)=>a.code.localeCompare(b.code));
report.finishedAt=new Date().toISOString();report.appSourceDigestEnd=appDigest();report.sourceChangedDuringRun=report.appSourceDigestStart!==report.appSourceDigestEnd;const checks=report.clients.flatMap(c=>c.checks);
report.summary={clients:report.clients.length,passedClients:report.clients.filter(c=>c.ok).length,failedClients:report.clients.filter(c=>!c.ok).length,checks:checks.length,passedChecks:checks.filter(c=>c.ok).length,failedChecks:checks.filter(c=>!c.ok).length,personas:Object.fromEntries(personas.map(p=>[p.id,report.clients.filter(c=>c.persona===p.id).length])),sentinelUnchanged:report.sentinelUnchanged};save();
const csv=["cliente;persona;teste;resultado;http;ms",...report.clients.flatMap(c=>c.checks.map(k=>[c.code,c.persona,k.name,k.ok?"PASS":"FAIL",k.status??"",k.durationMs??""].map(x=>'"'+String(x).replaceAll('"','""')+'"').join(';')))].join('\r\n');writeFileSync(resolve(output,"assertivas.csv"),'\uFEFF'+csv);
console.log(JSON.stringify(report.summary));console.log("Evidence: "+output);if(report.summary.failedClients||!report.sentinelUnchanged)process.exitCode=1;
