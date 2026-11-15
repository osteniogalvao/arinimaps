// node --test scripts/testa-nfse-assinaturas.mjs; PostgreSQL opcional somente em loopback.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";
import pg from "pg";

function carregar(nome, modulos = {}, env = {}) {
  const fonte = readFileSync(new URL("../src/lib/"+nome+".ts", import.meta.url), "utf8");
  const js = ts.transpileModule(fonte, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  compileFunction(js, ["require","exports","process"])(id => {
    if (id === "server-only") return {};
    if (!Object.hasOwn(modulos,id)) throw Error("Dependência não simulada: "+id);
    return modulos[id];
  }, exports, {env});
  return exports;
}
const regras = carregar("nfse-regras");
const config = {emitenteCnpj:regras.CNPJ_IMOVEIS, desde:"2026-11-15", momento:"cobranca", municipalServiceCode:"TESTE",
  municipalServiceName:"Serviço simulado", deductions:0, taxes:{retainIss:false,iss:0,cofins:0,csll:0,inss:0,ir:0,pis:0}};
const fatura = randomUUID();
test("exige emitente, data real, serviço e alíquotas explícitas", () => {
  for (const alteracao of [{emitenteCnpj:null},{desde:"2026-02-31"},{taxes:{}},{municipalServiceId:"outro"},{momento:null}]) {
    assert.throws(() => regras.parametrosFiscais(JSON.stringify({...config,...alteracao})));
  }
  assert.equal(regras.faturaDaReferencia(regras.referenciaFiscal(fatura)),fatura);
  assert.equal(regras.faturaDaReferencia("ari_"+fatura),null);
});

async function simular({emitente, conta=emitente, enviada=false, incerta=false, divergencia=false, habilitar=true}) {
  const chamadas=[], confirmacoes=[], erros=[];
  const item={fatura, estado:incerta?"consultar":"pendente", gateway_id:null, pagamento:"pay_x", cliente:"cus_imoveis",
    plano:"plano_teste", componente:"plano", valor:1234, inicio:"2026-11-15"};
  const customer=emitente===regras.CNPJ_IMOVEIS?"cus_imoveis":"cus_tecnologia";
  const nota={id:"inv_x", customer:divergencia?"outro":customer, payment:emitente===regras.CNPJ_IMOVEIS?"pay_x":null,
    value:12.34, externalReference:regras.referenciaFiscal(fatura), status:"AUTHORIZED", number:23};
  let servida=false;
  const db=createClient("https://teste.invalid", "teste-local", {auth:{persistSession:false},global:{fetch:async(url,init)=>{
    const u=new URL(url); const corpo=init.body?JSON.parse(init.body):null;
    const json=d=>Response.json(d);
    if (u.pathname.endsWith("/rpc/nfse_assinatura_proxima")) {
      if(servida)return json([]);servida=true;return json([item]);
    }
    if (u.pathname.endsWith("/rpc/nfse_assinatura_reservar_post")) { assert.equal(corpo.p_emitente,emitente);return json(true); }
    if (u.pathname.endsWith("/rpc/nfse_assinatura_confirmar")) {confirmacoes.push(corpo);return json(true);}
    if (u.pathname.endsWith("/nfse_tomadores")) return json({cliente_fiscal:customer});
    if (u.pathname.endsWith("/nfse_assinaturas") && init.method==="PATCH") {erros.push(corpo);return new Response(null,{status:204});}
    throw Error("Consulta inesperada "+u.pathname);
  }}});
  class AsaasErro extends Error {}
  const gateway={AsaasErro, tomadorDaCobranca:async()=>({id:"cus_imoveis",name:"Sintético",cpfCnpj:"11111111111"}),
    chamarAsaasFiscal:async(path, init={}, recebedora=false)=>{
      chamadas.push({path,init,recebedora});
      assert.equal(recebedora,emitente===regras.CNPJ_IMOVEIS);
      if(path==="/myAccount/commercialInfo") return {cpfCnpj:conta};
      if(path==="/fiscalInfo/") return {};
      if(path.startsWith("/invoices?")) return {data:enviada?[nota]:[]};
      if(path==="/customers/cus_tecnologia") return {id:"cus_tecnologia",cpfCnpj:"11111111111",externalReference:"arini_cobranca_cus_imoveis"};
      if(path==="/invoices" && init.method==="POST") return nota;
      throw Error("Chamada fiscal inesperada");
    }};
  const worker=carregar("nfse-assinaturas",{"@/lib/nfse-regras":regras,"@/lib/asaas":gateway,"@/lib/supabase/admin":{supabaseAdmin:()=>db}},
    habilitar?{ASAAS_NFSE_ASSINATURAS_CONFIG:JSON.stringify({...config,emitenteCnpj:emitente})}:{});
  const resultado=await worker.rodarNotasAssinaturas();
  return {chamadas,erros,confirmacoes,resultado,posts:chamadas.filter(c=>c.path==="/invoices" && c.init.method==="POST")};
}
test("emissão na conta recebedora vincula cobrança; emissão na Tecnologia vincula tomador dessa conta", async()=>{
  for(const emitente of [regras.CNPJ_IMOVEIS,regras.CNPJ_TECNOLOGIA]){
    const s=await simular({emitente});
    assert.equal(s.posts.length,1);
    assert.equal(s.posts[0].init.body.payment,emitente===regras.CNPJ_IMOVEIS?"pay_x":undefined);
    assert.equal(s.posts[0].init.body.customer,emitente===regras.CNPJ_TECNOLOGIA?"cus_tecnologia":undefined);
    assert.equal(s.confirmacoes[0].p_emitente,emitente);assert.equal(s.confirmacoes[0].p_estado,"emitida");
  }
});
test("sem configuração, CNPJ divergente, tomador divergente ou POST incerto",async()=>{
  const emitente=regras.CNPJ_IMOVEIS;
  assert.equal((await simular({emitente,habilitar:false})).chamadas.length,0);
  const incorreta=await simular({emitente,conta:regras.CNPJ_TECNOLOGIA});
  assert.equal(incorreta.posts.length,0);assert.equal(incorreta.resultado.erros,1);
  const divergente=await simular({emitente,divergencia:true,enviada:true});
  assert.equal(divergente.confirmacoes.length,0);assert.equal(divergente.posts.length,0);
  const perdida=await simular({emitente,incerta:true});assert.equal(perdida.posts.length,0);
  const recuperada=await simular({emitente,incerta:true,enviada:true});assert.equal(recuperada.posts.length,0);
  assert.equal(recuperada.confirmacoes[0].p_estado,"emitida");
});

test("webhook sem referência associa somente o ID já conhecido do mesmo emitente, com tomador e valor conferidos",async()=>{
  let nota, leituras=0;
  const db=createClient("https://teste.invalid","teste-local",{auth:{persistSession:false},global:{fetch:async(url,init)=>{
    const u=new URL(url);
    if(u.pathname.endsWith("/rpc/nfse_assinatura_confirmar")) {nota=JSON.parse(init.body);return Response.json(true);}
    assert.equal(u.searchParams.get("emitente"),"eq."+regras.CNPJ_IMOVEIS);
    const encontrado=u.searchParams.get("gateway_id")==="eq.inv_certa";
    return Response.json(encontrado?{fatura,emitente:regras.CNPJ_IMOVEIS,gateway_id:"inv_certa",faturas_cotadas:{
      valor:2400,pagamento:"pay_x",assinaturas_cotadas:{cliente:"cus_x"}}}:null);
  }}});
  const worker=carregar("nfse-assinaturas",{"@/lib/nfse-regras":regras,"@/lib/supabase/admin":{supabaseAdmin:()=>db},
    "@/lib/asaas":{chamarAsaasFiscal:async(path,init,recebedora)=>{
      leituras++;assert.equal(recebedora,true);
      if(path==="/myAccount/commercialInfo")return {cpfCnpj:regras.CNPJ_IMOVEIS};
      assert.equal(path,"/invoices/inv_certa");return {id:"inv_certa",status:"CANCELED",customer:"cus_x",payment:"pay_x",value:24};
    }}});
  assert.equal(await worker.eventoFiscalAssinatura(null,"inv_alheia",regras.CNPJ_IMOVEIS),false);
  assert.equal(leituras,0);
  assert.equal(await worker.eventoFiscalAssinatura(null,"inv_certa",regras.CNPJ_IMOVEIS),true);
  assert.equal(nota.p_estado,"cancelada");assert.equal(nota.p_fatura,fatura);
});

const url=process.env.ARINI_TESTE_CARTEIRA_DB;
test("fila PostgreSQL, reservas simultâneas, estornos, emitentes e reentregas",{
  skip:!url || !["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname)
},async()=>{
  const servidor=new pg.Client({connectionString:url}); await servidor.connect();
  const banco="arini_test_nfse_"+randomUUID().replaceAll("-","");
  await servidor.query("create database "+banco);
  const endereco=new URL(url);endereco.pathname="/"+banco;
  const pool=new pg.Pool({connectionString:endereco.href});
  const sql=(q,v=[])=>pool.query(q,v);
  try {
    for(const role of ["anon","authenticated","service_role"]){
      if(!(await sql("select from pg_roles where rolname=$1",[role])).rowCount)await sql("create role "+role);
    }
    await sql("create table assinaturas_cotadas(id uuid primary key,cliente text,plano text);create table faturas_cotadas(id uuid primary key,assinatura uuid,componente text,valor int,inicio date,pagamento text,status text,operacao text)");
    await sql("insert into assinaturas_cotadas values($1,'cus','plano')",[fatura]);
    await sql("insert into faturas_cotadas values($1,$1,'plano',1234,'2026-11-15','pay','aberta',null)",[fatura]);
    await sql(readFileSync(new URL("../supabase/migrations/0125_nfse_assinaturas.sql",import.meta.url),"utf8"));
    const emitente=regras.CNPJ_IMOVEIS;
    const proxima=(dia,pago,cnpj=emitente)=>sql("select * from nfse_assinatura_proxima($1,$2,$3)",[dia,pago,cnpj]);
    const reservar=()=>sql("select nfse_assinatura_reservar_post($1,'2026-11-15',false,$2) as ok",[fatura,emitente]);
    const confirmar=(id,est,cnpj=emitente)=>sql("select nfse_assinatura_confirmar($1,$2,$3,$4,null,null,null,null) as ok",[fatura,cnpj,id,est]);
    assert.equal((await proxima("2026-11-16",false)).rowCount,0);
    assert.equal((await proxima("2026-11-15",true)).rowCount,0);
    assert.equal((await proxima("2026-11-15",false)).rowCount,1);
    assert.equal((await proxima("2026-11-15",false)).rowCount,0);
    await sql("update faturas_cotadas set status='estornada'");
    assert.equal((await reservar()).rows[0].ok,false);
    await sql("update faturas_cotadas set status='paga'");
    assert.equal((await Promise.all([reservar(),reservar()])).filter(r=>r.rows[0].ok).length,1);
    await sql("update faturas_cotadas set status='parcial',pagamento='pay'");
    await sql("update nfse_assinaturas set proxima=now()");
    assert.equal((await proxima("2026-11-15",false,regras.CNPJ_TECNOLOGIA)).rowCount,0);
    assert.equal((await proxima("2026-11-15",false)).rows[0].estado,"consultar");
    assert.equal((await confirmar("inv","emitida",regras.CNPJ_TECNOLOGIA)).rows[0].ok,false);
    assert.equal((await confirmar("inv","emitida")).rows[0].ok,true);
    assert.equal((await confirmar("inv","agendada")).rows[0].ok,false);
    assert.equal((await confirmar("inv","emitida")).rows[0].ok,true);
    assert.equal((await confirmar("inv","cancelada")).rows[0].ok,true);
    assert.equal((await confirmar("inv","emitida")).rows[0].ok,false);
    assert.equal((await sql("select * from nfse_assinaturas")).rowCount,1);
    assert.equal((await sql("select has_function_privilege('authenticated','nfse_assinatura_reservar_post(uuid,date,boolean,text)','execute') as ok")).rows[0].ok,false);
  } finally {
    await pool.end();
    try { await servidor.query("drop database "+banco); }
    finally { await servidor.end(); }
  }
});
