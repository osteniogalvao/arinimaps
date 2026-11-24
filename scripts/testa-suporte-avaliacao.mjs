import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import pg from 'pg';
const ticket=randomUUID();
function rota({user={id:'titular'},error=null}={}){
 const calls=[];
 const deps={'next/server':{NextResponse:{json:(b,i)=>Response.json(b,i)}},
  '@/lib/supabase/server':{currentUser:async()=>user,supabaseServer:async()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{nota:args.p_nota,comentario:args.p_comentario,created_at:'2026-11-24'},error};}})},
  '@/lib/seguranca/limite':{limitar:async()=>({permitido:true}),respostaLimite:()=>assert.fail('sem bloqueio')}};
 const source=ts.transpileModule(readFileSync(new URL('../src/app/api/suporte/[id]/avaliacao/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={};compileFunction(source,['require','exports','Response'])(id=>{assert.ok(Object.hasOwn(deps,id),id);return deps[id]},mod,Response);
 return {calls,post:(body,id=ticket)=>mod.POST(new Request('http://localhost/api/suporte/'+id+'/avaliacao',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id})})};
}
test('avaliação exige sessão, UUID e nota inteira1–5 com comentário limitado',async()=>{
 const anon=rota({user:null});assert.equal((await anon.post({nota:5})).status,401);assert.equal(anon.calls.length,0);
 const r=rota();for(const body of [null,[],{nota:0},{nota:6},{nota:1.5},{nota:'5'},{nota:5,comentario:{}},{nota:5,comentario:'x'.repeat(1001)}])assert.equal((await r.post(body)).status,400);
 assert.equal((await r.post({nota:5},'errado')).status,400);assert.equal(r.calls.length,0);
});
test('rota usa RPC autenticada sem aceitar titular injetado e mapeia conflitos',async()=>{
 const r=rota();assert.equal((await r.post({nota:4,comentario:'  Bem atendido  ',titular_id:'outro'})).status,200);
 assert.deepEqual(r.calls,[{name:'suporte_avaliar',args:{p_ticket:ticket,p_nota:4,p_comentario:'Bem atendido'}}]);
 for(const [code,status] of [['P0002',404],['42501',403],['22023',400],['23505',409],['55000',409],['08006',503]])assert.equal((await rota({error:{code}}).post({nota:5})).status,status);
});
const url=process.env.ARINI_TESTE_CARTEIRA_DB;
test('SQL: titular/resolução, RLS, imutabilidade, retry e resumo sem duplicidade',{skip:!url},async()=>{
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
 const server=new pg.Client({connectionString:url});await server.connect();const name='qa_avaliacao_'+randomUUID().replaceAll('-','');await server.query('create database '+name);
 const u=new URL(url);u.pathname='/'+name;const db=new pg.Client({connectionString:u.href});await db.connect();
 try{
  await db.query('begin');
  await db.query(`do $$ begin if not exists(select from pg_roles where rolname='anon')then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role')then create role service_role;end if;end $$;
   create schema auth;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;
   create table profiles(user_id uuid primary key,ativo boolean default true);
   create table support_tickets(id uuid primary key,user_id uuid references profiles, status text,responsavel uuid references profiles,resolvido_em timestamptz);`);
  await db.query(readFileSync(new URL('../supabase/migrations/0167_suporte_avaliacao.sql',import.meta.url),'utf8'));
  const owner=randomUUID(),other=randomUUID(),staff=randomUUID(),open=randomUUID(),visitor=randomUUID();
  for(const id of [owner,other,staff])await db.query('insert into profiles values($1,true)',[id]);
  await db.query("insert into support_tickets values($1,$2,'resolvido',$3,now()),($4,$2,'aberto',$3,null),($5,null,'resolvido',$3,now())",[ticket,owner,staff,open,visitor]);
  async function rejects(q,args,code){await db.query('savepoint caso');await assert.rejects(()=>db.query(q,args),e=>e.code===code);await db.query('rollback to caso');}
  await db.query('set local role anon');await rejects('select suporte_avaliar($1,5)',[ticket],'42501');await db.query('reset role');
  await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);await rejects('select suporte_avaliar($1,5)',[ticket],'P0002');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
  await rejects('select suporte_avaliar($1,5)',[open],'55000');await rejects('select suporte_avaliar($1,5)',[visitor],'P0002');
  for(const n of [0,6,null])await rejects('select suporte_avaliar($1,$2)',[ticket,n],'22023');
  await rejects('select suporte_avaliar($1,5,$2)',[ticket,'x'.repeat(1001)],'22023');
  await db.query("select suporte_avaliar($1,4,' Bom atendimento ')",[ticket]);await db.query("select suporte_avaliar($1,4,'Bom atendimento')",[ticket]);
  await rejects("select suporte_avaliar($1,5,'Alterado')",[ticket],'23505');
  assert.equal((await db.query('select * from support_avaliacoes')).rows.length,1);
  await rejects('update support_avaliacoes set nota=5',[],'42501');await rejects('delete from support_avaliacoes',[],'42501');
  await rejects('select suporte_avaliacoes_resumo(now()-interval \'1 day\')',[],'42501');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);assert.equal((await db.query('select * from support_avaliacoes')).rows.length,0);
  await db.query('reset role');const summary=(await db.query("select suporte_avaliacoes_resumo(now()-interval '1 day') r")).rows[0].r;assert.equal(summary.total,1);assert.equal(summary.media,4);assert.equal(summary.nota4,1);
  await db.query("update support_tickets set status='aberto' where id=$1",[ticket]);assert.equal((await db.query('select count(*)::int n from support_avaliacoes')).rows[0].n,1);
  await db.query('delete from support_tickets where id=$1',[ticket]);assert.equal((await db.query('select count(*)::int n from support_avaliacoes')).rows[0].n,0);
 }finally{await db.query('rollback');await db.end();await server.query('drop database '+name);await server.end();}
});
