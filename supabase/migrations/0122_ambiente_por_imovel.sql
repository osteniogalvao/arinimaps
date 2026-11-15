-- Dados de referência da FBDS em WGS84. A versão corresponde à carga municipal indicada.
create table public.nascentes_fbds (
  ibge integer not null,
  geom geometry(Point,4326) not null,
  fonte text not null,
  importado_em date not null default current_date,
  primary key (ibge, geom)
);
create index nascentes_fbds_geom on public.nascentes_fbds using gist(geom);
alter table public.nascentes_fbds enable row level security;
revoke all on public.nascentes_fbds from public, anon, authenticated;

-- Os pacotes municipais do SICAR também contêm feições sem código do imóvel.
-- Nesse caso, só representamos o trecho que efetivamente intersecta o perímetro.
create function public.fn_ambiente_por_car(p_cod text)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  with im as (
    select geom, cod_ibge, cod_imovel from car_imoveis where cod_imovel=p_cod
  ), recortes as (
    select ct.tema, i.data_base, st_collectionextract(st_intersection(ct.geom,im.geom),3) as recorte
    from im join car_temas ct on ct.vigente and ct.geom && im.geom
      and (ct.cod_imovel=im.cod_imovel or nullif(ct.cod_imovel,'') is null)
      and ct.tema<>'area_imovel' and st_intersects(ct.geom,im.geom)
    join car_importacoes i on i.id=ct.importacao_id
  ), feicoes as (
    select tema, 'SICAR' as fonte, data_base as data, st_simplifypreservetopology(recorte,0.000006) as geom
      from recortes where not st_isempty(recorte)
    union all
    select 'nascente', 'FBDS', n.importado_em, n.geom from im
      join nascentes_fbds n on n.geom && im.geom and st_covers(im.geom,n.geom)
    union all select 'area_imovel','SICAR',null,st_simplifypreservetopology(geom,0.000006) from im
  )
  select jsonb_build_object('type','FeatureCollection','features',coalesce(jsonb_agg(jsonb_build_object(
    'type','Feature','geometry',st_asgeojson(geom,7)::jsonb,
    'properties',jsonb_build_object('tema',tema,'fonte',fonte,'data',data)
  ) order by tema),'[]'::jsonb)) from feicoes
$$;
revoke all on function public.fn_ambiente_por_car(text) from public,anon,authenticated;
grant execute on function public.fn_ambiente_por_car(text) to service_role;
