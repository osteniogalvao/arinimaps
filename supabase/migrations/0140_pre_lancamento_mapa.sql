-- A geometria do empreendimento e de cada unidade fica fora do mapa geral
-- durante o pré-lançamento. O espelho do empreendimento tem consulta própria.
create or replace function public.fn_properties_geojson()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'type','FeatureCollection',
    'features',coalesce(jsonb_agg(jsonb_build_object(
      'type','Feature',
      'geometry',st_asgeojson(g.geom,6)::jsonb,
      'properties',jsonb_build_object(
        'id',p.id,'codigo',p.codigo,'titulo',p.titulo,'tipo',p.tipo,
        'status',p.status,'valor',p.valor,'modalidade',p.modalidade,
        'cor',case when p.modalidade='leilao' and p.status='publicado' then 'leilao' else p.status::text end,
        'area_m2',g.area_m2,'lng',st_x(g.centroid),'lat',st_y(g.centroid),
        'municipio',(select m.nome from municipalities m where m.id=p.municipality_id),
        'capa',(select md.storage_path from property_media md where md.property_id=p.id and md.tipo='foto'
                order by md.capa desc, md.ordem limit 1)
      )
    )), '[]'::jsonb)
  )
  from properties p join property_geometries g on g.property_id=p.id
  where p.status in ('publicado','em_negociacao')
    and not exists (
      select from espelho_config cfg
      where cfg.empreendimento_id=coalesce(p.parent_property_id,p.id) and cfg.pre_lancamento
    )
$$;
