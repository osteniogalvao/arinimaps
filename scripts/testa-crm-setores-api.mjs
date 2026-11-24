// Jornadas dos handlers reais; transporte em memória, sem mensagens externas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";

function carregar(arquivo,deps={}) {
  const js=ts.transpileModule(readFileSync(new URL("../src/"+arquivo,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={}; compileFunction(js,["require","exports"])(id=>{assert.ok(Object.hasOwn(deps,id),id);return deps[id];},mod);return mod;
}
const setores=carregar("lib/setores.ts"), regras=carregar("lib/crmSetores.ts");
function ambiente() {
  const dono=randomUUID(), comercial=randomUUID(), juridico=randomUUID(), cliente=randomUUID();
  const pipe=randomUUID(), destino=randomUUID(), primeira=randomUUID(), ultima=randomUUID(), destinoEtapa=randomUUID();
  const tab={
    profiles:[{user_id:dono,nome:"Diretoria",role:"admin_central",ativo:true},{user_id:comercial,nome:"Comercial",role:"analista_arini",setores:["comercial"],ativo:true},{user_id:juridico,nome:"Jurídico",role:"analista_arini",setores:["juridico"],ativo:true},{user_id:cliente,nome:"Cliente",role:"proprietario",ativo:true}],
    crm_pipelines:[{id:pipe,setor:"comercial",nome:"Vendas",ativo:true},{id:destino,setor:"juridico",nome:"Contratos",ativo:true}],
    crm_etapas:[{id:primeira,pipeline_id:pipe,nome:"Entrada",ordem:0,sla_horas:24,final:false},{id:ultima,pipeline_id:pipe,nome:"Concluído",ordem:1,sla_horas:null,final:true},{id:destinoEtapa,pipeline_id:destino,nome:"Análise",ordem:0,sla_horas:48,final:false}],
    crm_campos:[{id:randomUUID(),pipeline_id:pipe,chave:"documento",rotulo:"Documento",tipo:"texto",exigido_desde:ultima,ordem:0}],
    crm_itens:[],crm_item_eventos:[],
  };
  let ator={userId:dono,ehArini:true,setores:setores.SETOR_IDS};
  const notificacoes=[],auditoria=[],conclusoes=[];
  const db={from(tabela){
    assert.ok(Object.hasOwn(tab,tabela),tabela);
    let dados,op="select",ordem;const filtros=[];
    const executar=(single=false)=>{
      let linhas=tab[tabela].filter(r=>filtros.every(([k,v])=>r[k]===v));
      if(op==="insert") {const novo={id:randomUUID(),status:"aberto",dados:{},prioridade:"normal",updated_at:randomUUID(),...dados};tab[tabela].push(novo);linhas=[novo];}
      if(op==="update") for(const r of linhas) Object.assign(r,dados,{updated_at:randomUUID()});
      if(ordem) linhas.sort((a,b)=>a[ordem]-b[ordem]);
      return {data:structuredClone(single?linhas[0]??null:linhas),error:null};
    };
    const q={select(){return q;},eq(k,v){filtros.push([k,v]);return q;},order(k){ordem=k;return q;},insert(v){op="insert";dados=v;return q;},update(v){op="update";dados=v;return q;},maybeSingle:async()=>executar(true),single:async()=>executar(true),then(resolve,reject){return Promise.resolve().then(()=>executar()).then(resolve,reject);}};return q;
  }};
  const api=carregar("app/api/admin/crm/route.ts",{
    "next/server":{NextResponse:Response},"@/lib/supabase/admin":{supabaseAdmin:()=>db},
    "@/lib/authz":{ator:async()=>ator,temSetor:(a,...s)=>s.some(x=>a.setores.includes(x))},
    "@/lib/audit":{logAudit:async v=>auditoria.push(v)},"@/lib/central":{concluirTarefaDoEvento:async(...v)=>conclusoes.push(v)},
    "@/lib/notificacoes":{notificar:async(...v)=>notificacoes.push(v)},"@/lib/setores":setores,"@/lib/crmSetores":regras,
  });
  return {tab,pipe,destino,primeira,ultima,destinoEtapa,dono,comercial,juridico,cliente,notificacoes,auditoria,conclusoes,
    como(userId,lista){ator={userId,ehArini:true,setores:lista};},
    post:body=>api.POST(new Request("https://local.invalid/api/admin/crm",{method:"POST",body:JSON.stringify(body)})),
  };
}

test("Dono cria item, campos obrigatórios impedem conclusão, preenchimento libera etapa final",async()=>{
  const a=ambiente();
  const criado=await a.post({acao:"criar_item",pipeline_id:a.pipe,titulo:"Venda sintética"});assert.equal(criado.status,200);
  const {id}=await criado.json();
  assert.equal((await a.post({acao:"mover_item",id,etapa_id:a.ultima})).status,400);
  assert.equal((await a.post({acao:"status_item",id,status:"concluido"})).status,400);
  assert.equal((await a.post({acao:"editar_item",id,dados:{documento:"Documento conferido"}})).status,200);
  assert.equal((await a.post({acao:"mover_item",id,etapa_id:a.ultima})).status,200);
  assert.equal(a.tab.crm_itens[0].status,"concluido");assert.equal(a.tab.crm_item_eventos.length,3);assert.equal(a.conclusoes.length,1);
});

test("Delegação dá acesso ao responsável de outro setor sem abrir o funil inteiro",async()=>{
  const a=ambiente();const r=await a.post({acao:"criar_item",pipeline_id:a.pipe,titulo:"Delegar negociação"});const {id}=await r.json();
  a.como(a.juridico,["juridico"]);
  assert.equal((await a.post({acao:"editar_item",id,descricao:"Tentativa antes da delegação"})).status,403);
  a.como(a.comercial,["comercial"]);
  assert.equal((await a.post({acao:"delegar_item",id,responsavel:a.juridico})).status,200);
  assert.equal(a.notificacoes[0][0],a.juridico);
  a.como(a.juridico,["juridico"]);
  assert.equal((await a.post({acao:"editar_item",id,descricao:"Documentos em análise"})).status,200);
  assert.equal((await a.post({acao:"criar_item",pipeline_id:a.pipe,titulo:"Não pertence ao Comercial"})).status,403);
  assert.equal((await a.post({acao:"salvar_pipeline",setor:"juridico",nome:"Novo funil"})).status,403);
});

test("Encaminhamento mantém dados e histórico e reinicia prazo no setor de destino",async()=>{
  const a=ambiente();const r=await a.post({acao:"criar_item",pipeline_id:a.pipe,titulo:"Encaminhar negociação",dados:{documento:"Documento validado"}});const {id}=await r.json();
  assert.equal((await a.post({acao:"encaminhar_item",id,pipeline_id:a.destino,responsavel:a.juridico,motivo:"Conferir documentação e contrato"})).status,200);
  const i=a.tab.crm_itens[0];assert.equal(i.pipeline_id,a.destino);assert.equal(i.etapa_id,a.destinoEtapa);assert.equal(i.dados.documento,"Documento validado");
  assert.equal(a.tab.crm_item_eventos.length,2);assert.ok(i.prazo_etapa);assert.equal(a.notificacoes.at(-1)[0],a.juridico);
  a.como(a.comercial,["comercial"]);
  assert.equal((await a.post({acao:"editar_item",id,descricao:"Sem acesso após encaminhar"})).status,403);
});

test("Criação não permite designar cliente externo ou colaborador inativo como responsável",async()=>{
  const a=ambiente();
  assert.equal((await a.post({acao:"criar_item",pipeline_id:a.pipe,titulo:"Titular externo",responsavel:a.cliente})).status,400);
  a.tab.profiles.find(p=>p.user_id===a.juridico).ativo=false;
  assert.equal((await a.post({acao:"criar_item",pipeline_id:a.pipe,titulo:"Colaborador inativo",responsavel:a.juridico})).status,400);
  assert.equal(a.tab.crm_itens.length,0);
});

test("Diretoria pode atribuir a criação a um membro ativo da equipe",async()=>{
  const a=ambiente();
  assert.equal((await a.post({acao:"criar_item",pipeline_id:a.pipe,titulo:"Novo trabalho",responsavel:a.comercial})).status,200);
  assert.equal(a.tab.crm_itens[0].responsavel,a.comercial);
  // A notificação de criação é responsabilidade do trigger real 0069, não deste transporte.
});
