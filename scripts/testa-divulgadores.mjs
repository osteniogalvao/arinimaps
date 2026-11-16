import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { compileFunction } from "node:vm";
import ts from "typescript";
import pg from "pg";

async function carregarModulo(caminho, dependencias={}) {
  const fonte=await readFile(new URL("../src/"+caminho+".ts",import.meta.url),"utf8");
  const js=ts.transpileModule(fonte,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const resultado={};
  compileFunction(js,["exports","require"])(resultado,ref=>dependencias[ref]??{});
  return resultado;
}

test("rota de contexto usa sessão, recusa piloto fechado e mantém os direitos restritos mesmo com plano externo",async()=>{
  const titular=randomUUID(), alheio=randomUUID(), chamadas=[];
  let sessao=null,erro={code:"P8601",message:"Piloto indisponível"};
  const mod=await carregarModulo("app/api/conta/contexto/route",{
    "next/server":{NextResponse:Response},"@/lib/authz":{ator:async()=>sessao},"@/lib/juridico":{assinatura:()=>"teste"},
    "@/lib/supabase/admin":{supabaseAdmin:()=>({rpc:async(nome,args)=>{chamadas.push({nome,args});return {error:erro};}})},
  });
  const pedir=()=>mod.POST(new Request("https://teste.invalid/api/conta/contexto",{method:"POST",body:JSON.stringify({entrada:"divulgador",titular:alheio,p_titular:alheio})}));
  assert.equal((await pedir()).status,401);
  sessao={userId:titular,role:"consulta"};
  assert.equal((await pedir()).status,403);
  erro=null;assert.equal((await pedir()).status,200);
  assert.deepEqual(chamadas,[0,1].map(()=>({nome:"divulgacao_entrar",args:{p_titular:titular}})));

  const perfis=await carregarModulo("lib/perfis"),planos=await carregarModulo("lib/planos",{"./perfis":perfis});
  assert.equal(planos.PERSONAS_PLANOS.length,11);assert.equal(planos.PERSONAS_PLANOS.at(-1).id,"divulgador");
  const acesso=planos.montarAcesso("consulta",{id:"plano-da-outra-persona",ativo:true,recursos:planos.RECURSOS.map(x=>x.id)},"divulgador",null);
  assert.equal(acesso.planId,null);assert.ok(acesso.recursos.has("mapa"));assert.ok(acesso.recursos.has("ficha_basica"));
  for(const nome of ["chat_ia","relatorio_territorial","interesse","anunciar","crm"])assert.equal(acesso.recursos.has(nome),false);
});

test("credenciamento, contatos da oportunidade e acesso à captura exigem o setor da sessão",async()=>{
  const titular=randomUUID(),alheio=randomUUID();
  let sessao=null;
  const authz=await carregarModulo("lib/authz");
  const falhas=await carregarModulo("lib/erros",{"next/server":{NextResponse:Response}});
  const rpc=[];
  const dependencias={
    "next/server":{NextResponse:Response},"@/lib/authz":{...authz,ator:async()=>sessao},
    "@/lib/erros":falhas,"@/lib/solicitacoes-planos-servidor":{ehUuid:id=>id===alheio},
    "@/lib/supabase/admin":{supabaseAdmin:()=>({rpc:async(nome,args)=>{rpc.push({nome,args});return {error:null};}})},
  };
  const verificacao=await carregarModulo("app/api/admin/cadastros/verificacoes/route",dependencias);
  const comprovante=await carregarModulo("app/api/divulgacao/comprovante/route",dependencias);
  const decisao=()=>verificacao.POST(new Request("https://teste.invalid",{method:"POST",body:JSON.stringify({id:alheio,revisao:1,estado:"APROVADA",motivo:"Verificada",p_ator:alheio})}));
  assert.equal((await decisao()).status,401);
  for(const setor of [null,"marketing_trafego"]){
    sessao={userId:titular,ehArini:!!setor,setores:setor?[setor]:[],role:setor?"analista_arini":"consulta"};
    assert.equal((await decisao()).status,403);
    assert.equal((await comprovante.GET(new Request("https://teste.invalid?id="+alheio))).status,403);
    assert.equal(await authz.podeOperarOportunidade(sessao,alheio),false);
  }
  assert.deepEqual(rpc,[]);
  sessao={userId:titular,ehArini:true,role:"analista_arini",setores:["operacoes"]};
  assert.equal((await decisao()).status,200);assert.equal(rpc[0].args.p_ator,titular);
  assert.equal(await authz.podeOperarOportunidade(sessao,alheio),false);
  assert.equal(await authz.podeOperarOportunidade({...sessao,setores:["comercial"]},alheio),true);
});

const url=process.env.ARINI_TESTE_CARTEIRA_DB;
const local=url&&["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname);
test("piloto de divulgadores exige aprovação, preserva contextos e controla reservas e missões", {skip:!local}, async t=>{
  const admin=new pg.Client({connectionString:url}); await admin.connect();
  const nome="arini_test_"+randomUUID().replaceAll("-","");
  await admin.query("create database "+nome);
  const dst=new URL(url);dst.pathname="/"+nome;
  const pool=new pg.Pool({connectionString:dst.href});
  const q=(s,v=[])=>pool.query(s,v);
  const [diretor,marketing,a,b,dono,predio,owner]=Array.from({length:7},()=>randomUUID());
  const cpfEmpresa="11222333000181";
  try{
    for(const role of ["anon","authenticated","service_role"])if(!(await q("select from pg_roles where rolname=$1",[role])).rowCount)await q("create role "+role);
    await q(`create table profiles(user_id uuid primary key,ativo boolean default true,role text,nicho text constraint chk_profiles_nicho check(nicho is not null),setores text[] default '{}',entrada_ativa text,plan_origem text,plan_id text,plan_valido_ate timestamptz);
      create table conta_contextos(titular uuid,nicho text,papel text,plano text,origem text,validade timestamptz,primary key(titular,nicho));
      create table audit_log(user_id uuid,acao text,entidade text,entidade_id uuid,dados_antes jsonb,dados_depois jsonb);
      create table owners(id uuid primary key,profile_id uuid);
      create table municipalities(id uuid primary key,nome text);
      create table properties(id uuid primary key,owner_id uuid,valor numeric,codigo text,status text,tipo text default 'rural',municipality_id uuid,published_at timestamptz default now(),sold_at timestamptz);
      create table campanhas(id uuid primary key,nome text,inicio date,fim date,gasto numeric,property_id uuid);
      create table opportunities(id uuid primary key,property_id uuid,etapa text,comprador_profile_id uuid,created_at timestamptz default now());
      create schema auth;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz,phone_confirmed_at timestamptz);
      create table sales(opportunity_id uuid);
      create table tarefas_do_teste(id uuid default gen_random_uuid(),chave text unique,setor text);
      create function fn_tarefa_automatica(chave text,regra text,setor text,titulo text,descricao text,autor uuid,prazo date,prioridade text,imovel uuid,op uuid)
      returns uuid language sql as $$insert into public.tarefas_do_teste(chave,setor) values($1,$3) on conflict do nothing returning id;$$;
      create table proposals(opportunity_id uuid,status text);
      create table visits(opportunity_id uuid,status text,data_hora timestamptz default now(),relatorio_em timestamptz);
      create table notificacoes(user_id uuid,nivel text,titulo text,texto text,link text,chave text);
      create unique index uq_notificacoes on notificacoes(user_id,chave) where chave is not null;`);
    await q(await readFile(new URL("../supabase/migrations/0132_piloto_divulgadores.sql",import.meta.url),"utf8"));
    await q(`insert into profiles(user_id,role,nicho,plan_origem,plan_id,setores) values
      ($1,'admin_central','consulta','padrao',null,'{}'),($2,'analista_arini','consulta','padrao',null,'{marketing}'),
      ($3,'comprador','comprador_investidor','manual','plano-anterior','{}'),($4,'consulta','consulta','padrao',null,'{}'),($5,'proprietario','proprietario','padrao',null,'{}')`,[diretor,marketing,a,b,dono]);
    await q("insert into owners values($1,$2)",[owner,dono]);await q("insert into properties values($1,$2,100000,'DEMO-1','publicado')",[predio,owner]);
    await t.test("fila idempotente, sem aprovação por conta própria e sem leitura direta",async()=>{
      assert.equal((await q("select divulgacao_inscrever($1) estado",[a])).rows[0].estado,"espera");
      await q("select divulgacao_inscrever($1)",[a]);
      assert.equal((await q("select count(*) n from divulgacao_cadastros")).rows[0].n,"1");
      await assert.rejects(q("select divulgacao_entrar($1)",[a]),{code:"P8601"});
      assert.equal((await q("select has_table_privilege('authenticated','divulgacao_cadastros','select') permitido")).rows[0].permitido,false);
      assert.equal((await q("select has_function_privilege('authenticated','divulgacao_entrar(uuid)','execute') permitido")).rows[0].permitido,false);
    });
    await t.test("lotação serializa aprovações, preserva plano anterior e avisa a fila",async()=>{
      await q("select divulgacao_configurar($1,true,1,1,500)",[diretor]);
      assert.equal((await q("select count(*) n from notificacoes where user_id=$1",[a])).rows[0].n,"1");
      await q("select divulgacao_inscrever($1,'canal.a',$2,'Iturama')",[a,cpfEmpresa]);await q("select divulgacao_inscrever($1,'canal.b',$2,'Iturama')",[b,cpfEmpresa]);
      await assert.rejects(q("select divulgacao_revisar($1,$2,'ativo',700,'')",[b,b]),{code:"42501"});
      const aprovar=id=>q("select divulgacao_revisar($1,$2,'ativo',700,'')",[marketing,id]);
      const rs=await Promise.allSettled([aprovar(a),aprovar(b)]);assert.equal(rs.filter(x=>x.status==="fulfilled").length,1);
      await q("select divulgacao_configurar($1,true,2,1,500)",[diretor]);await aprovar(a);await aprovar(b);
      await q("select divulgacao_entrar($1)",[a]);await q("select divulgacao_entrar($1)",[b]);
      const ctx=(await q("select papel,plano from conta_contextos where titular=$1 and nicho='comprador_investidor'",[a])).rows[0];
      assert.deepEqual(ctx,{papel:"comprador",plano:"plano-anterior"});assert.equal((await q("select plan_id from profiles where user_id=$1",[a])).rows[0].plan_id,null);
    });
    let reserva,segundo;
    await t.test("termo exige versão vigente e aceite individual",async()=>{
      await assert.rejects(q("select divulgacao_termo_publicar($1,'v1','Texto de teste do programa de divulgação.')",[marketing]),{code:"42501"});
      await q("select divulgacao_termo_publicar($1,'v1','Texto de teste do programa de divulgação.')",[diretor]);
      const termo=(await q("select id from divulgacao_termos where vigente")).rows[0].id;
      await assert.rejects(q("select divulgacao_reservar($1,$2)",[a,predio]),e=>e.code==="P8601"&&e.message.includes("termo"));
      for(const id of [a,b]) await q("select divulgacao_aceitar($1,$2)",[id,termo]);
    });
    await t.test("consentimento, faixa, visita em andamento e concorrência na reserva",async()=>{
      await assert.rejects(q("select divulgacao_autorizar($1,$2,true)",[a,predio]),{code:"42501"});
      await q("select divulgacao_autorizar($1,$2,true)",[dono,predio]);
      await q("select divulgacao_kit($1,$2,true,'Imóvel do piloto','Publicidade aprovada','https://example.org/kit',array['Stories','Publicação no feed'])",[marketing,predio]);
      await q("select divulgacao_faixa($1,0,90000,1,1)",[diretor]);assert.equal((await q("select * from divulgacao_catalogo($1)",[a])).rowCount,0);
      await q("select divulgacao_faixa($1,0,200000,1,1)",[diretor]);
      const op=randomUUID();await q("insert into opportunities values($1,$2,'qualificacao')",[op,predio]);await q("insert into visits values($1,'agendada')",[op]);
      await assert.rejects(q("select divulgacao_reservar($1,$2)",[a,predio]),{code:"P8601"});await q("delete from visits where opportunity_id=$1",[op]);
      const rs=await Promise.allSettled([a,b].map(id=>q("select divulgacao_reservar($1,$2) id",[id,predio])));
      assert.equal(rs.filter(x=>x.status==="fulfilled").length,1);
      reserva=(await q("select id,titular from divulgacao_reservas where encerrada is null")).rows[0];segundo=reserva.titular===a?b:a;
    });
    await q(await readFile(new URL("../supabase/migrations/0138_divulgacao_missoes_fila.sql",import.meta.url),"utf8"));
    assert.equal((await q("select count(*) n from divulgacao_metas_reserva where reserva=$1",[reserva.id])).rows[0].n,"2");
    await t.test("comprovação pertence ao titular, exige revisão e para com a revogação",async()=>{
      const link=(await q("select id from divulgacao_links where reserva=$1 and etapa=1",[reserva.id])).rows[0].id;
      const visitante=randomUUID(),op=randomUUID();
      await q("select * from divulgacao_abrir_link($1,null,null)",[link]);
      await q("select * from divulgacao_abrir_link($1,$2,$3)",[link,visitante,reserva.titular]);
      assert.equal((await q("select count(*) n from divulgacao_cliques")).rows[0].n,"0");
      for(let i=0;i<2;i++) await q("select * from divulgacao_abrir_link($1,$2,null)",[link,visitante]);
      await q("insert into opportunities(id,property_id,etapa,comprador_profile_id) values($1,$2,'qualificacao',$3)",[op,predio,segundo]);
      await q("insert into auth.users(id) values($1)",[segundo]);
      const atribuir=()=>q("select divulgacao_atribuir($1,$2,$3,$4)",[link,visitante,segundo,op]);
      await atribuir();assert.equal((await q("select count(*) n from divulgacao_atribuicoes")).rows[0].n,"0");
      await q("update auth.users set email_confirmed_at=now() where id=$1",[segundo]);await atribuir();await atribuir();
      await q("insert into visits values($1,'realizada')",[op]);await q("insert into sales values($1)",[op]);
      const resumo=(await q("select cliques,cadastros,visitas,vendas from divulgacao_resultados($1)",[reserva.titular])).rows;
      assert.deepEqual(resumo,[{cliques:"1",cadastros:"1",visitas:"1",vendas:"1"}]);
      const entrega=(id,n)=>q("select divulgacao_entregar($1,$2,$3::smallint,$4,'iVBORw0KGgo=','image/png')",[id,reserva.id,n,"https://instagram.com/p/teste"+n]);
      await assert.rejects(entrega(segundo,1),{code:"P8601"});await assert.rejects(entrega(reserva.titular,2),{code:"P8601"});
      await entrega(reserva.titular,1);const missao=(await q("select id from divulgacao_missoes where reserva=$1",[reserva.id])).rows[0].id;
      assert.equal((await q("select * from divulgacao_comprovante($1,$2)",[segundo,missao])).rowCount,0);
      assert.equal((await q("select * from divulgacao_comprovante($1,$2)",[marketing,missao])).rows[0].mime,"image/png");
      await assert.rejects(q("select divulgacao_validar($1,$2,true,'')",[reserva.titular,missao]),{code:"42501"});
      await q("select divulgacao_validar($1,$2,true,'Verificado')",[marketing,missao]);await entrega(reserva.titular,2);
      await q("select divulgacao_autorizar($1,$2,false)",[dono,predio]);assert.equal((await q("select * from divulgacao_catalogo($1)",[reserva.titular])).rowCount,0);
      assert.equal((await q("select count(*) n from divulgacao_reservas where encerrada is null")).rows[0].n,"0");
      await q("select divulgacao_autorizar($1,$2,true)",[dono,predio]);
      await q("select divulgacao_kit($1,$2,true,'Imóvel do piloto','Publicidade aprovada','https://example.org/kit',array['Stories'])",[marketing,predio]);
      await q("select divulgacao_reservar($1,$2)",[a,predio]);await q("update properties set valor=300000 where id=$1",[predio]);
      assert.equal((await q("select count(*) n from divulgacao_reservas where encerrada is null")).rows[0].n,"0");
      assert.equal((await q("select count(*) n from audit_log where acao='divulgacao_preco_fora_da_faixa'")).rows[0].n,"1");
    });
    await t.test("metas congeladas por reserva, fila FIFO com expiração e progressão justificada",async()=>{
      await q("update properties set valor=100000 where id=$1",[predio]);
      const cidade=randomUUID();await q("insert into municipalities values($1,'Iturama')",[cidade]);await q("update properties set municipality_id=$1 where id=$2",[cidade,predio]);
      const terceiro=randomUUID();
      await q("insert into profiles(user_id,role,nicho) values($1,'consulta','consulta')",[terceiro]);
      await q("select divulgacao_configurar($1,true,3,1,500)",[diretor]);
      await q("select divulgacao_inscrever($1,'contac','11222333000181','Iturama')",[terceiro]);
      await q("select divulgacao_revisar($1,$2,'ativo',700,'')",[marketing,terceiro]);
      await q("select divulgacao_entrar($1)",[terceiro]);await q("select divulgacao_aceitar($1,(select id from divulgacao_termos where vigente))",[terceiro]);
      await q("select divulgacao_faixa($1,99999,500000,2,7)",[diretor]);
      const faixa=(await q("select id from divulgacao_faixas where seguidores_min=99999")).rows[0].id;
      await q("select divulgacao_progressao($1,$2,true,2,0,0,0)",[diretor,faixa]);
      assert.notEqual((await q("select id from divulgacao_faixa_titular($1)",[terceiro])).rows[0].id,faixa);
      await q("select divulgacao_fixar_faixa($1,$2,$3,'Qualificação especial confirmada')",[marketing,b,faixa]);
      assert.equal((await q("select id from divulgacao_faixa_titular($1)",[b])).rows[0].id,faixa);
      await assert.rejects(q("select divulgacao_fixar_faixa($1,$1,$2,'Própria')",[a,faixa]),{code:'42501'});
      await q("select divulgacao_kit($1,$2,true,'Imóvel do piloto','Publicidade aprovada','https://example.org/kit',array['Stories','Feed'])",[marketing,predio]);
      const meta=JSON.stringify([{etapa:1,quantidade:2,dias:1},{etapa:2,quantidade:1,dias:2}]);
      await q("select divulgacao_criterios_imovel($1,$2,null,'Iturama',null,$3)",[marketing,predio,meta]);
      const id=(await q("select divulgacao_reservar($1,$2) id",[terceiro,predio])).rows[0].id;
      await q("select divulgacao_parametros_fila($1,2,12)",[diretor]);
      await q("select divulgacao_fila_mudar($1,$2,true)",[b,predio]);await q("select divulgacao_fila_mudar($1,$2,true)",[a,predio]);
      assert.equal((await q("select posicao from divulgacao_ofertas($1)",[a])).rows[0].posicao,"2");
      const enviar=(etapa,slug)=>q("select divulgacao_entregar($1,$2,$3::smallint,$4,'iVBORw0KGgo=','image/png')",[terceiro,id,etapa,"https://instagram.com/p/"+slug]);
      const validar=etapa=>q("select divulgacao_validar($1,(select id from divulgacao_missoes where reserva=$2 and etapa=$3),true,'Conferida')",[marketing,id,etapa]);
      await enviar(1,"um");await validar(1);
      assert.equal((await q("select estado from divulgacao_missoes where reserva=$1",[id])).rows[0].estado,'parcial');
      await assert.rejects(enviar(2,"antecipada"),{code:'P8601'});await assert.rejects(enviar(1,"um"),{code:'P8601'});
      await enviar(1,"dois");await validar(1);await enviar(2,"tres");await validar(2);
      assert.equal((await q("select id from divulgacao_faixa_titular($1)",[terceiro])).rows[0].id,faixa);
      await q("update divulgacao_reservas set vence=now()-interval '1 second' where id=$1",[id]);
      await q("select divulgacao_rotinas()");
      await assert.rejects(q("select divulgacao_reservar($1,$2)",[a,predio]),{code:'P8601'});
      assert.equal((await q("select situacao from divulgacao_ofertas($1)",[b])).rows[0].situacao,"sua_vez");
      await q("update divulgacao_fila set limite=now()-interval '1 second' where titular=$1 and saiu is null",[b]);
      await q("select divulgacao_reservar($1,$2)",[a,predio]);
      assert.equal((await q("select count(*) n from divulgacao_fila where saiu is null")).rows[0].n,"0");
      const comparavel=randomUUID(),campanha=randomUUID();
      await q("insert into properties(id,owner_id,valor,codigo,status,municipality_id) values($1,$2,100000,'DEMO-2','publicado',$3)",[comparavel,owner,cidade]);
      const rel=()=>q("select * from divulgacao_comparativo($1,current_date-3,current_date+1)",[marketing]);
      let rows=(await rel()).rows;assert.equal(rows.find(x=>x.grupo==='Divulgados').cpl,null);
      assert.equal(rows.find(x=>x.grupo==='Comparáveis').imoveis,1);
      await q("insert into campanhas values($1,'Ação do piloto',current_date-1,current_date,45,$2)",[campanha,predio]);
      await q("select divulgacao_criterios_imovel($1,$2,null,'Iturama',$3,$4)",[marketing,predio,campanha,meta]);
      rows=(await rel()).rows;assert.equal(Number(rows.find(x=>x.grupo==='Divulgados').cpl),45);
      await assert.rejects(q("select * from divulgacao_comparativo($1,current_date-3,current_date)",[terceiro]),{code:'42501'});
    });
    await t.test("rotina da Central não duplica demandas e conta encerrada sai do piloto",async()=>{
      await q("update divulgacao_cadastros set verificado_em=now()-interval '50 days' where titular=$1",[a]);
      assert.ok((await q("select divulgacao_rotinas() n")).rows[0].n>=1);
      assert.equal((await q("select divulgacao_rotinas() n")).rows[0].n,0);
      assert.equal((await q("select count(*) n from tarefas_do_teste where setor='financeiro'")).rows[0].n,"1");
      await q("select divulgacao_revisar($1,$2,'ativo',300,'Revisão dos seguidores')",[marketing,a]);
      assert.equal((await q("select estado from divulgacao_cadastros where titular=$1",[a])).rows[0].estado,'suspenso');
      await q("update profiles set ativo=false where user_id=$1",[b]);
      assert.deepEqual((await q("select estado,cnpj from divulgacao_cadastros where titular=$1",[b])).rows[0],{estado:'suspenso',cnpj:null});
    });
  }finally{await pool.end();await admin.query("drop database "+nome);await admin.end();}
});
