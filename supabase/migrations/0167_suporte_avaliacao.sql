-- Avaliação espontânea, uma por chamado resolvido. Não dispara notificações.
create table public.support_avaliacoes (
  ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
  titular_id uuid references public.profiles(user_id) on delete set null,
  responsavel_id uuid references public.profiles(user_id) on delete set null,
  nota smallint not null check (nota between 1 and 5),
  comentario text not null default '' check (length(comentario) <= 1000),
  resolvido_em timestamptz,
  created_at timestamptz not null default now()
);
create index support_avaliacoes_created on public.support_avaliacoes(created_at desc);
alter table public.support_avaliacoes enable row level security;
revoke all on public.support_avaliacoes from anon, authenticated;
grant select on public.support_avaliacoes to authenticated;
grant all on public.support_avaliacoes to service_role;
create policy avaliacao_propria on public.support_avaliacoes for select to authenticated using(titular_id=auth.uid());

create or replace function public.suporte_avaliar(p_ticket uuid,p_nota integer,p_comentario text default '')
returns public.support_avaliacoes language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.support_tickets; a public.support_avaliacoes; u uuid:=auth.uid(); c text:=btrim(coalesce(p_comentario,''));
begin
  if u is null or not exists(select 1 from public.profiles where user_id=u and ativo is true) then
    raise insufficient_privilege using message='Entre na sua conta.';
  end if;
  if p_nota is null or p_nota not between 1 and 5 or length(c)>1000 then
    raise invalid_parameter_value using message='Informe uma nota de 1 a 5 e comentário de até 1000 caracteres.';
  end if;
  select * into t from public.support_tickets where id=p_ticket and user_id=u for update;
  if not found then raise no_data_found using message='Chamado não encontrado.'; end if;
  if t.status<>'resolvido' then raise sqlstate '55000' using message='O chamado precisa estar resolvido para ser avaliado.'; end if;
  select * into a from public.support_avaliacoes where ticket_id=p_ticket;
  if found then
    if a.nota=p_nota and a.comentario=c then return a; end if;
    raise unique_violation using message='Este chamado já foi avaliado.';
  end if;
  insert into public.support_avaliacoes(ticket_id,titular_id,responsavel_id,nota,comentario,resolvido_em)
    values(t.id,u,t.responsavel,p_nota,c,t.resolvido_em) returning * into a;
  return a;
end $$;
revoke all on function public.suporte_avaliar(uuid,integer,text) from public,anon,service_role;
grant execute on function public.suporte_avaliar(uuid,integer,text) to authenticated;

-- Chamada apenas pelo servidor após exigir o setor Suporte.
create function public.suporte_avaliacoes_resumo(p_desde timestamptz)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('total',count(*),'media',round(avg(nota),2),
   'nota1',count(*) filter(where nota=1),'nota2',count(*) filter(where nota=2),
   'nota3',count(*) filter(where nota=3),'nota4',count(*) filter(where nota=4),
   'nota5',count(*) filter(where nota=5)) from public.support_avaliacoes where created_at>=p_desde;
$$;
revoke all on function public.suporte_avaliacoes_resumo(timestamptz) from public,anon,authenticated;
grant execute on function public.suporte_avaliacoes_resumo(timestamptz) to service_role;
