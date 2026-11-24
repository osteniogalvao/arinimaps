// Navegação por telas reais; apenas QA local. Não prova operações de escrita.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createHmac } from 'node:crypto';
const env=Object.fromEntries((await readFile('.env.audit','utf8')).split(/\r?\n/).map(l=>l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const base=env.BASE_URL;
if(new URL(base).hostname!=='127.0.0.1'||!env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1:55421'))throw Error('Somente cópia QA local');
const filters=process.argv.slice(2);
const out=resolve('../auditoria-funcional-2026-11-24',filters.length?'navigation-checkout-recheck':'navigation-static-final');await mkdir(out,{recursive:true});
function totp(secret){const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bits=[...secret.replace(/=+$/,'').toUpperCase()].map(c=>abc.indexOf(c).toString(2).padStart(5,'0')).join(''),key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',key).update(counter).digest(),offset=h.at(-1)&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
const pages=[];
async function walk(dir){for(const f of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+f.name;if(f.isDirectory())await walk(p);else if(f.name==='page.tsx')pages.push(p)}}
await walk('src/app');
const excluded=[];
const routes=filters.length?filters:pages.map(p=>{const route=p.replace(/^src\/app/,'').replace(/\/\([^/]+\)/g,'').replace(/\/page.tsx$/,'')||'/';if(route.includes('[')){excluded.push({route,status:'requer fixture dinâmica'});return null}return route==='/contato-perfil'?route+'?perfil=empresa':route}).filter(Boolean);
const b=await puppeteer.launch({executablePath:env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
async function session(email){const ctx=await b.createBrowserContext(),p=await ctx.newPage();await p.setViewport({width:1440,height:900});await p.goto(base+'/entrar',{waitUntil:'domcontentloaded',timeout:180000});
 await p.evaluate(async(s,e,pw)=>{await fetch('/api/acesso',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({senha:s})});if(e){const r=await fetch('/api/auth/entrar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,senha:pw})});if(!r.ok)throw Error('Login QA HTTP '+r.status)}localStorage.setItem('arini:tour:mapa','1')},env.SITE_SENHA,email,env.SEED_USER_PASSWORD);
 if(email==='admin@arinibrasil.com.br'){
  const state=JSON.parse(await readFile(resolve('../auditoria-funcional-2026-11-24/infra/mfa-qa.private.json'),'utf8'));if(state.project!=='arini-qa-20261124')throw Error('MFA fora do QA');const account=state.accounts.find(a=>a.email===email);if(!account)throw Error('Fator QA ausente');
  await p.goto(base+'/entrar?mfa=1',{waitUntil:'networkidle2',timeout:90000});await p.waitForSelector('#mfa');await p.type('#mfa',totp(account.secret));await p.locator('form button:not([type]),form button[type="submit"]').click();await p.waitForFunction(()=>location.pathname==='/admin',{timeout:60000});console.log('MFA admin confirmado pela interface');
 }
 return p;}
try {
 const sessions={public:await session(null),admin:await session('admin@arinibrasil.com.br'),owner:await session('proprietario.teste@arinibrasil.com.br')};
 for(const route of routes){const kind=route.startsWith('/admin')?'admin':/^\/(painel|conta)(?:\/|$)|^\/planos\/solicitacoes|^\/cartografia\/solicitar|^\/suporte|^\/relatorios|^\/ferramentas/.test(route)?'owner':'public',p=sessions[kind],errors=[];const listener=e=>errors.push(e.message.slice(0,12000));p.on('pageerror',listener);const t=Date.now();let status=0,body='',failure=null;
  try{const r=await p.goto(base+route,{waitUntil:'domcontentloaded',timeout:90000});status=r?.status()||0;await new Promise(r=>setTimeout(r,500));body=await p.evaluate(()=>document.body.innerText);if(status>=400||errors.length||/Application error|Internal Server Error|Erro ao carregar/i.test(body))failure='HTTP/JS/conteúdo';if(kind==='admin'&&new URL(p.url()).pathname==='/entrar')failure='Sessão perdida';}catch(e){failure=e.message.slice(0,200)}
  const expectedPath=new URL(base+route).pathname,finalPath=new URL(p.url()).pathname;
  if(finalPath!==expectedPath)failure ||= 'Redirecionamento: '+finalPath;
  if(/Ative a verificação em duas etapas|Acesso restrito|sem permissão|não tem acesso/i.test(body))failure ||= 'Acesso condicionado; tela não exercitada';
  const result={route,kind,status,finalUrl:p.url().replace(base,''),seconds:Math.round((Date.now()-t)/100)/10,errors,failure,heading:await p.$eval('h1',e=>e.textContent).catch(()=>null)};results.push(result);p.off('pageerror',listener);
  if(failure||['/','/mapa','/admin','/painel/cofre','/admin/crm','/admin/financeiro/alugueis','/planos'].includes(route))await p.screenshot({path:resolve(out,route.replaceAll('/','_')||'home')+'.png'}).catch(()=>{});
  await writeFile(resolve(out,'results.json'),JSON.stringify({base,results,excluded},null,2));console.log(`${failure?'FAIL':'OK'} ${route} HTTP${status} ${result.seconds}s ${failure||''}`);
 }
}finally{await b.close()}
console.log(JSON.stringify({tested:results.length,failed:results.filter(r=>r.failure).length,dynamic:excluded.length}));
process.exitCode=results.some(r=>r.failure)?1:0;
