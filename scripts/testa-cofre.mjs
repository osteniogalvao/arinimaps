import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compileFunction } from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { limparCofre } from "../worker/jobs/limparCofre.mjs";

const raiz = new URL("../",import.meta.url);
function carregar(src, deps={}) {
  const js = ts.transpileModule(readFileSync(new URL("src/"+src+".ts",raiz),"utf8"), { compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS } }).outputText;
  const modulo={};
  compileFunction(js,["require","exports"])(id=>{
    if(id==="server-only") return {};
    assert.ok(Object.hasOwn(deps,id),"Dependência sem simulação: "+id); return deps[id];
  },modulo);
  return modulo;
}
const dono=randomUUID(),outro=randomUUID(),imovel=randomUUID(),doc=randomUUID();
const caminho=`cofre/${dono}/${imovel}/${doc}.pdf`;
const tit = {userId:dono,role:"proprietario",nicho:"proprietario"};
const cofre=carregar("lib/cofre"), arquivos=carregar("lib/seguranca/arquivos");
function adminCom(fetch) {
  return createClient("https://local.invalid","teste",{global:{fetch},auth:{persistSession:false}});
}
test("download privado exige titular, perfil e registro exato antes da assinatura", async()=>{
  let lidos=0;
  const db=adminCom(async endereco=>{
    lidos++;
    const p=new URL(endereco).searchParams;
    assert.equal(p.get("titular_id"),"eq."+dono);
    if (p.get("storage_path")!=="eq."+caminho) return Response.json([]);
    return Response.json([{id:doc,nome_arquivo:"Escritura.pdf"}]);
  });
  const gateway=carregar("lib/seguranca/documentos",{"@/lib/supabase/admin":{supabaseAdmin:()=>db},
    "@/lib/authz":{},"./limite":{},"@/lib/cofre":cofre});
  assert.equal(await gateway.resolverArquivo({...tit,userId:outro},caminho),null);
  assert.equal(await gateway.resolverArquivo({...tit,role:"admin_central"},caminho),null);
  assert.equal(lidos,0);
  assert.equal((await gateway.resolverArquivo(tit,caminho)).permitido,true);
  assert.equal(await gateway.resolverArquivo(tit,caminho+".pdf"),null);
});
test("upload recusa outro titular e conteúdo disfarçado antes de gravar; PDF real vai apenas ao docs",async()=>{
  let ator=tit,gravados=0,registro;
  const db=adminCom(async(endereco,init)=>{
    const {pathname,searchParams:p}=new URL(endereco);
    if(pathname.endsWith("/cofre_propriedades")){
      assert.equal(p.get("id"),"eq."+imovel);
      return Response.json(p.get("titular_id")==="eq."+dono?[{id:imovel}]:[]);
    }
    if(pathname.includes("/storage/v1/object/")){
      assert.match(pathname,new RegExp("/docs/cofre/"+dono+"/"+imovel+"/[0-9a-f-]+[.]pdf$"));
      assert.equal(new Headers(init.headers).get("content-type"),"application/pdf");
      gravados++;return Response.json({Key:"docs/teste"});
    }
    assert.match(pathname,/cofre_documentos$/);registro=JSON.parse(init.body);
    return new Response(null,{status:201});
  });
  const deps={"@/lib/cofre":cofre,"@/lib/authz":{ator:async()=>ator},"@/lib/supabase/admin":{supabaseAdmin:()=>db},
    "@/lib/seguranca/arquivos":arquivos,"@/lib/seguranca/limite":{limitar:async()=>({permitido:true})},
    "@/lib/seguranca/link-arquivo":carregar("lib/seguranca/link-arquivo"),
    "@/lib/solicitacoes-planos-servidor":carregar("lib/solicitacoes-planos-servidor",{"@/lib/supabase/admin":{},"@/lib/solicitacoes-planos":{}}),
    "@/lib/erros":{falha:(s,c,error)=>Response.json({c,error},{status:s})}};
  const {POST}=carregar("app/api/painel/cofre/documentos/route",deps);
  const req=b=>new Request("https://local.invalid/?propriedade="+imovel,{method:"POST",headers:{"X-Nome-Arquivo":"matricula.pdf"},body:b});
  ator={...tit,userId:outro};assert.equal((await POST(req("%PDF-1.7"))).status,404);
  ator=tit;assert.equal((await POST(req("<script>alert(1)</script>"))).status,400);assert.equal(gravados,0);
  const valido=await POST(req("%PDF-1.7\nfixture"));assert.equal(valido.status,200);
  assert.equal(gravados,1);assert.equal(registro.titular_id,dono);assert.equal(registro.propriedade_id,imovel);
});

