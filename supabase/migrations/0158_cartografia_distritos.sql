-- 0158: planta urbana por DISTRITO (áudios do Carlos, 18/11/2026 11h45–11h48).
--
-- O Carlos georreferenciou as plantas dos distritos (ex.: Carneirinho tem 6,
-- como Fátima) e nenhuma subia. Causa: fn_publicar_dxf (0082) tratava UMA
-- planta vetorial por município. Com a planta da sede já calibrada, o envio
-- do distrito era recusado ("O município já tem uma planta com lotes…"); sem
-- calibração, o distrito teria APAGADO a planta da sede.
--
-- Agora a camada tem `distrito` ('' = sede). A troca e a trava valem para o
-- par município + distrito: cada distrito tem a sua planta, a sede continua
-- intacta. Idempotente.

alter table public.cartography_layers add column if not exists distrito text not null default '';
create index if not exists idx_cartography_layers_mun_distrito
  on public.cartography_layers (municipality_id, distrito) where tipo = 'vector';

-- a assinatura antiga (8 argumentos) sai: com o argumento novo opcional, as
-- duas versões ficariam ambíguas para o PostgREST
drop function if exists public.fn_publicar_dxf(uuid, uuid, text, text, text, bigint, jsonb, jsonb);

create or replace function public.fn_publicar_dxf(p_layer_id uuid, p_municipio uuid, p_nome text, p_original text,
  p_publico text, p_bytes bigint, p_centro jsonb, p_diagnostico jsonb, p_distrito text default '')
returns uuid language plpgsql set search_path = '' as $$
declare
  d text := left(btrim(regexp_replace(coalesce(p_distrito, ''), '\s+', ' ', 'g')), 80);
begin
  perform 1 from public.municipalities where id = p_municipio for update;
  if not found then raise foreign_key_violation; end if;
  -- A FK dos lotes e das exclusões usa ON DELETE CASCADE. Trave as camadas
  -- do mesmo município e distrito antes da verificação.
  perform 1 from public.cartography_layers
    where municipality_id = p_municipio and tipo = 'vector' and lower(distrito) = lower(d) order by id for update;
  if exists (select 1 from public.cartography_layers c
             where c.municipality_id = p_municipio and c.tipo = 'vector' and lower(c.distrito) = lower(d) and (
    exists (select 1 from public.urban_lots l where l.layer_id = c.id) or
    exists (select 1 from public.cartografia_lotes_excluidos e where e.layer_id = c.id) or
    c.source_path is null or c.source_path not like 'cartografia/vetor/%' or
    c.edicoes_geometria <> '[]'::jsonb or c.ajustes_locais <> '[]'::jsonb or
    cardinality(c.linhas_excluidas) > 0 or cardinality(c.layers_ocultos) > 0 or
    (c.pontos_controle is not null and c.pontos_controle <> '[]'::jsonb) or
    c.offset_leste_m <> 0 or c.offset_norte_m <> 0 or c.escala <> 1 or c.rotacao_graus <> 0 or
    c.datum <> 'sirgas' or c.espessura_linha <> 1 or c.opacidade_padrao <> 0.85 or c.min_zoom <> 12 or c.max_zoom <> 19
  )) then raise object_not_in_prerequisite_state; end if;
  insert into public.cartography_layers(id, municipality_id, distrito, nome, tipo, source_path, tiles_path, status, min_zoom, max_zoom,
      opacidade_padrao, bytes, diagnostico, publico_path, publico_bytes, publico_centro)
    values (p_layer_id, p_municipio, d, p_nome, 'vector', p_original, p_original, 'pronto', 12, 19, 0.85, p_bytes,
      p_diagnostico, p_publico, p_bytes, p_centro);
  insert into public.jobs(tipo, payload) values ('gerar_lotes', jsonb_build_object('layer_id', p_layer_id));
  delete from public.cartography_layers
    where municipality_id = p_municipio and tipo = 'vector' and lower(distrito) = lower(d) and id <> p_layer_id;
  return p_layer_id;
end $$;
revoke all on function public.fn_publicar_dxf(uuid, uuid, text, text, text, bigint, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_publicar_dxf(uuid, uuid, text, text, text, bigint, jsonb, jsonb, text) to service_role;
