-- Pontos de referência agregados do CNEFE. A aplicação não armazena os registros de domicílios.
create table public.referencias_urbanas (
  municipio text not null references public.municipalities(codigo_ibge),
  tipo text not null check(tipo in ('Logradouro','Localidade','Quadra censitária','Quadra','Lote')),
  nome text not null,
  contexto text not null,
  busca tsvector not null,
  lng double precision not null check(lng between -180 and 180),
  lat double precision not null check(lat between -90 and 90),
  primary key(municipio,tipo,nome,contexto)
);
create index referencias_urbanas_busca on public.referencias_urbanas using gin(busca);
alter table public.referencias_urbanas enable row level security;
revoke all on public.referencias_urbanas from anon,authenticated;
grant select on public.referencias_urbanas to service_role;

create function public.buscar_referencia_urbana(p_busca text,p_lng float8,p_lat float8)
returns table(nome text,contexto text,fonte text,lng float8,lat float8) language sql stable
set search_path=public as $$
  with consulta as (select plainto_tsquery('simple',p_busca) q),
  opcoes as (
    select r.nome, concat_ws(' · ',nullif(r.contexto,''),m.nome || '/' || m.uf) contexto,
      'IBGE · CNEFE 2022' fonte,r.lng,r.lat,ts_rank(r.busca,q) peso
    from referencias_urbanas r join municipalities m on m.codigo_ibge=r.municipio cross join consulta
    where r.busca @@ q
    union all
    select concat_ws(' · ',case when u.quadra is not null then 'Quadra '||u.quadra end,
        'Lote '||coalesce(u.numero,left(u.id::text,8))),
      m.nome||'/'||m.uf,'Planta ARINI',st_x(pt),st_y(pt),1::real
    from urban_lots u join cartography_layers c on u.layer_id=c.id join municipalities m on m.id=u.municipality_id
    cross join lateral (select st_pointonsurface(u.geom) pt) centro
    where c.status='pronto' and c.publico_path is not null and (
      lower(p_busca)='lote '||left(u.id::text,8) or lower(p_busca)='lote '||u.id::text or
      lower(p_busca)='lote '||lower(u.numero) or lower(p_busca)='quadra '||lower(u.quadra) or
      lower(p_busca)='quadra '||lower(u.quadra)||' lote '||lower(u.numero))
  )
  select nome,contexto,fonte,lng,lat from opcoes
  order by (lng-p_lng)^2+(lat-p_lat)^2,peso desc,nome,contexto limit 12;
$$;
revoke all on function public.buscar_referencia_urbana(text,float8,float8) from public,anon,authenticated;
grant execute on function public.buscar_referencia_urbana(text,float8,float8) to service_role;
