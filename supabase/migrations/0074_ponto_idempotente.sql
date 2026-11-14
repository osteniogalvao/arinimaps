alter table public.ponto_marcacoes add column if not exists registro_cliente uuid;
create unique index if not exists uq_ponto_registro_cliente on public.ponto_marcacoes (user_id, registro_cliente)
  where registro_cliente is not null;

create or replace function public.fn_registrar_ponto(
  p_user uuid, p_registro uuid, p_offline_em timestamptz, p_ip text, p_agente text,
  p_lat double precision, p_lng double precision, p_precisao double precision
) returns jsonb language plpgsql set search_path=public as $$
declare m ponto_marcacoes%rowtype; instante timestamptz := coalesce(p_offline_em, now()); novo boolean := false;
begin
  -- O mesmo bloqueio também protege a cadeia de hashes do trigger da 0067.
  perform pg_advisory_xact_lock(hashtext('ponto_marcacoes'));
  select * into m from ponto_marcacoes where user_id=p_user and registro_cliente=p_registro;
  if not found and p_offline_em is not null then
    -- Fila anterior à 0074 que perdeu a confirmação após salvar no servidor.
    select * into m from ponto_marcacoes where user_id=p_user and origem='offline'
      and registro_cliente is null and marcado_em=p_offline_em order by nsr limit 1;
  end if;
  if m.id is null then
    if instante < now()-interval '12 hours' or instante > now()+interval '1 minute' then
      return jsonb_build_object('erro','fora_do_prazo');
    end if;
    if exists (select 1 from ponto_marcacoes where user_id=p_user and
        marcado_em > instante-interval '1 minute' and marcado_em < instante+interval '1 minute') then
      return jsonb_build_object('erro','proxima');
    end if;
    insert into ponto_marcacoes(user_id,registro_cliente,marcado_em,origem,ip,user_agent,latitude,longitude,precisao_m)
      values (p_user,p_registro,instante,case when p_offline_em is null then 'web' else 'offline' end,
              p_ip,p_agente,p_lat,p_lng,p_precisao) returning * into m;
    novo := true;
  end if;
  return jsonb_build_object('novo',novo,'comprovante',jsonb_build_object(
    'id',m.id,'nsr',m.nsr,'marcado_em',m.marcado_em,'hash',m.hash));
end $$;

revoke all on function public.fn_registrar_ponto(uuid,uuid,timestamptz,text,text,double precision,double precision,double precision)
  from public,anon,authenticated;
grant execute on function public.fn_registrar_ponto(uuid,uuid,timestamptz,text,text,double precision,double precision,double precision)
  to service_role;
