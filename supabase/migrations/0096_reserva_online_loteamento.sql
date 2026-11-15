-- E18. As condições de venda ficam isoladas dos campos de edição livre do anúncio.
create table public.espelho_config (
  empreendimento_id uuid primary key references public.properties on delete cascade,
  reserva_online boolean not null default false,
  prazo_horas integer check (prazo_horas between 1 and 2160),
  projeto_url text check (projeto_url is null or (length(projeto_url) <= 2048 and projeto_url like 'https://%')),
  pre_lancamento boolean not null default false,
  alterado_em timestamptz not null default clock_timestamp(),
  check (not reserva_online or prazo_horas is not null)
);
alter table public.espelho_config enable row level security;
revoke all on public.espelho_config from public,anon,authenticated;
grant select,insert,update,delete on public.espelho_config to service_role;
alter table public.property_espelho add column reservado_por uuid references public.profiles(user_id) on delete set null;

create function public.espelho_pode_gerir(p_ator uuid,p_emp public.properties) returns boolean
language sql stable set search_path=public as $$
  select exists(select from profiles p where p.user_id=p_ator and p.ativo and (
    p.role='admin_central' or (p.role='analista_arini' and 'comercial'=any(p.setores))
    or (p.role='proprietario' and exists(select from owners o where o.id=p_emp.owner_id and o.profile_id=p.user_id))
    or exists(select from partners v where v.id=p_emp.partner_id and v.profile_id=p.user_id and v.tipo::text=p.role::text)
  ))
$$;

create function public.espelho_configurar(p_emp uuid,p_ator uuid,p_online boolean,p_horas integer,p_projeto text,p_pre boolean,p_versao timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare emp properties; cfg espelho_config;
begin
  select * into emp from properties where id=p_emp and parent_property_id is null for update;
  if not found or not espelho_pode_gerir(p_ator,emp) then raise exception 'sem_acesso' using errcode='42501'; end if;
  select * into cfg from espelho_config where empreendimento_id=p_emp;
  if cfg.alterado_em is distinct from p_versao then raise exception 'alterado' using errcode='P0001'; end if;
  insert into espelho_config(empreendimento_id,reserva_online,prazo_horas,projeto_url,pre_lancamento)
  values (p_emp,p_online,p_horas,p_projeto,p_pre) on conflict(empreendimento_id) do update set
    reserva_online=excluded.reserva_online,prazo_horas=excluded.prazo_horas,projeto_url=excluded.projeto_url,
    pre_lancamento=excluded.pre_lancamento,alterado_em=clock_timestamp();
  insert into audit_log(user_id,acao,entidade,entidade_id,property_id,dados_depois)
    values(p_ator,'espelho_configurado','espelho_config',p_emp,p_emp,jsonb_build_object('reserva_online',p_online,'prazo_horas',p_horas,'pre_lancamento',p_pre));
end $$;

create function public.espelho_mudar_lote(p_emp uuid,p_lote uuid,p_ator uuid,p_acao text,p_versao timestamptz,p_dados jsonb default '{}')
returns void language plpgsql security definer set search_path=public as $$
declare emp properties; lote properties; cfg espelho_config; atual property_espelho; de text; destino text;
  online boolean; ate timestamptz; cliente text; comprador uuid; op uuid; valor numeric; obs text;
begin
  select * into emp from properties where id=p_emp and parent_property_id is null for share;
  if not found then raise exception 'inexistente' using errcode='P0002'; end if;
  online := p_acao in ('reserva_online','cancelar_minha');
  if not exists(select from profiles where user_id=p_ator and ativo) or
    (not online and not espelho_pode_gerir(p_ator,emp)) then raise exception 'sem_acesso' using errcode='42501'; end if;
  -- A linha do lote existe inclusive antes da primeira reserva.
  select * into lote from properties where id=p_lote and parent_property_id=p_emp for update;
  if not found then raise exception 'inexistente' using errcode='P0002'; end if;
  select * into atual from property_espelho where property_id=p_lote for update;
  de := coalesce(atual.status,case when lote.status::text in ('vendido','historico') then 'vendido' else 'disponivel' end);
  if online and (emp.status::text not in ('publicado','em_negociacao','vendido') or lote.status::text not in ('publicado','em_negociacao','vendido')) then
    raise exception 'inexistente' using errcode='P0002';
  end if;
  if p_acao='reserva_online' and de='reservado' and atual.reservado_por=p_ator and atual.reserva_ate>clock_timestamp() then return; end if;
  if atual.alterado_em is distinct from p_versao then raise exception 'alterado' using errcode='P0001'; end if;
  if de='reservado' and atual.reserva_ate<=clock_timestamp() then
    insert into property_espelho_eventos(property_id,empreendimento_id,de,para,motivo) values(p_lote,p_emp,'reservado','disponivel','Reserva vencida');
    de:='disponivel';
  end if;
  if p_acao='reserva_online' then
    select * into cfg from espelho_config where empreendimento_id=p_emp;
    if cfg.reserva_online is not true or emp.status='vendido' or lote.status='vendido' or de<>'disponivel' then
      raise exception 'indisponivel' using errcode='P0001';
    end if;
    destino:='reservado'; comprador:=p_ator; ate:=clock_timestamp()+make_interval(hours=>cfg.prazo_horas);
    select left(nome,160) into cliente from profiles where user_id=p_ator;
    obs:='Reserva online';
  elsif p_acao='cancelar_minha' then
    if de<>'reservado' or atual.reservado_por is distinct from p_ator then raise exception 'sem_reserva' using errcode='42501'; end if;
    destino:='disponivel'; obs:='Cancelamento pelo cliente';
  else
    destino:=case p_acao when 'reservar' then 'reservado' when 'vender' then 'vendido' when 'liberar' then 'disponivel' end;
    if destino is null or (destino='disponivel' and de='disponivel') or (destino<>'disponivel' and de='vendido') then
      raise exception 'indisponivel' using errcode='P0001';
    end if;
    if destino='reservado' then
      ate:=(p_dados->>'reserva_ate')::timestamptz;
      if ate is null or ate<=clock_timestamp() or ate>clock_timestamp()+interval '90 days' then raise exception 'prazo' using errcode='22023'; end if;
      if de='reservado' then comprador:=atual.reservado_por; end if;
    end if;
    if destino<>'disponivel' then
      cliente:=nullif(left(trim(p_dados->>'cliente_nome'),160),''); op:=(p_dados->>'opportunity_id')::uuid;
      if op is not null and not exists(select from opportunities where id=op and property_id=p_lote) then raise exception 'negociacao' using errcode='22023'; end if;
    end if;
    if destino='vendido' then
      if cliente is null then raise exception 'comprador' using errcode='22023'; end if;
      valor:=(p_dados->>'valor_venda')::numeric;
    elsif comprador is not null then
      -- Renovação da reserva online conserva o comprador original.
      cliente:=atual.cliente_nome;
    end if;
    obs:=nullif(left(trim(p_dados->>'observacao'),1000),'');
  end if;
  insert into property_espelho(property_id,empreendimento_id,status,reserva_ate,cliente_nome,opportunity_id,valor_venda,observacao,alterado_por,alterado_em,reservado_por)
    values(p_lote,p_emp,destino,ate,cliente,op,valor,obs,p_ator,clock_timestamp(),comprador)
    on conflict(property_id) do update set status=excluded.status,reserva_ate=excluded.reserva_ate,cliente_nome=excluded.cliente_nome,
      opportunity_id=excluded.opportunity_id,valor_venda=excluded.valor_venda,observacao=excluded.observacao,
      alterado_por=excluded.alterado_por,alterado_em=excluded.alterado_em,reservado_por=excluded.reservado_por;
  insert into property_espelho_eventos(property_id,empreendimento_id,de,para,reserva_ate,cliente_nome,opportunity_id,motivo,autor)
    values(p_lote,p_emp,de,destino,ate,cliente,op,obs,p_ator);
  insert into audit_log(user_id,acao,entidade,entidade_id,property_id,opportunity_id,dados_antes,dados_depois)
    values(p_ator,'espelho_'||destino,'property_espelho',p_lote,p_lote,op,jsonb_build_object('status',de),
      jsonb_build_object('status',destino,'reserva_ate',ate,'valor_venda',valor,'origem',p_acao));
end $$;

-- A leitura pública projeta somente as unidades publicadas. O prazo individual só vai ao titular.
create function public.espelho_estoque_publico(p_emp uuid,p_ator uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('online',coalesce(c.reserva_online,false) and emp.status<>'vendido','horas',c.prazo_horas,
    'unidades',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'status',case
      when l.status='vendido' then 'vendido' when e.status='reservado' and e.reserva_ate<=now() then 'disponivel'
      else coalesce(e.status,'disponivel') end,'versao',e.alterado_em,'minha_ate',case
      when e.status='reservado' and e.reservado_por=p_ator and e.reserva_ate>now() then e.reserva_ate end))
      from properties l left join property_espelho e on e.property_id=l.id where l.parent_property_id=emp.id
      and l.status::text in ('publicado','em_negociacao','vendido')), '[]'::jsonb))
  from properties emp left join espelho_config c on c.empreendimento_id=emp.id
  where emp.id=p_emp and emp.parent_property_id is null and emp.status::text in ('publicado','em_negociacao','vendido')
