-- Consulta territorial: GEOS usa a divisa real e o buffer geodésico solicitado.
-- O envelope continua disponível para seleção inicial de feições nas fontes.
create or replace function public.fn_recorte_consulta(p_geom geometry, p_buffer_m numeric)
returns jsonb language sql immutable strict set search_path = public as $$
  with recorte as (
    select case when p_buffer_m > 0 then st_buffer(p_geom::geography, p_buffer_m)::geometry
                else p_geom end as g
  )
  select jsonb_build_object(
    'xmin', st_xmin(g), 'ymin', st_ymin(g), 'xmax', st_xmax(g), 'ymax', st_ymax(g),
    'lng', (st_xmin(g) + st_xmax(g)) / 2, 'lat', (st_ymin(g) + st_ymax(g)) / 2,
    'geometria', st_asgeojson(g, 15)::jsonb
  ) from recorte where not st_isempty(g)
$$;
revoke all on function public.fn_recorte_consulta(geometry,numeric) from public, anon, authenticated;

create or replace function public.fn_property_bbox(p_property_id uuid, p_buffer_m numeric default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select fn_recorte_consulta(geom,p_buffer_m) from property_geometries where property_id=p_property_id
$$;
create or replace function public.fn_car_bbox_imovel(p_cod text, p_buffer_m numeric default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select fn_recorte_consulta(geom,p_buffer_m) from car_imoveis where cod_imovel=p_cod
$$;
create or replace function public.fn_lote_bbox(p_id uuid, p_buffer_m numeric default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select fn_recorte_consulta(geom,p_buffer_m) from urban_lots where id=p_id
$$;

create or replace function public.fn_area_consulta_registrar(p_chave text, p_geojson jsonb, p_user uuid, p_buffer_m numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g geometry;
  area numeric;
begin
  g := st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson(p_geojson::text),4326)),3));
  if g is null or st_isempty(g) then
    return jsonb_build_object('valida',false,'motivo','A área desenhada não forma um polígono.');
  end if;
  area := st_area(g::geography) / 10000;
  insert into consultas_area_geom(chave,geom,area_ha,user_id) values (p_chave,g,area,p_user)
    on conflict (chave) do nothing;
  return jsonb_build_object('valida',true,'area_ha',round(area,4),'bbox',fn_recorte_consulta(g,p_buffer_m));
end
$$;

-- Os temas do piloto têm milhões de vértices. Os retângulos pequenos permitem
-- descobrir as feições inteiras sem descompactar cada polígono do SICAR.
create table public.car_temas_limites (
  tema_id bigint primary key references public.car_temas(id) on delete cascade,
  limite geometry(Polygon,4326) not null,
  tema text not null,
  cod_imovel text,
  area_ha numeric
);
alter table public.car_temas_limites enable row level security;
revoke all on table public.car_temas_limites from public, anon, authenticated;
create function public.fn_car_tema_atualizar_limite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.vigente then
    insert into car_temas_limites(tema_id,limite,tema,cod_imovel,area_ha)
      values (new.id,st_envelope(new.geom),new.tema,new.cod_imovel,new.area_ha)
      on conflict (tema_id) do update set limite=excluded.limite,tema=excluded.tema,
                                           cod_imovel=excluded.cod_imovel,area_ha=excluded.area_ha;
  else
    delete from car_temas_limites where tema_id=new.id;
  end if;
  return new;
end
$$;
revoke all on function public.fn_car_tema_atualizar_limite() from public, anon, authenticated;
create trigger car_tema_atualizar_limite after insert or update of geom,tema,cod_imovel,area_ha,vigente on public.car_temas
  for each row execute function public.fn_car_tema_atualizar_limite();
insert into public.car_temas_limites(tema_id,limite,tema,cod_imovel,area_ha)
  select id,st_envelope(geom),tema,cod_imovel,area_ha from public.car_temas where vigente on conflict do nothing;
