// QA real de chat interno e terminal de ponto. Somente .env.audit/loopback.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {createHmac} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {createServerClient} from "@supabase/ssr";
const e=Object.fromEntries(readFileSync(".env.audit","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
assert.equal(e.SUPABASE_PROJECT_REF,"arini-qa-20261124");for(const key of ["BASE_URL","NEXT_PUBLIC_SUPABASE_URL"])assert.ok(["127.0.0.1","localhost"].includes(new URL(e[key]).hostname));assert.equal(new URL(e.NEXT_PUBLIC_SUPABASE_URL).port,"55421");
const run=Date.now(),base=e.BASE_URL,dir=resolve("../auditoria-funcional-2026-11-24/chat-ponto",String(run));mkdirSync(dir,{recursive:true});
const db=createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const report={run,startedAt:new Date().toISOString(),method:"HTTP real + Supabase QA + fixtures sintéticas exclusivas",results:[],accounts:[]};
const save=()=>writeFileSync(resolve(dir,"resultado.json"),JSON.stringify(report,null,2));
function check(name,ok,response,detail){report.results.push({name,ok:!!ok,...(response?{status:response.status,ms:response.ms}:{}),...(detail?{detail}:{} )});save();console.log((ok?"PASS ":"FAIL ")+name);return ok;}
function totp(secret){const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";const bits=[...secret.replace(/=+$/,"").toUpperCase()].map(c=>abc.indexOf(c).toString(2).padStart(5,"0")).join("");const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac("sha1",key).update(b).digest();const o=h.at(-1)&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,"0");}
async function account(label,role,setores,index){
 const email=`qa.chatponto.${run}.${label}@example.test`,created=await db.auth.admin.createUser({email,password:e.SEED_USER_PASSWORD,email_confirm:true,user_metadata:{nome:"QA "+label}});assert.ifError(created.error);const id=created.data.user.id;
 const updated=await db.from("profiles").update({role,setores,nome:"QA "+label,avisos_email:false}).eq("user_id",id);assert.ifError(updated.error);report.accounts.push({label,id,email,role,setores});save();
 const jar=new Map();const sb=createServerClient(e.NEXT_PUBLIC_SUPABASE_URL,e.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:all=>{for(const {name,value,options} of all){if(!value||options?.maxAge===0)jar.delete(name);else jar.set(name,value);}}}});
 async function api(path,body,method=body===undefined?"GET":"POST"){
  const start=performance.now();const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json",Origin:base,"x-real-ip":`10.251.225.${index}`,Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join("; ")},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});
  for(const c of r.headers.getSetCookie()){const v=c.split(";")[0],n=v.indexOf("="),name=v.slice(0,n),value=v.slice(n+1);if(!value||/max-age=0/i.test(c))jar.delete(name);else jar.set(name,value);}let data;try{data=await r.json()}catch{data=null}return {status:r.status,data,ms:Math.round(performance.now()-start)};
 }
 assert.equal((await api("/api/acesso",{senha:e.SITE_SENHA})).status,200);assert.equal((await api("/api/auth/entrar",{email,senha:e.SEED_USER_PASSWORD})).status,200);
 if(role==="admin_central") {const enroll=await sb.auth.mfa.enroll({factorType:"totp",friendlyName:"QA ChatPonto"});assert.ifError(enroll.error);const verify=await sb.auth.mfa.challengeAndVerify({factorId:enroll.data.id,code:totp(enroll.data.totp.secret)});assert.ifError(verify.error);check("MFA real confirmado para conta diretoria fixture",true);}
 return {id,label,api,sb};
}
try{
 const a=await account("comercial","analista_arini",["comercial"],1),b=await account("financeiro","analista_arini",["financeiro"],2),c=await account("marketing","analista_arini",["marketing"],3),d=await account("diretoria","admin_central",[],4);
 const list=await a.api("/api/admin/chat");check("chat lista somente canais do setor",list.status===200&&list.data?.conversas?.filter(v=>v.tipo==="setor").every(v=>v.setor==="comercial"),list);
 const direct=await Promise.all([a.api("/api/admin/chat",{acao:"direta",com:b.id}),b.api("/api/admin/chat",{acao:"direta",com:a.id})]);
 const cid=direct[0].data?.conversa;check("abertura concorrente recíproca gera uma conversa direta",!!cid&&direct.every(v=>v.status===200&&v.data?.conversa===cid));
 const parts=await db.from("chat_participantes").select("user_id").eq("conversa_id",cid);check("direta possui exatamente dois participantes",!parts.error&&parts.data.length===2&&parts.data.every(p=>[a.id,b.id].includes(p.user_id)));
 const sent=await a.api("/api/admin/chat",{acao:"enviar",conversa:cid,texto:"QA mensagem privada entre duas pessoas"});check("enviar mensagem direta",sent.status===200&&sent.data?.ok,sent);
 const read=await b.api("/api/admin/chat?conversa="+cid);check("destinatário lê mensagem e marca conversa lida",read.status===200&&read.data?.mensagens?.some(m=>m.id===sent.data?.id)&&read.data?.conversas?.find(v=>v.id===cid)?.nao_lida===false,read);
 for(const who of [c,d]){const forbidden=await who.api("/api/admin/chat?conversa="+cid);check(who.label+": não lê conversa direta alheia",forbidden.status===404,forbidden);const send=await who.api("/api/admin/chat",{acao:"enviar",conversa:cid,texto:"NÃO DEVE ENTRAR"});check(who.label+": não escreve em conversa direta alheia",send.status===404,send);}
 const channel=list.data?.conversas?.find(v=>v.tipo==="setor"&&v.setor==="comercial")?.id;assert.ok(channel);
 const channelSend=await a.api("/api/admin/chat",{acao:"enviar",conversa:channel,texto:"QA canal comercial"});check("membro publica no canal do próprio setor",channelSend.status===200,channelSend);
 const channelDenied=await b.api("/api/admin/chat?conversa="+channel);check("outro setor não lê canal comercial",channelDenied.status===404,channelDenied);
 const channelAdmin=await d.api("/api/admin/chat?conversa="+channel);check("diretoria lê canal setorial",channelAdmin.status===200&&channelAdmin.data?.mensagens?.some(m=>m.id===channelSend.data?.id),channelAdmin);
 for(const [label,payload] of [["mensagem vazia",{acao:"enviar",conversa:cid,texto:"   "}],["texto numérico",{acao:"enviar",conversa:cid,texto:123}],["texto objeto",{acao:"enviar",conversa:cid,texto:{}}],["texto acima de4000 caracteres",{acao:"enviar",conversa:cid,texto:"a".repeat(4001)}],["corpo null",null],["corpo array",[]]]){const result=await a.api("/api/admin/chat",payload);check("chat rejeita "+label+" com400",result.status===400,result);}
 const badPin=await a.api("/api/admin/ponto/pin",{pin:"1234"});check("PIN óbvio recusado",badPin.status===400,badPin);
 const repeatPin=await a.api("/api/admin/ponto/pin",{pin:"7777"});check("PIN repetitivo recusado",repeatPin.status===400,repeatPin);
 for(const body of [null,{pin:7429},[]]){const invalid=await a.api("/api/admin/ponto/pin",body);check("PIN recusa envelope/tipo inválido "+JSON.stringify(body),invalid.status===400,invalid);}
 const pin="7429",pinSet=await a.api("/api/admin/ponto/pin",{pin,user_id:b.id});check("usuário define próprio PIN sem resposta sensível",pinSet.status===200&&JSON.stringify(pinSet.data)==='{"ok":true}',pinSet);
 const hash=await db.from("ponto_pins").select("pin_hash").eq("user_id",a.id).single(),otherPin=await db.from("ponto_pins").select("user_id").eq("user_id",b.id).maybeSingle();check("PIN guardado somente como bcrypt e identidade enviada não troca titular",!hash.error&&/^\$2[aby]\$/.test(hash.data.pin_hash)&&hash.data.pin_hash!==pin&&!otherPin.data);
 const identity=await a.sb.auth.getUser();check("testeRLS usa identidade autenticada da equipe",identity.data?.user?.id===a.id);
 const privateHash=await a.sb.from("ponto_pins").select("*");check("API pública autenticada não permite ler hashes de PIN",privateHash.error?.code==="42501",null,{code:privateHash.error?.code});
 for(const body of [null,{user_id:a.id,pin:7429},[]]){const invalid=await d.api("/api/admin/ponto/terminal",body);check("terminal recusa envelope/tipo inválido "+JSON.stringify(body),invalid.status===400,invalid);}
 const wrongOperator=await c.api("/api/admin/ponto/terminal",{user_id:a.id,pin});check("equipe sem permissão não opera terminal",wrongOperator.status===403,wrongOperator);
 const wrongPin=await d.api("/api/admin/ponto/terminal",{user_id:a.id,pin:"8516"});check("PIN errado não registra ponto",wrongPin.status===400,wrongPin);
 const before=await db.from("ponto_marcacoes").select("id",{count:"exact",head:true}).eq("user_id",a.id);check("nenhuma marcação após PIN inválido",!before.error&&before.count===0);
 const marks=await Promise.all([d.api("/api/admin/ponto/terminal",{user_id:a.id,pin}),d.api("/api/admin/ponto/terminal",{user_id:a.id,pin})]);check("dois envios simultâneos geram uma marcação e um409",marks.map(x=>x.status).sort().join(",")==="200,409");
 const rows=await db.from("ponto_marcacoes").select("id,user_id,operador,origem,hash,nsr,marcado_em").eq("user_id",a.id);check("marcação preserva titular e registra operador da diretoria",!rows.error&&rows.data.length===1&&rows.data[0].user_id===a.id&&rows.data[0].operador===d.id&&rows.data[0].origem==="terminal");
 const snapshot=JSON.stringify(rows.data);const duplicate=await d.api("/api/admin/ponto/terminal",{user_id:a.id,pin});const unchanged=await db.from("ponto_marcacoes").select("id,user_id,operador,origem,hash,nsr,marcado_em").eq("user_id",a.id);check("nova tentativa emmenos1min mantém registro e hash originais",duplicate.status===409&&snapshot===JSON.stringify(unchanged.data),duplicate);
 // Cliente autenticado não altera uma marcação existente pela API de dados.
 const mutation=await a.sb.from("ponto_marcacoes").update({origem:"web"}).eq("id",rows.data[0].id).select("id");const stable=await db.from("ponto_marcacoes").select("hash,origem").eq("id",rows.data[0].id).single();check("RLS/imutabilidade impedem editar marcação existente",(!!mutation.error||mutation.data.length===0)&&stable.data?.origem==="terminal"&&stable.data?.hash===rows.data[0].hash);
 const otherValid=await b.api("/api/admin/ponto/pin",{pin:"6382"});check("segunda pessoa define PIN próprio",otherValid.status===200,otherValid);
 const attempts=[];for(let i=0;i<6;i++)attempts.push(await d.api("/api/admin/ponto/terminal",{user_id:b.id,pin:"8516"}));check("sexta tentativa dePIN bloqueada porlimite",attempts.slice(0,5).every(r=>r.status===400)&&attempts[5].status===429);
 const reception=await db.from("profiles").update({atendimento_recepcao:true}).eq("user_id",c.id);assert.ifError(reception.error);const receptionPin=await c.api("/api/admin/ponto/pin",{pin:"5846"});check("recepção define seu PIN",receptionPin.status===200,receptionPin);
 const receptionMark=await c.api("/api/admin/ponto/terminal",{user_id:c.id,pin:"5846"});const receptionRow=await db.from("ponto_marcacoes").select("user_id,operador,origem").eq("id",receptionMark.data?.comprovante?.id??"00000000-0000-4000-8000-000000000000").maybeSingle();check("recepção autorizada também opera terminal",receptionMark.status===200&&receptionRow.data?.user_id===c.id&&receptionRow.data?.operador===c.id&&receptionRow.data?.origem==="terminal",receptionMark);
 report.finishedAt=new Date().toISOString();report.summary={checks:report.results.length,passed:report.results.filter(r=>r.ok).length,failed:report.results.filter(r=>!r.ok).length};save();console.log(JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
}catch(err){report.error=String(err.message);save();console.error(err.message);process.exitCode=1;}
console.log("Evidence: "+dir);