const local=process.env.TEST_COFRE_PG_URL;
// Exige cluster local novo (initdb). As tabelas de fixture são deliberadamente
// criadas sem IF NOT EXISTS: recusa qualquer banco que já tenha essas tabelas.
test("Postgres: limite concorrente, planos vigentes, isolamento, concessão explícita e descarte de órfãos", {skip:!local}, async()=>{
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(local).hostname));
  const db=new pg.Pool({connectionString:local,max:8});
  try {
    const pre=await db.query("select to_regclass('public.profiles') is null as vazio");
    assert.equal(pre.rows[0].vazio,true,"Use um banco descartável vazio.");
    await db.query(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create table auth.users(id uuid primary key,email text);
      create table public.plans(id text primary key, cotas jsonb, ativo boolean default true,escopo text default 'pessoal');
      create table public.profiles(user_id uuid primary key references auth.users(id) on delete cascade,ativo boolean default true,
        role text,nicho text,setores text[] default '{}',plan_id text, plan_valido_ate timestamptz, plan_origem text default 'padrao');
      create table public.organizations(id uuid primary key,plan_id text,ativo boolean,plan_valido_ate timestamptz);
      create table public.organization_members(user_id uuid,org_id uuid,status text);
      create table public.audit_log(user_id uuid, acao text, entidade text, entidade_id uuid, dados_antes jsonb, dados_depois jsonb);
      create table storage.objects(name text,bucket_id text,created_at timestamptz);
      create table public.cartography_layers(tipo text, source_path text);
    `);
    for(const nome of ["0075_solicitacoes_planos","0079_cofre_propriedades"]) await db.query(readFileSync(new URL("supabase/migrations/"+nome+".sql",raiz),"utf8"));
    const fin=randomUUID(), marketing=randomUUID(), org=randomUUID(), titulo=randomUUID();
    for(const [id,role,nicho,setores] of [[dono,"proprietario",null,[]],[outro,"consulta","produtor_rural",[]],[fin,"analista_arini",null,["financeiro"]],[marketing,"analista_arini",null,["marketing"]]]) {
      await db.query("insert into auth.users values($1,'teste@local.invalid')",[id]);
      await db.query("insert into public.profiles(user_id,role,nicho,setores) values ($1,$2,$3,$4)",[id,role,nicho,setores]);
    }
    const salvar=(tit,id,nova=true)=>db.query("select public.cofre_salvar_propriedade($1,$2,'Fazenda','Goiás',12.3,null,null,$3)",[tit,id,nova]);
    const ids=[imovel,titulo,randomUUID(),randomUUID(),randomUUID(),randomUUID()];
    await salvar(dono,imovel);
    const tentativas=await Promise.allSettled(ids.slice(1).map(id=>salvar(dono,id)));
    assert.equal(tentativas.filter(t=>t.status==="fulfilled").length,2);
    assert.ok(tentativas.filter(t=>t.status==="rejected").every(t=>t.reason.code==="54000"));
    await salvar(dono,imovel); // mesmo id não consome vaga
    await assert.rejects(()=>salvar(outro,imovel,false),{code:"P0002"});
    await assert.rejects(()=>salvar(marketing,randomUUID()),{code:"42501"});
    await db.query("insert into public.plans(id,cotas) values('produtor_teste','{\"propriedades_cofre\":1}')");
    await db.query("update public.profiles set plan_id='produtor_teste' where user_id=$1",[outro]);
    const limite=async id=>Number((await db.query("select public.cofre_limite($1) limite",[id])).rows[0].limite);
    assert.equal(await limite(outro),1);
    await db.query("update public.profiles set plan_valido_ate=now()-interval '1 day' where user_id=$1",[outro]);
    assert.equal(await limite(outro),3);
    await db.query("insert into public.plans values('org','{\"propriedades_cofre\":5}',true,'organizacao')");
    await db.query("insert into public.organizations values($1,'org',true,null)",[org]);
    await db.query("insert into public.organization_members values ($1,$2,'ativo')",[outro,org]);assert.equal(await limite(outro),5);
    const solicita=(await db.query("select * from public.fn_solicitar_plano($1,$2,'{}',$3)",[dono,randomUUID(),{itens:[{id:"propriedade_adicional",quantidade:2}]}])).rows[0].id;
    const conceder=(ator)=>db.query("select public.cofre_conceder_vagas($1,$2)",[ator,solicita]);
    await assert.rejects(()=>conceder(fin),{code:"55000"});
    await db.query("update public.solicitacoes_planos set status='concluido' where id=$1",[solicita]);
    assert.equal(await limite(dono),3);
    await assert.rejects(()=>conceder(marketing),{code:"42501"});
    await Promise.all([conceder(fin),conceder(fin)]);assert.equal(await limite(dono),5);
    const c=await db.connect();
    try {
      await c.query("set role authenticated");
      await assert.rejects(()=>c.query("select * from public.cofre_documentos"),{code:"42501"});
      await assert.rejects(()=>c.query("select public.cofre_limite($1)",[dono]),{code:"42501"});
    } finally {await c.query("reset role");c.release();}
    const inserirDoc=id=>db.query("insert into public.cofre_documentos values ($1,$2,$3,'arquivo',$4,500)",[doc,id,imovel,`cofre/${id}/${imovel}/${doc}.pdf`]);
    await assert.rejects(()=>inserirDoc(outro),{code:"23503"});await inserirDoc(dono);
    const orfao=caminho.replace(doc,randomUUID()), recente=caminho.replace(doc,randomUUID());
    await db.query("insert into storage.objects values($1,'docs',now()-interval '1 day'),($2,'docs',now()-interval '1 day'),($3,'docs',now()),('imoveis/outro.pdf','docs',now()-interval '2 days'),($1,'media',now()-interval '2 days')",[caminho,orfao,recente]);
    const apagados=[];const storage={remove:async lote=>{apagados.push(...lote);return {error:null};}};
    await limparCofre({},db,null,storage);assert.deepEqual(apagados,[orfao]);
    await db.query("delete from auth.users where id=$1",[dono]);
    assert.equal((await db.query("select count(*)::int n from public.cofre_documentos")).rows[0].n,0);
    apagados.length=0;await limparCofre({},db,null,storage);assert.deepEqual(apagados.toSorted(),[orfao,caminho].toSorted());
  } finally {await db.end();}
});
