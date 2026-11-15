-- As plantas podem identificar o mesmo lote por "01" ou "1", com letras e espaços.
create index urban_lots_quadra_rotulo_idx
  on public.urban_lots (public.fn_rotulo_lote(quadra), public.fn_rotulo_lote(numero))
  where quadra is not null;
create index urban_lots_numero_rotulo_idx
  on public.urban_lots (public.fn_rotulo_lote(numero))
  where numero is not null;

create or replace function public.buscar_referencia_urbana(p_busca text, p_lng float8, p_lat float8)
returns table(nome text, contexto text, fonte text, lng float8, lat float8)
language sql stable set search_path = public as $$
  with entrada as (
    select lower(trim(p_busca)) texto, plainto_tsquery('simple', p_busca) ts
  ), componentes as (
    select regexp_match(texto, '^quadra\s+(.+?)[\s,;/-]+lote\s+(.+)$') par,
      substring(texto from '^quadra\s+(.+)$') quadra_avulsa,
      substring(texto from '^lote\s+(.+)$') lote_avulso,
      regexp_replace(texto, '^lote\s+', '') identificador
    from entrada
  ), chaves as (
    select fn_rotulo_lote(coalesce(par[1], quadra_avulsa)) quadra,
      fn_rotulo_lote(coalesce(par[2], lote_avulso)) lote,
      case when identificador ~ '^[a-f0-9]{8}$'
             then (identificador || '-0000-0000-0000-000000000000')::uuid
           when identificador ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
             then identificador::uuid end id_inicio,
      case when identificador ~ '^[a-f0-9]{8}$'
             then (identificador || '-ffff-ffff-ffff-ffffffffffff')::uuid
           when identificador ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
             then identificador::uuid end id_fim
    from componentes
  ), lotes_encontrados as (
    -- Comparar como UUID deixa o prefixo curto e o ID completo usarem a chave primária.
    select u.id from urban_lots u, chaves k where u.id between k.id_inicio and k.id_fim
    union
    select u.id from urban_lots u, chaves k
    where u.quadra is not null and fn_rotulo_lote(u.quadra) = k.quadra
      and (k.lote is null or fn_rotulo_lote(u.numero) = k.lote)
    union
    select u.id from urban_lots u, chaves k
    where k.quadra is null and u.numero is not null and fn_rotulo_lote(u.numero) = k.lote
  ), opcoes as (
    select r.nome, concat_ws(' · ', nullif(r.contexto, ''), m.nome || '/' || m.uf) contexto,
      'IBGE · CNEFE 2022' fonte, r.lng, r.lat, ts_rank(r.busca, e.ts) peso
    from referencias_urbanas r join municipalities m on m.codigo_ibge = r.municipio cross join entrada e
    where r.busca @@ e.ts
    union all
    select concat_ws(' · ', case when u.quadra is not null then 'Quadra ' || u.quadra end,
        'Lote ' || coalesce(u.numero, left(u.id::text, 8))),
      m.nome || '/' || m.uf, 'Planta ARINI', st_x(pt), st_y(pt), 1::real
    from lotes_encontrados l join urban_lots u on u.id = l.id
    join cartography_layers c on c.id = u.layer_id join municipalities m on m.id = u.municipality_id
    cross join lateral (select st_pointonsurface(u.geom) pt) centro
    where c.status = 'pronto' and c.publico_path is not null
  )
  select nome, contexto, fonte, lng, lat from opcoes
  order by (lng - p_lng)^2 + (lat - p_lat)^2, peso desc, nome, contexto limit 12;
$$;
