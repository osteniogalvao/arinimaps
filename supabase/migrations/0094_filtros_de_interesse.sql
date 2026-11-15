insert into public.settings(chave,valor) values
  ('filtros_comprador_gratis','3'),('filtros_comprador_pacote','10'),('filtros_intervalo_minutos','10')
on conflict (chave) do nothing;

create table public.filtros_interesse (
  id uuid primary key default gen_random_uuid(),
  titular uuid not null references public.profiles(user_id) on delete cascade,
  nome text not null check(length(nome) between 1 and 80),
  municipio uuid references public.municipalities(id),
  tipo text check(tipo in ('urbano','rural','leilao')),
  preco_min numeric check(preco_min>=0), preco_max numeric check(preco_max>=0 and preco_max>=coalesce(preco_min,0)),
  area_min numeric check(area_min>=0), area_max numeric check(area_max>=0 and area_max>=coalesce(area_min,0)),
  essenciais text not null default '' check(length(essenciais)<=120),
  financiamento boolean not null default false, permuta boolean not null default false,
  whatsapp boolean not null default false, ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index filtros_interesse_titular on public.filtros_interesse(titular,criado_em,id) where ativo;
create index filtros_interesse_municipio on public.filtros_interesse(municipio,tipo) where ativo;
create table public.filtro_publicacoes (
  imovel uuid primary key references public.properties(id) on delete cascade,
  publicado_em timestamptz not null default now()
);
create table public.filtro_avisos (
  id uuid primary key default gen_random_uuid(),
  titular uuid not null references public.profiles(user_id) on delete cascade,
  imovel uuid not null references public.properties(id) on delete cascade,
  filtros uuid[] not null,
  criado_em timestamptz not null default now(),
  lido_em timestamptz,
  whatsapp text not null check(whatsapp in ('conta','pendente','enviando','enviado','recusado','conferir','cancelado')),
  reservado_em timestamptz, wa_id text,
  unique(titular,imovel)
);
create index filtro_avisos_pendentes on public.filtro_avisos(criado_em) where whatsapp='pendente';
alter table public.filtros_interesse enable row level security;
alter table public.filtro_avisos enable row level security;
alter table public.filtro_publicacoes enable row level security;
revoke all on public.filtros_interesse,public.filtro_avisos,public.filtro_publicacoes from public,anon,authenticated;
grant select on public.filtros_interesse to service_role;
grant select,update on public.filtro_avisos to service_role;

create function public.fn_filtro_limite(p_titular uuid) returns integer language sql stable security definer set search_path='' as $$
  select public.fn_ari_param(case when exists(select 1 from public.ari_lotes
    where titular=p_titular and nicho='comprador_investidor' and carteira='compra' and not bloqueado and validade>now())
    then 'filtros_comprador_pacote' else 'filtros_comprador_gratis' end)
$$;
create function public.fn_filtro_salvar(p_titular uuid,p_id uuid,p_dados jsonb,p_ativo boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare filtro public.filtros_interesse; limite int; novo uuid;
begin
  if not exists(select 1 from public.profiles where user_id=p_titular and ativo and nicho='comprador_investidor' for update) then
    raise exception using errcode='42501',message='Selecione o perfil comprador.';
  end if;
  if p_id is not null then select * into strict filtro from public.filtros_interesse where id=p_id and titular=p_titular for update; end if;
  if p_ativo and (p_id is null or not filtro.ativo) then
    limite:=public.fn_filtro_limite(p_titular);
    if limite is null or (select count(*) from public.filtros_interesse where titular=p_titular and ativo)>=limite then
      raise exception using errcode='P9401',message='Limite de filtros ativos atingido.';
    end if;
  end if;
  if p_id is not null then
    update public.filtros_interesse set ativo=p_ativo,criado_em=case when p_ativo and not ativo then now() else criado_em end where id=p_id;
    return p_id;
  end if;
  if coalesce((p_dados->>'whatsapp')::boolean,false) and not coalesce((select permitido from public.conta_consentimentos
    where titular=p_titular and finalidade='whatsapp' order by id desc limit 1), false) then
    raise exception using errcode='P9402',message='Confirme a preferência de WhatsApp antes de criar o filtro.';
  end if;
  insert into public.filtros_interesse(titular,nome,municipio,tipo,preco_min,preco_max,area_min,area_max,essenciais,financiamento,permuta,whatsapp)
    values(p_titular,trim(p_dados->>'nome'),(p_dados->>'municipio')::uuid,p_dados->>'tipo',(p_dados->>'preco_min')::numeric,
      (p_dados->>'preco_max')::numeric,(p_dados->>'area_min')::numeric,(p_dados->>'area_max')::numeric,
      trim(coalesce(p_dados->>'essenciais','')),coalesce((p_dados->>'financiamento')::boolean,false),
      coalesce((p_dados->>'permuta')::boolean,false),coalesce((p_dados->>'whatsapp')::boolean,false)) returning id into novo;
  insert into public.audit_log(user_id,acao,entidade,entidade_id) values(p_titular,'filtro_criado','filtros_interesse',novo);
  return novo;
end $$;

create function public.fn_filtro_publicado() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='publicado' and (tg_op='INSERT' or old.status not in ('publicado','em_negociacao')) then
    insert into public.filtro_publicacoes(imovel) values(new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_filtro_publicado after insert or update of status on public.properties for each row execute function public.fn_filtro_publicado();

-- Cada anúncio novo é comparado numa transação fora da publicação. Uma conta recebe
-- apenas um aviso por imóvel, mesmo quando vários filtros coincidirem ou o imóvel voltar ao ar.
create function public.fn_filtro_corresponder() returns integer language plpgsql security definer set search_path='' as $$
declare pub record; total int:=0; qtd int;
begin
  for pub in select * from public.filtro_publicacoes order by publicado_em limit 100 for update skip locked loop
    insert into public.filtro_avisos(titular,imovel,filtros,whatsapp)
    select f.titular,p.id,array_agg(f.id),case when bool_or(f.whatsapp) and coalesce((select permitido from public.conta_consentimentos
      where titular=f.titular and finalidade='whatsapp' order by id desc limit 1),false) then 'pendente' else 'conta' end
    from public.properties p
      left join public.property_geometries g on g.property_id=p.id
      join public.filtros_interesse f on f.ativo and f.criado_em<=pub.publicado_em
        and (f.municipio is null or f.municipio=p.municipality_id)
        and (f.tipo is null or f.tipo=p.tipo::text or (f.tipo='leilao' and p.modalidade='leilao'))
        and (f.preco_min is null or p.valor>=f.preco_min) and (f.preco_max is null or p.valor<=f.preco_max)
        and (f.area_min is null or g.area_m2>=f.area_min) and (f.area_max is null or g.area_m2<=f.area_max)
        and (not f.financiamento or p.aceita_financiamento) and (not f.permuta or p.aceita_permuta)
        and not exists(select 1 from regexp_split_to_table(lower(f.essenciais),'[[:space:],]+') as termo
          where termo<>'' and strpos(lower(p.titulo||' '||p.descricao),termo)=0)
      join public.profiles perfil on perfil.user_id=f.titular and perfil.ativo
    where p.id=pub.imovel and p.status in ('publicado','em_negociacao') and
      (select count(*) from public.filtros_interesse anterior where anterior.titular=f.titular and anterior.ativo
        and (anterior.criado_em,anterior.id)<=(f.criado_em,f.id))<=public.fn_filtro_limite(f.titular)
    group by f.titular,p.id on conflict(titular,imovel) do nothing;
    get diagnostics qtd = row_count; total:=total+qtd;
    delete from public.filtro_publicacoes where imovel=pub.imovel;
  end loop;
  return total;
end $$;

create function public.fn_filtro_reservar_wa() returns table(aviso uuid,telefone text,codigo text)
language plpgsql security definer set search_path='' as $$
declare v public.filtro_avisos; destino text; cod text;
begin
  update public.filtro_avisos set whatsapp='conferir' where whatsapp='enviando' and reservado_em<now()-interval '15 minutes';
  for v in select * from public.filtro_avisos where whatsapp='pendente' order by criado_em limit 1 for update skip locked loop
    select p.telefone,i.codigo into destino,cod from public.profiles p join public.properties i on i.id=v.imovel
      where p.user_id=v.titular and p.ativo and i.status in ('publicado','em_negociacao')
      and exists(select 1 from public.filtros_interesse f where f.id=any(v.filtros) and f.ativo and f.whatsapp)
      and coalesce((select permitido from public.conta_consentimentos where titular=v.titular and finalidade='whatsapp' order by id desc limit 1),false);
    if destino is null or cod is null then
      update public.filtro_avisos set whatsapp='cancelado' where id=v.id;
    else
      update public.filtro_avisos set whatsapp='enviando',reservado_em=now() where id=v.id;
      aviso:=v.id; telefone:=destino; codigo:=cod; return next;
    end if;
  end loop;
end $$;
revoke all on function public.fn_filtro_limite(uuid),public.fn_filtro_salvar(uuid,uuid,jsonb,boolean),public.fn_filtro_publicado(),
  public.fn_filtro_corresponder(),public.fn_filtro_reservar_wa() from public,anon,authenticated;
grant execute on function public.fn_filtro_limite(uuid),public.fn_filtro_salvar(uuid,uuid,jsonb,boolean),public.fn_filtro_corresponder(),public.fn_filtro_reservar_wa() to service_role;
