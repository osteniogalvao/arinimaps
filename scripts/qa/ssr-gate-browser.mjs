// QA isolado: loader real do Next instalado + shell com fechamento atrasado.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const source=await readFile('public/aguardar-documento.js','utf8');
const nextBootstrap=await readFile('node_modules/next/dist/client/app-bootstrap.js','utf8');
const attributes=await readFile('node_modules/next/dist/client/set-attributes-from-props.js','utf8');
const bootstrap='(()=>{const process={env:{}};const exports={};const require=(id)=>{if(id!=="./set-attributes-from-props")throw Error(id);const exports={};\n'+attributes+'\n;return exports;};\n'+nextBootstrap+'\n;exports.appBootstrap(()=>window.qaEvents.push({event:"hydrate",state:document.readyState,t:performance.now()}));})();';
const server=createServer((req,res)=>{
 if(req.url==='/gate.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(source);return;}
 if(req.url==='/bootstrap.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(bootstrap);return;}
 res.writeHead(200,{'content-type':'text/html'});
 res.write('<!doctype html><html><head><script>window.qaEvents=[];document.addEventListener("readystatechange",()=>qaEvents.push({event:"ready",state:document.readyState,t:performance.now()}));self.__next_s=[["/gate.js",{}]];</script><script src="/bootstrap.js" async></script></head><body><p>Shell inicial</p>');
 setTimeout(()=>res.end('<p>Final SSR</p></body></html>'),800);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
try{
 const p=await browser.newPage(),runs=[];p.on('pageerror',e=>console.log('PAGEERROR',e.message));p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
 for(let attempt=1;attempt<=3;attempt++){
  await p.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle2',timeout:15000});
  const events=await p.evaluate(()=>window.qaEvents),hydrate=events.filter(e=>e.event==='hydrate');
  console.log(JSON.stringify(events));assert.equal(hydrate.length,1);assert.notEqual(hydrate[0].state,'loading');assert.ok(hydrate[0].t>=750);runs.push({attempt,events});
 }
 const out='../auditoria-funcional-2026-11-24/conta-hydration-final';await mkdir(out,{recursive:true});await writeFile(out+'/gate-classic-streaming-experiment.json',JSON.stringify(runs,null,2));console.log(JSON.stringify(runs));
}finally{await browser.close();await new Promise(r=>server.close(r));}
