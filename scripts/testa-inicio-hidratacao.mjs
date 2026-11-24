import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/aguardar-documento.js',import.meta.url),'utf8');
test('callback de load do Next só libera bootstrap após o parser terminar',()=>{
 const calls=[],listeners=[];
 const script={onload:function(event){calls.push({element:this,event});}};
 const document={readyState:'loading',currentScript:script,addEventListener:(...args)=>listeners.push(args)};
 runInNewContext(source,{document});const event={type:'load'};script.onload(event);
 assert.equal(calls.length,0);assert.equal(listeners.length,1);assert.equal(listeners[0][0],'DOMContentLoaded');assert.equal(listeners[0][2].once,true);
 document.readyState='interactive';listeners[0][1]();assert.equal(calls.length,1);assert.equal(calls[0].element,script);assert.equal(calls[0].event,event);
});
test('documento já analisado libera imediatamente sem listeners nem timers',()=>{
 for(const readyState of ['interactive','complete']){
  let count=0;const script={onload(){count++;}},document={readyState,currentScript:script,addEventListener:()=>assert.fail('Listener desnecessário')};
  runInNewContext(source,{document});script.onload({type:'load'});assert.equal(count,1);
 }
});
test('fora do bootstrap não altera documento ou handlers alheios',()=>{
 for(const currentScript of [null,{}]){const document={readyState:'loading',currentScript};runInNewContext(source,{document});assert.deepEqual(Object.keys(document),['readyState','currentScript']);if(currentScript)assert.deepEqual(currentScript,{});}
});
