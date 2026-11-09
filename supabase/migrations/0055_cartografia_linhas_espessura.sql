-- Arini Imóveis Brasil — migration 0055: apagar linhas e mudar a espessura da planta.
--
-- Pedido do Carlos (áudio de 05/11/2026), na Central › Cartografia › Calibrar:
-- "onde eu posso excluir alguma coisa, eu posso mudar, aumentar as linhas".
--
--  · linhas_excluidas — linhas soltas da planta que o operador apagou, pela
--    posição no GeoJSON ORIGINAL ("i" = objeto inteiro, "i:j" = a linha j da
--    MultiLineString i; ver src/lib/geo/deslocar.ts). O arquivo original não é
--    tocado: o arquivo público (publico_path) e os lotes clicáveis são refeitos
--    sem essas linhas, e a lista pode ser desfeita a qualquer momento.
--  · espessura_linha — multiplicador da espessura com que o mapa público
--    desenha a planta (1 = como antes; 0,25 a 5).
--
-- Aditiva e com padrão: o código antigo continua funcionando com ela aplicada.
-- APLICAR ANTES do deploy do código novo (a rota /api/geo/cartografia lê as
-- duas colunas): node scripts/migrate.mjs

alter table cartography_layers
  add column if not exists linhas_excluidas text[] not null default '{}',
  add column if not exists espessura_linha numeric(4,2) not null default 1;

alter table cartography_layers drop constraint if exists chk_cartography_espessura;
alter table cartography_layers add constraint chk_cartography_espessura
  check (espessura_linha between 0.25 and 5);
