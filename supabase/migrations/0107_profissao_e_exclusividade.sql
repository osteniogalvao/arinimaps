alter table public.profiles
  add column profissao_declarada text check(length(profissao_declarada) between 2 and 100),
  add column especialidade text check(length(especialidade) between 2 and 120),
  add column avisos_email boolean not null default false;

alter table public.property_authorizations
  add column prazo_meses smallint check(prazo_meses is null or (tipo='exclusividade' and prazo_meses in (6,12))),
  add column termo_aceito jsonb check(termo_aceito is null or (prazo_meses is not null and aceite_at is not null));

-- Pedir um módulo e acompanhar a resposta não concede acesso aos registros do CRM.
create or replace function public.tecnico_pedir_profissao(p_id uuid,p_profissao text,p_descricao text) returns uuid language plpgsql security definer set search_path='' as $$
declare existente public.tecnico_pedidos; prazo date;
begin
 if not exists(select from public.profiles where user_id=auth.uid() and ativo and nicho='engenheiro') then raise insufficient_privilege; end if;
 if length(trim(coalesce(p_profissao,''))) not between 3 and 100 or length(trim(coalesce(p_descricao,''))) not between 8 and 2000 or lower(trim(p_profissao))='corretagem' then raise invalid_parameter_value; end if;
 if exists(select from public.tecnico_modulos where lower(profissao)=lower(trim(p_profissao)) and ativo) then raise object_not_in_prerequisite_state; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||lower(trim(p_profissao)),0));
 select * into existente from public.tecnico_pedidos where titular=auth.uid() and (id=p_id or lower(profissao)=lower(trim(p_profissao)) and estado in ('recebido','em_analise')) limit 1;
 if found then
   if existente.id=p_id and row(existente.profissao,existente.descricao) is distinct from row(trim(p_profissao),trim(p_descricao)) then raise unique_violation; end if;
   return existente.id;
 end if;
 select d::date into prazo from generate_series((now() at time zone 'America/Sao_Paulo')::date+1,(now() at time zone 'America/Sao_Paulo')::date+12,interval '1 day')d
 where extract(isodow from d)<=5 order by d offset 4 limit 1;
 insert into public.tecnico_pedidos(id,titular,profissao,descricao,previsao) values(p_id,auth.uid(),trim(p_profissao),trim(p_descricao),prazo);
 return p_id;
end $$;
alter policy pedido_proprio on public.tecnico_pedidos using(
 titular=(select auth.uid()) and exists(select from public.profiles p where p.user_id=(select auth.uid()) and p.ativo and p.nicho='engenheiro')
);
