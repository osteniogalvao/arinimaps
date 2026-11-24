import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileFunction} from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

async function tela(nichoDaProposta,nichoAtivo) {
  const id="12345678-1234-1234-1234-123456789abc";
  const contrato=()=>null;
  const dados={
    solicitacoes_planos:[{id,status:"em_analise",created_at:"2026-11-24",cotacao:{rotulo:"Consulta territorial",ciclo:"mensal",totalCentavos:2990,itens:[],personaId:"profissional_tecnico"},
      assinatura:{id,nicho:nichoDaProposta,aceite:null,cancelado:null,faturas_cotadas:[]}}],
    assinatura_contatos:[],assinatura_trocas:[],assinaturas_cotadas:[{id:"outra-assinatura",nicho:nichoAtivo}],
  };
  const db={from:table=>{const q={};for(const m of ["select","eq","in","order","range","not","is","or","limit"])q[m]=()=>q;q.then=(ok,err)=>Promise.resolve({data:dados[table],error:null}).then(ok,err);return q;}};
  const deps={"react/jsx-runtime":jsx,"next/link":{default:()=>null},"next/navigation":{redirect:()=>assert.fail("Usuário autenticado não deve ser redirecionado")},
    "@/components/shell/Moldura":{default:()=>null},"@/components/ui/Pagina":{CabecalhoPagina:()=>null,Conteudo:()=>null},
    "@/lib/authz":{ator:async()=>({userId:"titular"})},"@/lib/supabase/admin":{supabaseAdmin:()=>db},
    "@/lib/solicitacoes-planos":{SITUACOES_PEDIDO:{em_analise:"Em análise"}},"./Contratacao":{default:contrato},
    "@/lib/assinaturas-cotadas":{checkoutAtivo:()=>true},"./CancelarPedido":{default:()=>null}};
  const code=ts.transpileModule(readFileSync(new URL("../src/app/(public)/planos/solicitacoes/page.tsx",import.meta.url),"utf8"),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={};compileFunction(code,["require","exports"])(id=>{assert.ok(Object.hasOwn(deps,id),id);return deps[id];},mod);
  const arvore=await mod.default({searchParams:Promise.resolve({pedido:id})});
  function achar(node){if(!node)return null;if(Array.isArray(node)){for(const child of node){const r=achar(child);if(r)return r;}return null;}if(node.type===contrato)return node.props;return achar(node.props?.children);}
  return achar(arvore);
}
test("Consulta territorial contratada pelo comprador oferece troca no seu perfil real",async()=>{
  const props=await tela("comprador_investidor","comprador_investidor");assert.ok(props);assert.equal(props.temPlano,true);
});
test("uma assinatura em outro perfil não bloqueia contratação independente",async()=>{
  const props=await tela("comprador_investidor","engenheiro");assert.ok(props);assert.equal(props.temPlano,false);
});
