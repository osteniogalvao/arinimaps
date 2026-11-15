create table public.matriz_comunicados (
  id uuid primary key, autor uuid references public.profiles(user_id) on delete set null,
  titulo text not null check(length(titulo) between 4 and 140),
  mensagem text not null check(length(mensagem) between 8 and 4000),
  filtros jsonb not null, email boolean not null, criado_em timestamptz not null default now()
);
create table public.matriz_entregas (
  comunicado uuid references public.matriz_comunicados on delete cascade,
  titular uuid references public.profiles(user_id) on delete cascade,
  lido_em timestamptz, email text not null check(email in ('conta','pendente','reservado','enviado','conferir','cancelado')),
  reserva timestamptz, primary key(comunicado,titular)
);
create index matriz_entregas_titular on public.matriz_entregas(titular,lido_em);
create index matriz_entregas_fila on public.matriz_entregas(email,reserva) where email in ('pendente','reservado');
alter table public.matriz_comunicados enable row level security;
alter table public.matriz_entregas enable row level security;
revoke all on public.matriz_comunicados,public.matriz_entregas from public,anon,authenticated;
grant select on public.matriz_comunicados to service_role;
grant select,update on public.matriz_entregas to service_role;

create function public.matriz_comunicar(p_ator uuid,p_id uuid,p_titulo text,p_mensagem text,p_filtros jsonb,p_email boolean,p_prever boolean)
returns integer language plpgsql security definer set search_path=public as $$
declare total integer; anterior matriz_comunicados;
begin
 if not exists(select from profiles where user_id=p_ator and ativo and (role='admin_central' or (role='analista_arini' and 'marketing'=any(setores)))) then raise insufficient_privilege; end if;
 if jsonb_typeof(p_filtros)<>'object' or (p_filtros - array['perfil','plano','profissao','interesse']) <> '{}'::jsonb then raise invalid_parameter_value; end if;
 if not p_prever then
   insert into matriz_comunicados(id,autor,titulo,mensagem,filtros,email) values(p_id,p_ator,p_titulo,p_mensagem,p_filtros,p_email) on conflict do nothing;
   if not found then
     select * into strict anterior from matriz_comunicados where id=p_id;
     if row(anterior.autor,anterior.titulo,anterior.mensagem,anterior.filtros,anterior.email) is distinct from row(p_ator,p_titulo,p_mensagem,p_filtros,p_email) then raise unique_violation; end if;
     return (select count(*) from matriz_entregas where comunicado=p_id);
   end if;
 end if;
 with destinatarios as materialized (
    select p.user_id,p.avisos_email from profiles p
    left join lateral (
      select o.plan_id from organization_members om join organizations o on o.id=om.org_id
      join plans pl on pl.id=o.plan_id and pl.ativo and pl.escopo='organizacao'
      where om.user_id=p.user_id and om.status='ativo' and o.ativo and coalesce(p.plan_origem,'padrao')='padrao'
      and (o.plan_valido_ate is null or o.plan_valido_ate>=now())
      and (om.nicho_vinculo=p.nicho or (p.nicho in ('ente_publico','empresa_holding') and o.id=org_modulo_atual(p.user_id,case p.nicho when 'ente_publico' then 'balcao' else 'safras' end)))
      limit 1
    ) org on p_filtros?'plano'
    where p.ativo and p.role not in ('admin_central','analista_arini')
    and (not p_filtros?'perfil' or p.nicho=p_filtros->>'perfil')
    and (not p_filtros?'plano' or coalesce(org.plan_id,case when p.plan_valido_ate is null or p.plan_valido_ate>=now() then p.plan_id end)=p_filtros->>'plano')
    and (not p_filtros?'profissao' or lower(p.profissao_declarada)=lower(p_filtros->>'profissao'))
    and (not p_filtros?'interesse' or exists(select from filtros_interesse i where i.titular=p.user_id and i.ativo and i.tipo=p_filtros->>'interesse'))
 ), entrega as (
    insert into matriz_entregas(comunicado,titular,email)
    select p_id,user_id,case when p_email and avisos_email then 'pendente' else 'conta' end from destinatarios where not p_prever returning 1
 )
 select count(*) into total from destinatarios;
 return total;
end $$;

create function public.matriz_reservar_email() returns table(comunicado uuid,titular uuid,email text,titulo text,mensagem text)
language plpgsql security definer set search_path=public as $$
begin
 update matriz_entregas e set email='conferir' where e.email='reservado' and e.reserva < now()-interval '10 minutes';
 update matriz_entregas e set email='cancelado' where e.email='pendente' and not exists(
   select from profiles p join auth.users u on u.id=p.user_id where p.user_id=e.titular and p.ativo and p.avisos_email and u.email is not null);
 return query with proxima as (
   select e.comunicado,e.titular from matriz_entregas e join matriz_comunicados c on c.id=e.comunicado
   where e.email='pendente' order by c.criado_em,e.titular for update of e skip locked limit 1
 ), tomada as (
   update matriz_entregas e set email='reservado',reserva=now() from proxima k
   where (e.comunicado,e.titular)=(k.comunicado,k.titular) returning e.comunicado,e.titular
 )
 select t.comunicado,t.titular,u.email::text,c.titulo,c.mensagem from tomada t join auth.users u on u.id=t.titular
 join matriz_comunicados c on c.id=t.comunicado;
end $$;
revoke all on function public.matriz_comunicar(uuid,uuid,text,text,jsonb,boolean,boolean),public.matriz_reservar_email() from public,anon,authenticated;
grant execute on function public.matriz_comunicar(uuid,uuid,text,text,jsonb,boolean,boolean),public.matriz_reservar_email() to service_role;