$$;

-- Mesmo uma expiração acionada pela gestão limpa o titular e as anotações privadas.
create or replace function public.fn_espelho_liberar_vencidas(p_empreendimento_id uuid default null) returns integer
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  with vencidas as (
    update property_espelho e set status='disponivel',reserva_ate=null,cliente_nome=null,opportunity_id=null,
      reservado_por=null,valor_venda=null,observacao=null,alterado_por=null,alterado_em=clock_timestamp()
      where e.status='reservado' and e.reserva_ate<=now() and (p_empreendimento_id is null or e.empreendimento_id=p_empreendimento_id)
      returning e.property_id,e.empreendimento_id
  ), ev as (
    insert into property_espelho_eventos(property_id,empreendimento_id,de,para,motivo)
      select property_id,empreendimento_id,'reservado','disponivel','Reserva vencida' from vencidas returning 1
  ) select count(*) into n from ev;
  return n;
end $$;
revoke all on function public.espelho_pode_gerir(uuid,public.properties),public.espelho_configurar(uuid,uuid,boolean,integer,text,boolean,timestamptz),
  public.espelho_mudar_lote(uuid,uuid,uuid,text,timestamptz,jsonb),public.espelho_estoque_publico(uuid,uuid) from public,anon,authenticated;
grant execute on function public.espelho_configurar(uuid,uuid,boolean,integer,text,boolean,timestamptz),
  public.espelho_mudar_lote(uuid,uuid,uuid,text,timestamptz,jsonb),public.espelho_estoque_publico(uuid,uuid) to service_role;
