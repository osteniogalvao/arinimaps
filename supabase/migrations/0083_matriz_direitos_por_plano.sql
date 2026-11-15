-- O anexo é confidencial. O operador importa seu JSON em uma única transação.
alter table public.matriz_personas
  add column disposicao text,
  add column fase text,
  add column observacoes text,
  add column canonico integer references public.matriz_personas(id) deferrable initially deferred,
  add column futuro boolean not null default false;

create function public.fn_importar_matriz_personas(p_itens jsonb)
returns integer language plpgsql set search_path = pg_catalog, public as $$
declare
  chaves constant text[] := array['proprietario','corretor_imobiliaria','produtor_rural','engenheiro',
    'comprador_investidor','leiloeiro','ente_publico','empresa_holding','quero_vender','correspondente_bancario'];
  n integer;
begin
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) <> 915 then
    raise exception 'Quantidade de itens inválida';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_itens) x(id integer, permissoes jsonb, disposicao text, fase text)
    where x.id is null or x.id not between 1 and 915
      or jsonb_typeof(x.permissoes) is distinct from 'object' or not (x.permissoes ?& chaves)
      or (x.permissoes - chaves) <> '{}'::jsonb
      or exists (select from jsonb_each_text(x.permissoes) p where p.value is null or p.value not in ('C','L','O','P','M','G','-'))
      or x.disposicao is null or x.disposicao not in ('Produto','Plataforma (segurança e permissões)','Backoffice ARINI','Integração','Fora do escopo (estratégico)','Negócio (fora do software)')
      or x.fase is null or x.fase not in ('L0 Lançamento','F1 até 30 dias','F2 30 a 90 dias','F3 sob demanda','—')
  ) then raise exception 'Linha ou nível de acesso inválido'; end if;
  insert into public.matriz_personas (id,titulo,natureza,modulo,subsecao,permissoes,disposicao,fase,observacoes,canonico,futuro)
  select * from jsonb_to_recordset(p_itens) x(id integer, titulo text, natureza text, modulo text, subsecao text,
    permissoes jsonb, disposicao text, fase text, observacoes text, canonico integer, futuro boolean)
  on conflict (id) do update set titulo=excluded.titulo, natureza=excluded.natureza, modulo=excluded.modulo,
    subsecao=excluded.subsecao, permissoes=excluded.permissoes, disposicao=excluded.disposicao, fase=excluded.fase,
    observacoes=excluded.observacoes, canonico=excluded.canonico, futuro=excluded.futuro;
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.fn_importar_matriz_personas(jsonb) from public, anon, authenticated, service_role;

create table public.plano_direitos_item (
  plano_id text not null references public.plans(id) on delete cascade,
  item_id integer not null references public.matriz_personas(id),
  liberado boolean not null,
  primary key (plano_id, item_id)
);
alter table public.plano_direitos_item enable row level security;
revoke all on public.plano_direitos_item from public, anon, authenticated, service_role;
grant select on public.plano_direitos_item to service_role;

create function public.fn_niveis_itens_persona(p_persona text, p_plano text, p_itens integer[])
returns table (id integer, nivel text, liberado boolean)
language sql stable set search_path = '' as $$
  select m.id, case when m.disposicao = 'Produto' then m.permissoes ->> p_persona else '-' end, d.liberado
  from public.matriz_personas m left join public.plano_direitos_item d
    on d.item_id = m.id and d.plano_id = p_plano
  where m.id = any(p_itens)
$$;
revoke all on function public.fn_niveis_itens_persona(text,text,integer[]) from public, anon, authenticated;
grant execute on function public.fn_niveis_itens_persona(text,text,integer[]) to service_role;

create function public.fn_configurar_direito_plano(p_admin uuid, p_plano text, p_item integer, p_liberado boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare antes boolean;
begin
  if not exists (select from public.profiles where user_id = p_admin and role = 'admin_central' and ativo) then
    raise exception 'Acesso restrito à diretoria' using errcode = '42501';
  end if;
  if not exists (select from public.matriz_personas where id = p_item and disposicao = 'Produto') then
    raise exception 'Selecione um item de produto' using errcode = '22023';
  end if;
  -- Catálogo de imóveis à venda é comum a todos. Um pacote não pode restringi-lo.
  if p_item in (1,15,20,48,59) or p_item between 222 and 238 or p_item between 260 and 289 then
    raise exception 'Este item tem acesso comum a todos os planos' using errcode = '22023';
  end if;
  perform 1 from public.plans where id = p_plano for update;
  if not found then raise exception 'Plano desconhecido' using errcode = '22023'; end if;
  select liberado into antes from public.plano_direitos_item where plano_id = p_plano and item_id = p_item;
  if antes is not distinct from p_liberado then return; end if;
  if p_liberado is null then
    delete from public.plano_direitos_item where plano_id = p_plano and item_id = p_item;
  else
    insert into public.plano_direitos_item values (p_plano,p_item,p_liberado)
    on conflict (plano_id,item_id) do update set liberado = excluded.liberado;
  end if;
  insert into public.audit_log(user_id,acao,entidade,dados_antes,dados_depois)
  values (p_admin,'direito_item_alterado','plano_direitos_item',
    jsonb_build_object('plano',p_plano,'item',p_item,'liberado',antes),
    jsonb_build_object('plano',p_plano,'item',p_item,'liberado',p_liberado));
end; $$;
revoke all on function public.fn_configurar_direito_plano(uuid,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.fn_configurar_direito_plano(uuid,text,integer,boolean) to service_role;

-- O cache da geometria pode ser idêntico para duas contas. Cada desenho
-- enviado recebe um vínculo próprio. Conhecer a chave não cria esse vínculo.
create table public.consultas_area_autores (
  chave text not null references public.consultas_area_geom(chave) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  primary key(chave,user_id)
);
alter table public.consultas_area_autores enable row level security;
revoke all on public.consultas_area_autores from public, anon, authenticated, service_role;
insert into public.consultas_area_autores select chave,user_id from public.consultas_area_geom where user_id is not null;

create function public.fn_registrar_area_propria(p_chave text, p_geojson jsonb, p_user uuid, p_buffer_m numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare resultado jsonb;
begin
  if p_user is null then raise exception 'Informe o titular' using errcode = '22023'; end if;
  resultado := public.fn_area_consulta_registrar(p_chave,p_geojson,p_user,p_buffer_m);
  if (resultado->>'valida')::boolean then
    insert into public.consultas_area_autores values (p_chave,p_user) on conflict do nothing;
  end if;
  return resultado;
end; $$;
create function public.fn_ler_area_propria(p_chave text, p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.fn_area_consulta(a.chave) from public.consultas_area_autores a
  where a.chave = p_chave and a.user_id = p_user;
$$;
revoke all on function public.fn_registrar_area_propria(text,jsonb,uuid,numeric), public.fn_ler_area_propria(text,uuid) from public, anon, authenticated;
grant execute on function public.fn_registrar_area_propria(text,jsonb,uuid,numeric), public.fn_ler_area_propria(text,uuid) to service_role;
