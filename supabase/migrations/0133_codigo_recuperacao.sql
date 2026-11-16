-- Cada tentativa é contada dentro do bloqueio da linha. Reenvio troca o hash.
create function public.fn_tentar_codigo_recuperacao(p_user uuid,p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.recuperacao_codigos%rowtype;
begin
  select * into r from public.recuperacao_codigos where user_id=p_user for update;
  if not found or r.expira_em<=clock_timestamp() or r.tentativas>=5 then return false; end if;
  if r.codigo_hash is distinct from p_hash then
    update public.recuperacao_codigos set tentativas=tentativas+1 where user_id=p_user;
    return false;
  end if;
  delete from public.recuperacao_codigos where user_id=p_user;
  return true;
end $$;
revoke all on function public.fn_tentar_codigo_recuperacao(uuid,text) from public,anon,authenticated;
grant execute on function public.fn_tentar_codigo_recuperacao(uuid,text) to service_role;
