-- Correções manuais de linhas/vértices da planta sem regravar o GeoJSON inteiro.
-- Cada item identifica uma feature e, no caso de MultiLineString, a linha
-- interna: { feature, linha, coordinates: [[lng,lat], ...] }.
alter table cartography_layers
  add column if not exists edicoes_geometria jsonb not null default '[]'::jsonb;

comment on column cartography_layers.edicoes_geometria is
  'Polilinhas do CAD corrigidas manualmente no editor cartográfico; aplicadas sobre tiles_path.';
