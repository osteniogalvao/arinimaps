-- A âncora usa coordenadas do desenho original e acompanha a calibração.
create table if not exists cartografia_lotes_excluidos (
  lote_id uuid primary key,
  layer_id uuid not null references cartography_layers(id) on delete cascade,
  lng double precision not null check (lng between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  area_m2 numeric not null,
  autor uuid references profiles(user_id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_lotes_excluidos_layer on cartografia_lotes_excluidos(layer_id);
alter table cartografia_lotes_excluidos enable row level security;
revoke all on cartografia_lotes_excluidos from public, anon, authenticated;

create or replace function fn_lote_calibracao(p_layer uuid, p_lon float8, p_lat float8)
returns json language sql stable set search_path=public as $$
  select fn_lote(u.id) from urban_lots u where layer_id=p_layer
    and st_covers(geom,st_setsrid(st_makepoint(p_lon,p_lat),4326))
    order by area_m2, id limit 1
$$;
create or replace function fn_excluir_lote_calibracao(p_layer uuid,p_lote uuid,p_lon float8,p_lat float8,p_autor uuid,p_versao timestamptz)
returns text language plpgsql set search_path=public as $$
declare l urban_lots%rowtype; versao timestamptz;
begin
  select lotes_gerados_em into versao from cartography_layers where id=p_layer for update;
  if exists(select 1 from cartografia_lotes_excluidos where lote_id=p_lote and layer_id=p_layer) then return 'ok'; end if;
  if versao is distinct from p_versao then return 'desatualizado'; end if;
  select * into l from urban_lots where id=p_lote and layer_id=p_layer for update;
  if not found then return 'desatualizado'; end if;
  if exists(select 1 from properties where lote_id=p_lote) then return 'vinculado'; end if;
  insert into cartografia_lotes_excluidos(lote_id,layer_id,lng,lat,area_m2,autor)
    values (l.id,p_layer,p_lon,p_lat,l.area_m2,p_autor);
  delete from urban_lots where id=l.id;
  update cartography_layers set lotes_total=greatest(lotes_total-1,0), lotes_gerados_em=now() where id=p_layer;
  insert into audit_log(acao,entidade,entidade_id,user_id,dados_antes)
    values('lote_excluido','urban_lots',l.id,p_autor,jsonb_build_object('layer_id',p_layer,'numero',l.numero,'quadra',l.quadra,'area_m2',l.area_m2));
  return 'ok';
end $$;
revoke all on function fn_lote_calibracao(uuid,float8,float8), fn_excluir_lote_calibracao(uuid,uuid,float8,float8,uuid,timestamptz) from public,anon,authenticated;
grant execute on function fn_lote_calibracao(uuid,float8,float8), fn_excluir_lote_calibracao(uuid,uuid,float8,float8,uuid,timestamptz) to service_role;
