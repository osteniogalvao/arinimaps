-- Arini Imóveis Brasil — migration 0064: sede municipal = cidade, não o meio do polígono.
--
-- A 0007 gravava `sede` como st_centroid(geom). Em município grande o centroide
-- cai no meio da zona rural: Iturama ficava ~15 km a oeste da cidade, Campina
-- Verde ~35 km e São Francisco de Sales ~11 km. A home usa a sede para o
-- satélite "cartografia urbana" e para o link /mapa#pos=..., o tour 3D marca a
-- sede, a avaliação mede "distância à sede municipal" e o POI "Centro de X" sai
-- dela. Todos esses usos querem a cidade, então a coluna é corrigida no lugar
-- (não há uso que dependa do centroide; quem precisar dele tem st_centroid(geom)).
--
-- Fonte: IBGE, Base Cartográfica Contínua 1:250.000 (BC250, edição 2021),
-- camada "Cidade" (sedes municipais), WFS geoservicos.ibge.gov.br, camada
-- CGMAT:pbqg22_00_Bc250_2021Cidade, consultada em 09/11/2026. SIRGAS 2000
-- (EPSG:4674), que coincide com WGS 84 na escala do mapa.
--
-- Só atualiza; idempotente. Município que não estiver na lista fica como está.

with sedes(codigo_ibge, lng, lat) as (
  values
    ('3111101', -49.486, -19.536),  -- Campina Verde
    ('3114550', -50.688, -19.698),  -- Carneirinho
    ('3134400', -50.196, -19.728),  -- Iturama
    ('3138625', -50.581, -19.551),  -- Limeira do Oeste
    ('3161304', -49.774, -19.863),  -- São Francisco de Sales
    ('3170438', -50.336, -19.530)   -- União de Minas
)
update municipalities m
set sede = st_setsrid(st_makepoint(s.lng, s.lat), 4326)
from sedes s
where m.codigo_ibge = s.codigo_ibge;

-- O POI "Centro de X" (fonte ibge, osm_id = código IBGE) foi semeado a partir
-- da sede antiga: acompanha a correção.
update pois p
set geom = m.sede
from municipalities m
where p.fonte = 'ibge'
  and p.categoria = 'centro'
  and p.osm_id = m.codigo_ibge
  and m.sede is not null;

-- As distâncias já gravadas (property_pois, inclusive ao "Centro de X") foram
-- medidas da sede antiga. Enfileira o recálculo dos imóveis desses 6
-- municípios no mesmo job da atualização periódica (`refresh_pois`, worker
-- jobs/fetchPois.mjs, que termina em fn_vincular_pois). Não duplica: quem já
-- tem job de POI pendente ou em andamento fica de fora.
insert into jobs (tipo, payload)
select 'refresh_pois', jsonb_build_object('property_id', p.id, 'motivo', 'sede_municipal_0064')
from properties p
join municipalities m on m.id = p.municipality_id
where m.codigo_ibge in ('3111101', '3114550', '3134400', '3138625', '3161304', '3170438')
  and exists (select 1 from property_geometries g where g.property_id = p.id)
  and not exists (
    select 1 from jobs j
    where j.tipo in ('refresh_pois', 'fetch_pois') and j.status in ('pendente', 'processando')
      and j.payload->>'property_id' = p.id::text
  );

comment on column municipalities.sede is
  'Sede urbana do município (ponto da cidade, IBGE BC250 "Cidade"). Não é o centroide do polígono.';

notify pgrst, 'reload schema';
