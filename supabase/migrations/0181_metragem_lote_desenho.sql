-- Arini Maps — migration 0181: metragem do lote igual à da planta oficial.
--
-- Áudio do Carlos (28/11/2026, 09h03): "os lotes são 12 de frente por 20...
-- 240 metros quadrados, oficialmente, legalmente", e o sistema mostrava 230
-- (e 30 a 40 m² a menos em outros). Duas causas:
--   1. Ao calibrar a planta sobre o satélite (escala ou peça encaixada), o
--      lote era medido na posição calibrada: escala de 97,9% tira 4% da área.
--      A planta do CAD já está em metros de verdade; a escala é só visual.
--      Agora a medida é sempre a do desenho original (esta função; a geração
--      de lotes no worker faz o mesmo).
--   2. A área escrita no desenho ("240,00 m²") passa a valer como a área do
--      lote quando ele a tem (coluna nova area_texto_m2, preenchida pela fila
--      a partir do DXF). Mover a planta não muda mais essa área.
--
-- Os lotes atuais só são medidos de novo quando a fila os gerar outra vez:
-- em Admin > Cartografia, "Ler quadra, lote e área do DXF" na planta faz isso.
--
-- Idempotente: pode rodar de novo sem efeito colateral.

alter table public.urban_lots add column if not exists area_texto_m2 numeric;
comment on column public.urban_lots.area_texto_m2 is
  'Área escrita no DXF dentro do lote (ex.: "240,00 m²"); quando existe, é a área do lote.';

-- Uma só transação para o editor, os lotes e os anúncios. A busca usa a posição
-- anterior de TODOS os lotes antes de gravar qualquer posição nova.
create or replace function public.fn_cartografia_salvar_partes(
  p_layer uuid, p_antes jsonb, p_depois jsonb, p_antigas jsonb, p_novas jsonb,
  p_global float8[], p_inv_global float8[], p_global_novo float8[], p_transform_antes jsonb, p_transform_depois jsonb,
  p_assinatura text, p_nova_assinatura text, p_autor uuid
) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare
  camada public.cartography_layers%rowtype;
  total integer := 0;
  transform_atual jsonb;
begin
  select * into strict camada from public.cartography_layers where id=p_layer for update;
  transform_atual := jsonb_build_object('offset_leste_m',coalesce(camada.offset_leste_m,0),'offset_norte_m',coalesce(camada.offset_norte_m,0),
    'rotacao_graus',coalesce(camada.rotacao_graus,0),'escala',coalesce(camada.escala,1));
  if camada.ajustes_locais is distinct from p_antes or camada.lotes_assinatura is distinct from p_assinatura or transform_atual <> p_transform_antes then
    if camada.ajustes_locais = p_depois and camada.lotes_assinatura is not distinct from p_nova_assinatura and transform_atual=p_transform_depois then return 0; end if;
    raise exception 'Outra calibração ou geração de lotes foi salva. Reabra a planta para continuar.';
  end if;

  if p_antigas is distinct from p_novas or p_global is distinct from p_global_novo then
    perform set_config('arini.calibrando_partes','sim',true);
    with antigas as materialized (
      select pos, area, m, inv, st_affine(area,m[1],m[2],m[3],m[4],m[5],m[6]) na_tela
      from (
        select pos, st_setsrid(st_geomfromgeojson(item->>'area'),4326) area,
          array(select jsonb_array_elements_text(item->'m')::float8) m,
          array(select jsonb_array_elements_text(item->'inv')::float8) inv
        from jsonb_array_elements(p_antigas) with ordinality as a(item,pos)
      ) x
    ), novas as materialized (
      select pos, st_setsrid(st_geomfromgeojson(item->>'area'),4326) area,
        array(select jsonb_array_elements_text(item->'m')::float8) m
      from jsonb_array_elements(p_novas) with ordinality as a(item,pos)
    ), originais as materialized (
      select l.id,l.geom,l.centro_calibracao,coalesce(a.m,p_global) anterior,coalesce(a.inv,p_inv_global) inversa
      from public.urban_lots l
      left join lateral (
        select m,inv from antigas where case when l.centro_calibracao is not null
          then st_covers(area,l.centro_calibracao) else st_covers(na_tela,st_pointonsurface(l.geom)) end
        order by pos limit 1
      ) a on true where l.layer_id=p_layer
    ), centros as materialized (
      select *,coalesce(centro_calibracao,st_affine(st_pointonsurface(geom),
        inversa[1],inversa[2],inversa[3],inversa[4],inversa[5],inversa[6])) cru
      from originais
    ), destinos as materialized (
      select c.*,coalesce(n.m,p_global_novo) alvo from centros c
      left join lateral (select m from novas where st_covers(area,c.cru) order by pos limit 1) n on true
    ), posicoes as materialized (
      select id,cru,st_affine(geom,inversa[1],inversa[2],inversa[3],inversa[4],inversa[5],inversa[6]) desenho,
        st_affine(st_affine(geom,inversa[1],inversa[2],inversa[3],inversa[4],inversa[5],inversa[6]),
        alvo[1],alvo[2],alvo[3],alvo[4],alvo[5],alvo[6]) geom
      from destinos where exists(select from generate_series(1,6) i where abs(alvo[i]-anterior[i])>1e-12)
    ), medidas as (
      -- 0181: mede no DESENHO original (sem a escala da calibração), e a área
      -- escrita na planta, quando existe, prevalece
      select *,st_transform(desenho,31982) utm from posicoes
    ), movidos as (
      update public.urban_lots l set geom=m.geom,centro_calibracao=m.cru,
        area_m2=coalesce(l.area_texto_m2,st_area(utm)),perimetro_m=st_perimeter(utm),
        lados=(select coalesce(jsonb_agg(jsonb_build_object('m',round(st_length(s.geom)::numeric,2)) order by s.path),'[]'::jsonb)
               from st_dumpsegments(st_exteriorring(utm)) s where st_length(s.geom)>=0.5)
      from medidas m where l.id=m.id returning l.id
    ), fixos as (
      update public.urban_lots l set centro_calibracao=d.cru from destinos d
      where l.id=d.id and d.centro_calibracao is null and not exists(select from posicoes p where p.id=d.id)
      returning l.id
    )
    select count(*) into total from movidos;
    perform set_config('arini.calibrando_partes','nao',true);
  end if;
  update public.cartography_layers set offset_leste_m=(p_transform_depois->>'offset_leste_m')::numeric,
    offset_norte_m=(p_transform_depois->>'offset_norte_m')::numeric,rotacao_graus=(p_transform_depois->>'rotacao_graus')::numeric,
    escala=(p_transform_depois->>'escala')::numeric, ajustes_locais=p_depois,lotes_assinatura=p_nova_assinatura,
    lotes_gerados_em=case when total>0 then now() else lotes_gerados_em end where id=p_layer;
  if total>0 then perform public.fn_reencaixar_anuncios(p_layer_id=>p_layer,p_user_id=>p_autor); end if;
  return total;
end $$;

revoke all on function public.fn_cartografia_salvar_partes(uuid,jsonb,jsonb,jsonb,jsonb,float8[],float8[],float8[],jsonb,jsonb,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.fn_cartografia_salvar_partes(uuid,jsonb,jsonb,jsonb,jsonb,float8[],float8[],float8[],jsonb,jsonb,text,text,uuid)
  to service_role;

-- Conferência (deve mostrar 1 e 1):
select (select count(*) from information_schema.columns where table_name = 'urban_lots' and column_name = 'area_texto_m2') coluna,
       (select count(*) from pg_proc where proname = 'fn_cartografia_salvar_partes') funcao;
