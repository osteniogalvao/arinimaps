-- Papel global de leitura da equipe. Setores continuam delimitando o que consulta.
alter table public.profiles add column if not exists equipe_acesso text not null default 'operador';
alter table public.profiles drop constraint if exists profiles_equipe_acesso;
alter table public.profiles add constraint profiles_equipe_acesso check (
  equipe_acesso in ('operador','leitura') and
  (equipe_acesso <> 'leitura' or (role='analista_arini' and cardinality(coalesce(setores_gestor,'{}'))=0))
);

-- 2FA obrigatório DESLIGADO (24/11/2026): a Diretoria e os gestores ainda não
-- cadastraram o autenticador. A função fica para religar no futuro; hoje sempre
-- libera. Quem tem 2FA cadastrado continua sendo cobrado pelo login (aal2).
create or replace function public.fn_equipe_mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select true;
$$;
revoke all on function public.fn_equipe_mfa_ok() from public;
grant execute on function public.fn_equipe_mfa_ok() to anon,authenticated,service_role;

-- As RPCs de visibilidade também precisam perder os privilégios da equipe em
-- aal1: SECURITY DEFINER não passa pelas policies da tabela que consulta.
create or replace function public.fn_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where user_id=auth.uid() and public.fn_equipe_mfa_ok();
$$;
create or replace function public.fn_tem_setor(p_setor text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fn_equipe_mfa_ok() and exists (
    select 1 from public.profiles where user_id=auth.uid() and coalesce(ativo,true)
      and (role='admin_central' or (role='analista_arini' and p_setor=any(setores)))
  );
$$;
grant execute on function public.fn_role(),public.fn_tem_setor(text) to anon,authenticated,service_role;

-- Sem 2FA obrigatório não há policy restritiva extra; remove a de versões de teste.
do $$declare t record;begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition
  loop
    execute format('drop policy if exists equipe_mfa_consulta on public.%I',t.relname);
  end loop;
end $$;

-- O trigger também protege chamadas diretas ao SDK e RPCs SECURITY DEFINER:
-- auth.uid() continua sendo o titular do JWT mesmo quando current_user é o dono da função.
create or replace function public.fn_equipe_leitura_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare titular uuid := auth.uid(); perfil public.profiles%rowtype; leitura boolean; falta_mfa boolean;
begin
  if titular is not null then
    select * into perfil from public.profiles where user_id=titular;
    leitura := perfil.equipe_acesso='leitura';
    falta_mfa := false; -- 2FA obrigatório desligado (24/11/2026)
  end if;
  if coalesce(leitura,false) or coalesce(falta_mfa,false) then
    -- Preferências da própria conta não dão poder sobre o CRM.
    if tg_table_name='profiles' and tg_op='UPDATE' and (to_jsonb(old)->>'user_id')::uuid=titular
      and (to_jsonb(old)-array['nome','telefone','avatar_url','preferencias','updated_at'])
        = (to_jsonb(new)-array['nome','telefone','avatar_url','preferencias','updated_at']) then
      return new;
    end if;
    if tg_table_name='notificacoes' and tg_op='UPDATE' and (to_jsonb(old)->>'user_id')::uuid=titular
      and (to_jsonb(old)-'lida_em')=(to_jsonb(new)-'lida_em') then return new; end if;
    if falta_mfa then raise exception 'Confirme o segundo fator para continuar.' using errcode='42501'; end if;
    raise exception 'Seu acesso é somente de leitura. Peça a alteração à Diretoria.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.fn_equipe_leitura_guard() from public,anon,authenticated;

do $$declare t record;begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition
      and not exists (select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
  loop
    execute format('drop trigger if exists trg_equipe_leitura_guard on public.%I',t.relname);
    execute format('create trigger trg_equipe_leitura_guard before insert or update or delete on public.%I for each row execute function public.fn_equipe_leitura_guard()',t.relname);
  end loop;
end $$;
