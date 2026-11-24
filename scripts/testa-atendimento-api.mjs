// Fluxos reais do Atendimento, com transporte local e provedor de mensagens simulado.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
function carregar(arquivo,deps={}) {
  const js=ts.transpileModule(readFileSync(new URL("../src/"+arquivo,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={};compileFunction(js,["require","exports"])(id=>{assert.ok(Object.hasOwn(deps,id),id);return deps[id];},m);return m;
}
const setores=carregar("lib/setores.ts"), regras=carregar("lib/crmSetores.ts"),rotulos=carregar("lib/atendimento-rotulos.ts",{"@/lib/setores":setores});
function ambiente() {
  const dono=randomUUID(),vendas=randomUUID(),juridico=randomUUID(),recepcao=randomUUID(),id=randomUUID(),funil=randomUUID();
  const c={id,codigo:"AT-QA",telefone:"5511000000000",nome:"Contato sintético",setor:null,responsavel:null,status:"aberta",crm_item_id:null,opportunity_id:null,nao_lidas:1,etiquetas:[],resolvida_em:null};
  const tab={atendimento_conversas:[c],profiles:[{user_id:dono,role:"admin_central",ativo:true},{user_id:vendas,role:"analista_arini",setores:["comercial"],ativo:true},{user_id:juridico,role:"analista_arini",setores:["juridico"],ativo:true},{user_id:recepcao,role:"analista_arini",setores:["suporte"],ativo:true,atendimento_recepcao:true}],atendimento_eventos:[],crm_itens:[],crm_item_eventos:[],whatsapp_mensagens:[],opportunity_events:[],
    crm_pipelines:[{id:funil,nome:"Vendas",setor:"comercial",ativo:true}],crm_etapas:[{id:randomUUID(),pipeline_id:funil,ordem:0,nome:"Entrada",sla_horas:24,final:false}]};
  let ator={userId:dono,ehArini:true,setores:setores.SETOR_IDS};const envios=[],avisos=[];
  const db={from(tabela){assert.ok(Object.hasOwn(tab,tabela),tabela);let op="select",dados;const filtros=[];
    const exec=(single=false)=>{let linhas=tab[tabela].filter(r=>filtros.every(([k,v])=>r[k]===v));
      if(op==="insert"){const r={id:randomUUID(),codigo:"CRM-QA",...dados};tab[tabela].push(r);linhas=[r];}
      if(op==="update") for(const r of linhas)Object.assign(r,dados);
      return {data:structuredClone(single?linhas[0]??null:linhas),error:null};};
    const q={select(){return q;},eq(k,v){filtros.push([k,v]);return q;},order(){return q;},insert(v){op="insert";dados=v;return q;},update(v){op="update";dados=v;return q;},maybeSingle:async()=>exec(true),single:async()=>exec(true),then(ok,no){return Promise.resolve().then(()=>exec()).then(ok,no);}};return q;}};
  // A implementação e atomicidade desta RPC são exercitadas no teste SQL separado.
  db.rpc=async(fn,args)=>{
    assert.equal(fn,"fn_atendimento_abrir_crm");assert.equal(args.p_conversa,id);assert.equal(args.p_autor,ator.userId);
    if(c.crm_item_id)return {data:null,error:{code:"23505",message:"Já vinculado"}};
    const item={id:randomUUID(),codigo:"CRM-QA"};tab.crm_itens.push(item);c.crm_item_id=item.id;
    return {data:item,error:null};
  };
  const auth={ator:async()=>ator,temSetor:(a,...s)=>s.some(x=>a.setores.includes(x))};
  const social={canalDoContato:t=>t.startsWith("ig:")?"instagram":"whatsapp",contatoSocial:t=>t.startsWith("ig:"),enviarPeloCanal:async(...v)=>{envios.push(v);return "wa_sintetico";},mensagensSociaisConfiguradas:()=>true};
  const meta={MetaErro:class extends Error {},telefoneWhatsapp:t=>t,whatsappConfigurado:()=>true};
  const deps={"server-only":{},"@/lib/supabase/admin":{supabaseAdmin:()=>db},"@/lib/authz":auth,"@/lib/meta":meta,"@/lib/meta-mensagens":social,"@/lib/notificacoes":{notificar:async(...v)=>avisos.push(v)},"@/lib/atendimento-rotulos":rotulos};
  const atendimento=carregar("lib/atendimento.ts",deps);
  const api=carregar("app/api/admin/atendimento/[id]/route.ts",{...deps,"next/server":{NextResponse:Response},"@/lib/audit":{logAudit:async()=>{}},"@/lib/seguranca/limite":{limitar:async()=>({permitido:true}),respostaLimite:()=>Response.json({}, {status:429})},"@/lib/crmSetores":regras,"@/lib/setores":setores,"@/lib/atendimento":atendimento});
  return {c,tab,dono,vendas,juridico,recepcao,funil,envios,avisos,como(userId,lista){ator={userId,ehArini:true,setores:lista};},post:b=>api.POST(new Request("https://local.invalid/api/admin/atendimento/"+id,{method:"POST",body:JSON.stringify(b)}),{params:Promise.resolve({id})})};
}
test("Recepção tria para Comercial; Jurídico não lê nem altera conversa de outra fila",async()=>{
  const a=ambiente();a.como(a.juridico,["juridico"]);
  assert.equal((await a.post({acao:"nota",texto:"Sem autorização"})).status,403);
  a.como(a.recepcao,["suporte"]);
  assert.equal((await a.post({acao:"transferir",setor:"comercial",responsavel:a.vendas})).status,200);
  assert.equal(a.c.setor,"comercial");assert.equal(a.avisos.at(-1)[0],a.vendas);
  a.como(a.juridico,["juridico"]);assert.equal((await a.post({acao:"assumir"})).status,403);
});
test("Transferência exige motivo e responsável ativo do setor de destino",async()=>{
  const a=ambiente();a.c.setor="comercial";a.como(a.vendas,["comercial"]);
  assert.equal((await a.post({acao:"transferir",setor:"juridico",responsavel:a.juridico})).status,400);
  assert.equal((await a.post({acao:"transferir",setor:"juridico",responsavel:a.vendas,motivo:"Analisar contrato"})).status,400);
  assert.equal((await a.post({acao:"transferir",setor:"juridico",responsavel:a.juridico,motivo:"Analisar contrato"})).status,200);
  assert.equal(a.c.setor,"juridico");assert.equal(a.tab.atendimento_eventos.at(-1).acao,"transferencia");
});
test("Atendente assume, responde, resolve e reabre com histórico e mensagem registrada",async()=>{
  const a=ambiente();a.c.setor="comercial";a.como(a.vendas,["comercial"]);
  assert.equal((await a.post({acao:"assumir"})).status,200);
  assert.equal((await a.post({acao:"responder",texto:"Mensagem de homologação"})).status,200);
  assert.equal(a.envios.length,1);assert.equal(a.tab.whatsapp_mensagens.length,1);assert.equal(a.c.nao_lidas,0);
  assert.equal((await a.post({acao:"resolver"})).status,200);assert.ok(a.c.resolvida_em);
  assert.equal((await a.post({acao:"reabrir"})).status,200);assert.equal(a.c.resolvida_em,null);
});
test("Transferir conversa resolvida reabre sem manter data de resolução antiga",async()=>{
  const a=ambiente();a.c.setor="comercial";
  assert.equal((await a.post({acao:"resolver"})).status,200);
  assert.equal((await a.post({acao:"transferir",setor:"juridico",motivo:"Nova dúvida contratual"})).status,200);
  assert.equal(a.c.status,"aberta");assert.equal(a.c.resolvida_em,null);
});
test("Abrir CRM duas vezes na mesma conversa não duplica item nem perde vínculo",async()=>{
  const a=ambiente();a.c.setor="comercial";
  assert.equal((await a.post({acao:"abrir_crm",pipeline_id:a.funil})).status,200);
  const original=a.c.crm_item_id;
  assert.equal((await a.post({acao:"abrir_crm",pipeline_id:a.funil})).status,409);
  assert.equal(a.tab.crm_itens.length,1);assert.equal(a.c.crm_item_id,original);
});
