import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const env=Object.fromEntries((await readFile('.env.audit','utf8')).split(/\r?\n/).map(l=>l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
if(env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55421')throw Error('Somente QA');
const base=process.env.QA_DIAGNOSTIC_BASE||'http://127.0.0.1:3006';if(new URL(base).hostname!=='127.0.0.1'||!['3005','3006'].includes(new URL(base).port))throw Error('Somente appQA local');
const out=resolve('../auditoria-funcional-2026-11-24',new URL(base).port==='3005'?'conta-hydration-final':'conta-hydration-dev');await mkdir(out,{recursive:true});
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
const p=await b.newPage(),results=[];
try{
 await p.goto(base+'/entrar',{waitUntil:'domcontentloaded',timeout:180000});
 await p.evaluate(async(s,e,pw)=>{await fetch('/api/acesso',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({senha:s})});const r=await fetch('/api/auth/entrar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,senha:pw})});if(!r.ok)throw Error('Login QA HTTP '+r.status)},env.SITE_SENHA,'proprietario.teste@arinibrasil.com.br',env.SEED_USER_PASSWORD);
 for(const route of ['/conta/comunicados','/conta/monitoramento'])for(let attempt=1;attempt<=3;attempt++){
  const errors=[],listener=e=>errors.push(e.message);p.on('pageerror',listener);
  const response=await p.goto(base+route,{waitUntil:'networkidle2',timeout:180000});await new Promise(r=>setTimeout(r,1500));
  results.push({route,attempt,status:response.status(),url:p.url(),errors});p.off('pageerror',listener);
  await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({route,attempt,status:response.status(),errors}));
 }
}finally{await b.close();}
