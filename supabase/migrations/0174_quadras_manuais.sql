-- Arini Maps — migration 0174: número da quadra posto à mão na calibração.
--
-- Áudio do Carlos (26/11/2026, 21h58): "tem muitas quadras que não aparecem o
-- nome... algumas têm e outras não... a gente conseguiria editar e colocar
-- manualmente, quadra 1, 2, 5, 10". O operador clica dentro de uma quadra e
-- digita o número; todos os lotes daquela quadra (lotes encostados uns nos
-- outros, até a rua) recebem o número.
--
-- Como na exclusão de lote (0070), a âncora fica nas coordenadas do desenho
-- ORIGINAL e acompanha a calibração: quando a fila gera os lotes de novo
-- (worker/jobs/gerarLotes.mjs), o número é reaplicado a partir da âncora.
--
-- Idempotente: pode rodar de novo sem efeito colateral.

create table if not exists cartografia_quadras_manuais (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid not null references cartography_layers(id) on delete cascade,
  quadra text not null check (length(btrim(quadra)) between 1 and 20),
  lng double precision not null check (lng between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  autor uuid references profiles(user_id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_quadras_manuais_layer on cartografia_quadras_manuais(layer_id);
alter table cartografia_quadras_manuais enable row level security;
revoke all on cartografia_quadras_manuais from public, anon, authenticated;

-- Os lotes da quadra que contém o ponto (coordenadas já calibradas): o lote do
-- clique e, por contágio, todos os que encostam (até 1,5 m), parando na rua.
-- Limite de 800 lotes para um clique numa gleba enorme não varrer a cidade.
create or replace function fn_lotes_da_quadra(p_layer uuid, p_lon float8, p_lat float8)
returns setof uuid language plpgsql stable set search_path=public as $$
declare achados uuid[]; novos uuid[];
begin
  select array_agg(id) into achados from (
    select u.id from urban_lots u
    where u.layer_id = p_layer and st_covers(u.geom, st_setsrid(st_makepoint(p_lon, p_lat), 4326))
    order by u.area_m2, u.id limit 1) t;
  novos := achados;
  while coalesce(array_length(novos, 1), 0) > 0 and array_length(achados, 1) < 800 loop
    select array_agg(distinct v.id) into novos
      from urban_lots a join urban_lots v on v.layer_id = p_layer
        and v.geom_3857 && st_expand(a.geom_3857, 1.5) and st_dwithin(v.geom_3857, a.geom_3857, 1.5)
      where a.id = any(novos) and not v.id = any(achados);
    achados := achados || coalesce(novos, '{}');
  end loop;
  return query select unnest(achados[1:800]);
end $$;

-- Grava o número nos lotes da quadra e, se pedido, guarda a âncora. Devolve
-- quantos lotes mudaram. Imóvel já ligado ao lote e sem quadra informada
-- passa a mostrar o número também.
create or replace function fn_numerar_quadra(p_layer uuid, p_lon float8, p_lat float8, p_quadra text,
  p_ancora_lng float8 default null, p_ancora_lat float8 default null, p_autor uuid default null)
returns integer language plpgsql set search_path=public as $$
declare n integer; q text := nullif(btrim(p_quadra), '');
begin
  if q is null or length(q) > 20 then raise exception 'quadra_invalida'; end if;
  update urban_lots set quadra = q where id in (select fn_lotes_da_quadra(p_layer, p_lon, p_lat));
  get diagnostics n = row_count;
  if n > 0 then
    update properties set lote_quadra = q
      where lote_id in (select id from urban_lots where layer_id = p_layer and quadra = q)
        and (lote_quadra is null or btrim(lote_quadra) = '');
  end if;
  if n > 0 and p_ancora_lng is not null and p_ancora_lat is not null then
    -- clicar de novo na mesma quadra só soma outra âncora: a fila reaplica
    -- na ordem de criação, e a última palavra vale
    insert into cartografia_quadras_manuais(layer_id, quadra, lng, lat, autor)
      values (p_layer, q, p_ancora_lng, p_ancora_lat, p_autor);
    insert into audit_log(acao, entidade, entidade_id, user_id, dados_depois)
      values ('quadra_numerada', 'cartography_layers', p_layer, p_autor, jsonb_build_object('quadra', q, 'lotes', n));
  end if;
  return n;
end $$;

revoke all on function fn_lotes_da_quadra(uuid,float8,float8), fn_numerar_quadra(uuid,float8,float8,text,float8,float8,uuid) from public, anon, authenticated;
grant execute on function fn_lotes_da_quadra(uuid,float8,float8), fn_numerar_quadra(uuid,float8,float8,text,float8,float8,uuid) to service_role;
