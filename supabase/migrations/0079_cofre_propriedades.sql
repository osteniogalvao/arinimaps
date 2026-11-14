-- Carteira particular sem vínculo com os anúncios, contratos ou registros oficiais.
create table public.cofre_propriedades (
  id uuid primary key, titular_id uuid not null references public.profiles(user_id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 160),
  municipio text not null check (length(btrim(municipio)) between 1 and 160),
  area_ha numeric not null check (area_ha > 0 and area_ha <= 51010000000),
  car text check (length(car) between 1 and 160), matricula text check (length(matricula) between 1 and 160),
  created_at timestamptz not null default now(), unique(titular_id,id)
);
create index cofre_imoveis_titular on public.cofre_propriedades(titular_id,created_at desc,id);
create table public.cofre_documentos (
  id uuid primary key, titular_id uuid not null, propriedade_id uuid not null,
  nome_arquivo text not null check (length(nome_arquivo) between 1 and 200),
  storage_path text not null unique,
  tamanho_bytes integer not null check (tamanho_bytes between 1 and 26214400),
  created_at timestamptz not null default now(),
  foreign key(titular_id,propriedade_id) references public.cofre_propriedades(titular_id,id) on delete cascade,
  check (storage_path ~ ('^cofre/' || titular_id::text || '/' || propriedade_id::text || '/' || id::text || '[.][a-z0-9]{1,6}$'))
);
create index cofre_docs_imovel on public.cofre_documentos(titular_id,propriedade_id,created_at);
create table public.cofre_concessoes (
  pedido_id uuid primary key references public.solicitacoes_planos(id) on delete cascade,
  titular_id uuid not null references public.profiles(user_id) on delete cascade,
  quantidade int not null check (quantidade > 0),
  concedido_por uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index cofre_concessoes_titular on public.cofre_concessoes(titular_id);

alter table public.cofre_propriedades enable row level security;
alter table public.cofre_documentos enable row level security;
alter table public.cofre_concessoes enable row level security;
revoke all on public.cofre_propriedades, public.cofre_documentos, public.cofre_concessoes from public,anon,authenticated,service_role;
grant select on public.cofre_propriedades, public.cofre_documentos, public.cofre_concessoes to service_role;
grant delete on public.cofre_propriedades to service_role;
grant insert,delete on public.cofre_documentos to service_role;

create function public.cofre_perfil(p_titular uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id=p_titular and ativo
    and role not in ('admin_central','analista_arini')
    and (nicho in ('proprietario','produtor_rural') or (nicho is null and role='proprietario')));
$$;
create function public.cofre_limite(p_titular uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  with efetivo as (
    select coalesce(org.cotas,pessoal.cotas)->>'propriedades_cofre' as vagas
    from public.profiles p
    left join public.plans pessoal on pessoal.id=p.plan_id and pessoal.ativo and (p.plan_valido_ate is null or p.plan_valido_ate >= now())
    left join lateral (
      select plano.cotas from public.organization_members m join public.organizations o on o.id=m.org_id
      join public.plans plano on plano.id=o.plan_id and plano.ativo and plano.escopo='organizacao'
      where m.user_id=p.user_id and m.status='ativo' and o.ativo and (o.plan_valido_ate is null or o.plan_valido_ate >= now())
    ) org on p.plan_origem='padrao' where p.user_id=p_titular
  )
  select coalesce((select case when vagas ~ '^[0-9]{1,9}$' then vagas::int end from efetivo),3)
       + coalesce((select sum(quantidade) from public.cofre_concessoes where titular_id=p_titular),0);
$$;
create function public.cofre_salvar_propriedade(p_titular uuid, p_id uuid, p_nome text, p_municipio text, p_area_ha numeric, p_car text, p_matricula text, p_nova boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare imovel public.cofre_propriedades;
begin
  -- A contagem e o insert ficam sob o mesmo lock por titular, inclusive quando ainda não há imóveis.
  perform 1 from public.profiles where user_id=p_titular for update;
  if not public.cofre_perfil(p_titular) then raise insufficient_privilege; end if;
  select * into imovel from public.cofre_propriedades where id=p_id and titular_id=p_titular;
  if found then
    if p_nova then
      if row(imovel.nome,imovel.municipio,imovel.area_ha,imovel.car,imovel.matricula)
        is distinct from row(p_nome,p_municipio,p_area_ha,p_car,p_matricula) then raise unique_violation; end if;
    else
      update public.cofre_propriedades set nome=p_nome, municipio=p_municipio, area_ha=p_area_ha, car=p_car, matricula=p_matricula
        where id=p_id and titular_id=p_titular;
    end if;
  elsif not p_nova then raise no_data_found;
  else
    if (select count(*) from public.cofre_propriedades where titular_id=p_titular) >= public.cofre_limite(p_titular)
      then raise sqlstate '54000' using message='Limite de propriedades atingido'; end if;
    insert into public.cofre_propriedades(id,titular_id,nome,municipio,area_ha,car,matricula)
      values (p_id,p_titular,p_nome,p_municipio,p_area_ha,p_car,p_matricula);
  end if;
  return p_id;
end $$;

-- Operação independente da conclusão do pedido. Somente operadores autorizados
-- conseguem conceder exatamente a quantidade registrada no orçamento original.
create function public.cofre_conceder_vagas(p_ator uuid, p_pedido uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare pedido public.solicitacoes_planos; qtd int;
begin
  if not exists (select 1 from public.profiles where user_id=p_ator and ativo and
    (role='admin_central' or (role='analista_arini' and 'financeiro'=any(setores)))) then raise insufficient_privilege; end if;
  select * into pedido from public.solicitacoes_planos where id=p_pedido for update;
  if not found then raise no_data_found; end if;
  if pedido.status <> 'concluido' or not public.cofre_perfil(pedido.user_id) then raise object_not_in_prerequisite_state; end if;
  select (i->>'quantidade')::int into qtd from jsonb_array_elements(pedido.cotacao->'itens') as i where i->>'id'='propriedade_adicional';
  if qtd is null or qtd <= 0 then raise invalid_parameter_value; end if;
  insert into public.cofre_concessoes(pedido_id,titular_id,quantidade,concedido_por) values (p_pedido,pedido.user_id,qtd,p_ator)
    on conflict(pedido_id) do nothing;
  if found then
    insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
      values(p_ator,'cofre.vagas_concedidas','solicitacoes_planos',p_pedido,jsonb_build_object('quantidade',qtd));
  end if;
  return qtd;
end $$;
revoke all on function public.cofre_perfil(uuid), public.cofre_limite(uuid), public.cofre_salvar_propriedade(uuid,uuid,text,text,numeric,text,text,boolean),
  public.cofre_conceder_vagas(uuid,uuid) from public, anon, authenticated;
grant execute on function public.cofre_limite(uuid), public.cofre_salvar_propriedade(uuid,uuid,text,text,numeric,text,text,boolean),
  public.cofre_conceder_vagas(uuid,uuid) to service_role;
