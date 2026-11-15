-- A Matriz delimita a planta que prevalece sobre a representação rural.
-- As geometrias oficiais e os dados de consulta dos imóveis são preservados.
create table if not exists public.cartografia_recortes_urbanos (
  id uuid primary key default gen_random_uuid(),
  camada_id uuid not null references public.cartography_layers(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 100),
  geom geometry(Polygon, 4326) not null,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  check (not st_isempty(geom) and st_isvalid(geom) and st_npoints(geom) between 4 and 301),
  check (st_coveredby(geom, st_makeenvelope(-180,-85.051129,180,85.051129,4326)))
);
create index if not exists cartografia_recortes_geom on public.cartografia_recortes_urbanos using gist (geom);
create index if not exists cartografia_recortes_camada on public.cartografia_recortes_urbanos(camada_id);
alter table public.cartografia_recortes_urbanos enable row level security;
revoke all on public.cartografia_recortes_urbanos from public, anon, authenticated;
grant select, insert, delete on public.cartografia_recortes_urbanos to service_role;

create or replace view public.cartografia_recortes_publicados with (security_invoker = true) as
select r.id, r.camada_id, r.nome, r.geom
from public.cartografia_recortes_urbanos r
join public.cartography_layers c on c.id = r.camada_id
where c.status = 'pronto' and c.tiles_path is not null and (c.tipo = 'raster' or c.publico_path is not null);
revoke all on public.cartografia_recortes_publicados from public, anon, authenticated;
grant select on public.cartografia_recortes_publicados to service_role;

create or replace function public.fn_recortes_urbanos() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'camada',camada_id,'nome',nome,
    'geometry',st_asgeojson(geom)::jsonb,'bbox',jsonb_build_array(st_xmin(geom),st_ymin(geom),st_xmax(geom),st_ymax(geom))) order by id), '[]'::jsonb)
  from public.cartografia_recortes_publicados;
$$;
revoke all on function public.fn_recortes_urbanos() from public, anon, authenticated;
grant execute on function public.fn_recortes_urbanos() to service_role;

create or replace function public.fn_mvt_car(z integer, x integer, y integer) returns bytea
language plpgsql stable security definer set search_path = public as $$
declare
  env geometry := st_tileenvelope(z,x,y);
  mascara geometry;
  mvt bytea;
  area_min numeric := case when z <= 8 then 200 when z = 9 then 100 when z = 10 then 10 else 0 end;
  tol double precision := (st_xmax(env)-st_xmin(env))/4096*2;
begin
  if z < 7 then return null; end if;
  select st_union(st_transform(r.geom,3857)) into mascara
  from cartografia_recortes_publicados r where r.geom && st_transform(st_expand(env,tol*32),4326);
  select st_asmvt(q,'car',4096,'geom') into mvt from (
    select c.cod_imovel as cod, round(c.area_ha::numeric,2) as area_ha, c.condicao,
      c.status, c.tipo_imovel as tipo, c.municipio,
      st_asmvtgeom(case when mascara is not null and c.geom_3857 && mascara then
        st_collectionextract(st_difference(st_makevalid(st_simplify(c.geom_3857,tol,true)),mascara),3)
        else st_simplify(c.geom_3857,tol,true) end,env,4096,64,true) as geom
    from car_imoveis c where c.geom_3857 && env and coalesce(c.area_ha,0)>=area_min
  ) q where q.geom is not null;
  return mvt;
end $$;
