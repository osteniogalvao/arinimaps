-- A fonte e a praça são públicas. Os termos que autorizam a publicação e o operador ficam internos.
create table public.cotacoes_importacoes (
 id uuid primary key, serie_id uuid not null references public.cotacoes_series(id),
 ator uuid not null references public.profiles(user_id), assinatura text not null,
 fonte text not null, referencia text not null, autorizacao text not null, arquivo text not null,
 novas integer not null, corrigidas integer not null, criadas_em timestamptz not null default now()
);
create index cotacoes_importacao_serie on public.cotacoes_importacoes(serie_id,criadas_em desc);
create table public.cotacoes_importacao_itens (
 importacao uuid not null references public.cotacoes_importacoes(id), data date not null,
 anterior numeric(16,4), valor numeric(16,4) not null, primary key(importacao,data)
);
alter table public.cotacoes_importacoes enable row level security;
alter table public.cotacoes_importacao_itens enable row level security;
revoke all on public.cotacoes_importacoes,public.cotacoes_importacao_itens from public,anon,authenticated,service_role;
grant select on public.cotacoes_importacoes,public.cotacoes_importacao_itens to service_role;

create function public.cotacoes_importar(
 p_ator uuid, p_chave uuid, p_serie jsonb, p_pontos jsonb, p_arquivo text, p_autorizacao text, p_revisao text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 codigo text:='manual-'||(p_serie->>'codigo'); s public.cotacoes_series; lote public.cotacoes_importacoes;
 assinatura text; revisao text; diferencas jsonb; novas int; corrigidas int; total int;
begin
 if not exists(select from public.profiles where user_id=p_ator and ativo and (role='admin_central' or role='analista_arini' and 'operacoes'=any(setores))) then raise insufficient_privilege; end if;
 if p_chave is null or jsonb_typeof(p_serie) is distinct from 'object' or jsonb_typeof(p_pontos) is distinct from 'array'
   or not (p_serie ?& array['codigo','produto','nome','praca','uf','unidade','fonte','url'])
   or exists(select from jsonb_each(p_serie) v where jsonb_typeof(v.value)<>'string' or length(trim(v.value#>>'{}'))=0)
   or codigo !~ '^manual-[a-z0-9]([a-z0-9-]{1,59}[a-z0-9])$'
   or p_serie->>'produto' not in ('boi-gordo','vacas','novilhas','semoventes','frango','milho','soja','graos','insumos')
   or p_serie->>'uf' not in ('AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO')
   or p_serie->>'url' !~ '^https://[^/@[:space:]?#]+([/][^?#[:space:]]*)?$'
   or length(p_serie->>'url')>600 or jsonb_array_length(p_pontos) not between 1 and 1000
   or p_arquivo is null or length(p_arquivo) not between 1 and 180 or p_autorizacao is null or length(trim(p_autorizacao)) not between 10 and 500
   then raise exception using errcode='22023',message='Metadados da importação inválidos.'; end if;
 if exists(select from jsonb_to_recordset(p_pontos) p(data date,valor numeric) where p.data is null or p.data>(now() at time zone 'America/Sao_Paulo')::date
   or p.data<date '1900-01-01' or p.valor is null or p.valor<=0 or p.valor>=1000000000000 or p.valor<>round(p.valor,4))
   or exists(select from jsonb_to_recordset(p_pontos) p(data date) group by p.data having count(*)>1)
   then raise exception using errcode='22023',message='Data repetida ou ponto inválido.'; end if;
 assinatura:=encode(sha256(convert_to(jsonb_build_array(p_serie,p_pontos,p_arquivo,p_autorizacao)::text,'utf8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(codigo,0));
 select * into lote from public.cotacoes_importacoes where id=p_chave;
 if found then
   if lote.assinatura<>assinatura or lote.ator<>p_ator then raise exception using errcode='22023',message='Chave usada em outra importação.'; end if;
   return jsonb_build_object('publicado',true,'id',lote.id,'novas',lote.novas,'corrigidas',lote.corrigidas);
 end if;
 select * into s from public.cotacoes_series where slug=codigo;
 if found and (s.produto,s.praca,trim(s.uf),s.unidade,s.fonte) is distinct from
   (p_serie->>'produto',p_serie->>'praca',p_serie->>'uf',p_serie->>'unidade',p_serie->>'fonte') then
   raise exception using errcode='22023',message='Este código já identifica outra fonte, praça, produto ou unidade.'; end if;
 select jsonb_agg(jsonb_build_object('data',p.data,'valor',p.valor,'anterior',v.valor) order by p.data),
   count(*) filter(where v.valor is null),count(*) filter(where v.valor is not null and v.valor<>p.valor),count(*)
 into diferencas,novas,corrigidas,total from jsonb_to_recordset(p_pontos) p(data date,valor numeric)
 left join public.cotacoes_valores v on v.serie_id=s.id and v.data=p.data;
 revisao:=encode(sha256(convert_to(assinatura||diferencas::text,'utf8')),'hex');
 if p_revisao is null then return jsonb_build_object('slug',codigo,'total',total,'novas',novas,'corrigidas',corrigidas,
    'iguais',total-novas-corrigidas,'revisao',revisao,'amostra',(select jsonb_agg(x.value order by x.n) from jsonb_array_elements(diferencas) with ordinality x(value,n) where n<=12)); end if;
 if revisao<>p_revisao then raise exception using errcode='40001',message='Os preços ou dados mudaram desde a prévia. Confira novamente.'; end if;
 insert into public.cotacoes_series(slug,produto,nome,praca,uf,unidade,fonte,url_fonte,atualizado_em)
 values(codigo,p_serie->>'produto',p_serie->>'nome',p_serie->>'praca',p_serie->>'uf',p_serie->>'unidade',p_serie->>'fonte',p_serie->>'url',now())
 on conflict(slug) do update set nome=excluded.nome,url_fonte=excluded.url_fonte,atualizado_em=now() returning * into s;
 insert into public.cotacoes_importacoes(id,serie_id,ator,assinatura,fonte,referencia,autorizacao,arquivo,novas,corrigidas)
 values(p_chave,s.id,p_ator,assinatura,s.fonte,s.url_fonte,p_autorizacao,p_arquivo,novas,corrigidas);
 insert into public.cotacoes_importacao_itens(importacao,data,anterior,valor)
 select p_chave,v.data,v.anterior,v.valor from jsonb_to_recordset(diferencas) v(data date,anterior numeric,valor numeric);
 insert into public.cotacoes_valores(serie_id,data,valor)
 select s.id,v.data,v.valor from jsonb_to_recordset(diferencas) v(data date,anterior numeric,valor numeric) where v.anterior is distinct from v.valor
 on conflict(serie_id,data) do update set valor=excluded.valor,coletado_em=now();
 with pontos as (select data,valor,lag(valor) over(order by data) anterior from public.cotacoes_valores where serie_id=s.id),
 calculado as (select data,round((valor/nullif(anterior,0)-1)*100,4) variacao from pontos),
 cabivel as (select data,case when abs(variacao)<1000000 then variacao end variacao from calculado)
 update public.cotacoes_valores v set variacao=c.variacao from cabivel c where v.serie_id=s.id and v.data=c.data and v.variacao is distinct from c.variacao;
 return jsonb_build_object('publicado',true,'id',p_chave,'slug',codigo,'novas',novas,'corrigidas',corrigidas);
end $$;
revoke all on function public.cotacoes_importar(uuid,uuid,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.cotacoes_importar(uuid,uuid,jsonb,jsonb,text,text,text) to service_role;
