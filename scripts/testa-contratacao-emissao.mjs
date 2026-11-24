import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileFunction} from "node:vm";
import ts from "typescript";

function carregar({falhaFaturas=false,falhaEmissao=false,aceite=false,semFaturas=false,status="nova"}={}) {
  const chamadas=[];
  const db={
    rpc:async(fn)=>{chamadas.push(fn);return {error:null};},
    from:table=>{
      const resultado=table==="assinaturas_cotadas"
        ? {data:{ciclo:"mensal",primeira:6990,recorrente:9990,adicionais:0,aceite:aceite?"2026-11-24":null,cancelado:null},error:null}
        : {data:falhaFaturas?null:semFaturas?[]:[{id:"fatura-sintetica",status}],error:falhaFaturas?{code:"08006"}:null};
      const query={select:()=>query,eq:()=>query,in:()=>query,maybeSingle:()=>Promise.resolve(resultado),then:(ok,err)=>Promise.resolve(resultado).then(ok,err)};
      return query;
    },
  };
  const deps={"server-only":{},"@/lib/supabase/admin":{supabaseAdmin:()=>db},
    "@/lib/clientes-asaas":{clienteDoPlano:async()=>"cus_sintetico"},
    "@/lib/assinaturas-cotadas":{checkoutAtivo:()=>true,conciliarFatura:async id=>{chamadas.push("emitir:"+id);if(falhaEmissao)throw Error("Asaas indisponível");}},
  };
  const js=ts.transpileModule(readFileSync(new URL("../src/lib/contratacao-direta.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={};compileFunction(js,["require","exports"])(id=>{assert.ok(Object.hasOwn(deps,id));return deps[id];},mod);
  return {contratar:()=>mod.contratarDireto("titular-sintetico","pedido-sintetico"),chamadas};
}
test("contratação informa pendência quando o Asaas recusa a emissão após o aceite",async()=>{
  const x=carregar({falhaEmissao:true});const r=await x.contratar();
  assert.equal(r.direta,false);assert.equal(r.liberado,true);assert.match(r.aviso,/emissão|fatura/i);
  assert.deepEqual(x.chamadas,["assinatura_contratar_direto","assinatura_aceitar","emitir:fatura-sintetica"]);
});
test("erro ao ler faturas não é apresentado como emissão concluída",async()=>{
  const x=carregar({falhaFaturas:true});const r=await x.contratar();assert.equal(r.direta,false);assert.equal(r.liberado,true);
  assert.ok(!x.chamadas.some(c=>c.startsWith("emitir:")));
});
test("caminho normal aceita e emite; retomada não duplica o aceite",async()=>{
  for(const aceite of [false,true]){
    const x=carregar({aceite});assert.equal((await x.contratar()).direta,true);
    assert.equal(x.chamadas.filter(c=>c==="assinatura_aceitar").length,aceite?0:1);
    assert.equal(x.chamadas.filter(c=>c.startsWith("emitir:")).length,1);
  }
});
test("aceite sem primeira fatura informa pendência; fatura paga não é emitida novamente",async()=>{
  const vazio=carregar({semFaturas:true});assert.equal((await vazio.contratar()).direta,false);
  const paga=carregar({aceite:true,status:"paga"});assert.equal((await paga.contratar()).direta,true);
  assert.ok(!paga.chamadas.some(c=>c.startsWith("emitir:")));
});
