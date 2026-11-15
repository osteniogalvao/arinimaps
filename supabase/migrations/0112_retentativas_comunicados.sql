-- O provedor deduplica a mesma entrega por 24h. Após essa janela, a equipe confere o resultado.
alter table public.matriz_entregas
  add column tentativas smallint not null default 0,
  add column primeira_tentativa timestamptz,
  add column tentar_apos timestamptz;
update public.matriz_entregas set primeira_tentativa=reserva,tentativas=1 where reserva is not null;

drop function public.matriz_reservar_email();
create function public.matriz_reservar_email()
returns table(comunicado uuid,titular uuid,email text,titulo text,mensagem text,tentativa smallint)
language plpgsql security definer set search_path='' as $$
begin
  update public.matriz_entregas e
  set email=case when tentativas>=4 or primeira_tentativa<=now()-interval '23 hours' then 'conferir' else 'pendente' end
  where e.email='reservado' and reserva<now()-interval '10 minutes';

  update public.matriz_entregas e set email='conferir'
  where e.email='pendente' and primeira_tentativa<=now()-interval '23 hours';

  update public.matriz_entregas e set email='cancelado' where e.email='pendente' and not exists(
    select from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=e.titular and p.ativo and p.avisos_email and u.email is not null);

  return query with proxima as (
    select e.comunicado,e.titular from public.matriz_entregas e join public.matriz_comunicados c on c.id=e.comunicado
    where e.email='pendente' and (tentar_apos is null or tentar_apos<=now())
    order by c.criado_em,e.titular for update of e skip locked limit 1
  ), tomada as (
    update public.matriz_entregas e set email='reservado', reserva=now(), tentativas=tentativas+1,
      primeira_tentativa=coalesce(primeira_tentativa,now()), tentar_apos=null
    from proxima k where (e.comunicado,e.titular)=(k.comunicado,k.titular)
    returning e.comunicado,e.titular,e.tentativas
  )
  select t.comunicado,t.titular,u.email::text,c.titulo,c.mensagem,t.tentativas from tomada t
  join auth.users u on u.id=t.titular join public.matriz_comunicados c on c.id=t.comunicado;
end $$;

create view public.matriz_resumo_entregas with (security_invoker=true) as
  select c.id,c.titulo,c.criado_em,c.email,count(e.titular)::integer as total,
  count(*) filter(where e.email='enviado')::integer as enviados,
  count(*) filter(where e.email in ('pendente','reservado'))::integer as fila,
  count(*) filter(where e.email='conferir')::integer as conferir
  from public.matriz_comunicados c left join public.matriz_entregas e on c.id=e.comunicado
  group by c.id;
revoke all on public.matriz_resumo_entregas from public,anon,authenticated;
grant select on public.matriz_resumo_entregas to service_role;
revoke all on function public.matriz_reservar_email() from public,anon,authenticated;
grant execute on function public.matriz_reservar_email() to service_role;