create index car_temas_limites_geom on public.car_temas_limites using gist(limite);
analyze public.car_temas_limites;

-- Apenas as feições que atravessam a borda precisam da operação cara de recorte.
-- Para as internas, a importação já calculou a área geodésica (0050).
create function public.fn_car_ambiental_recorte(p_area geometry)
returns jsonb language sql stable strict set search_path = public as $$
  with cob as materialized (
    select c.municipio,c.uf,c.data_base,c.temas,
           case when st_covers(c.limite,p_area) then p_area
                else st_intersection(c.limite,p_area) end as recorte
    from car_cobertura c
    where c.limite && p_area and st_intersects(c.limite,p_area)
  ), candidatos as materialized (
    select l.tema_id as id,l.tema,l.cod_imovel,l.area_ha,st_covers(p_area,l.limite) as inteiro
    from car_temas_limites l where st_intersects(l.limite,p_area)
  ), areas as (
    select tema,cod_imovel,area_ha from candidatos where inteiro and area_ha is not null
    union all
    select c.tema,c.cod_imovel,
      case
        when c.inteiro or st_coveredby(ct.geom,p_area) then coalesce(ct.area_ha,st_area(ct.geom::geography)/10000)
        else st_area(st_collectionextract(st_intersection(ct.geom,p_area),3)::geography)/10000
      end as area_ha
    from candidatos c join car_temas ct on ct.id=c.id
    where (not c.inteiro or c.area_ha is null) and st_intersects(ct.geom,p_area)
  ), temas as (
    select tema,count(*) as poligonos,count(distinct cod_imovel) as imoveis,
           round(sum(area_ha)::numeric,2) as area_ha
    from areas group by tema
  )
  select jsonb_build_object(
    'cobertura_pct',(select round(least(100,coalesce(100*st_area(st_collectionextract(st_union(recorte),3)::geography)
                           / nullif(st_area(p_area::geography),0),0))::numeric,1) from cob),
    'municipios',(select coalesce(jsonb_agg(jsonb_build_object('municipio',municipio,'uf',uf,
                   'data_base',data_base,'temas',temas) order by municipio),'[]'::jsonb) from cob),
    'temas',(select coalesce(jsonb_agg(to_jsonb(temas) order by tema),'[]'::jsonb) from temas)
  )
$$;
revoke all on function public.fn_car_ambiental_recorte(geometry) from public, anon, authenticated;

create function public.fn_car_ambiental_geometria(p_geojson jsonb)
returns jsonb language sql stable strict security definer set search_path = public as $$
  select fn_car_ambiental_recorte(st_setsrid(st_geomfromgeojson(p_geojson),4326))
$$;
revoke all on function public.fn_car_ambiental_geometria(jsonb) from public, anon, authenticated;
grant execute on function public.fn_car_ambiental_geometria(jsonb) to service_role;

create or replace function public.fn_car_ambiental_envelope(p_xmin float8,p_ymin float8,p_xmax float8,p_ymax float8)
returns jsonb language sql stable security definer set search_path = public as $$
  select fn_car_ambiental_recorte(st_makeenvelope(p_xmin,p_ymin,p_xmax,p_ymax,4326))
$$;

-- Os resultados antigos não permitem distinguir feições incidentes das vizinhas.
-- São caches recalculáveis. O histórico de auditoria de quem consultou é preservado.
delete from public.consultas_area where fonte_id in ('anm','car_ambiental');
delete from public.consultas_rurais where fonte_id in ('anm','car_ambiental');

-- Impede que uma instância antiga em rotação volte a servir uma incidência pelo envelope.
alter table public.consultas_area add constraint consultas_area_recorte_exato
  check (fonte_id not in ('anm','car_ambiental') or erro is not null or coalesce(resultado->>'recorte','')='geometria');
alter table public.consultas_rurais add constraint consultas_rurais_recorte_exato
  check (fonte_id not in ('anm','car_ambiental') or erro is not null or coalesce(resultado->>'recorte','')='geometria');
