-- Uma camada raster pendente sempre tem o job de tiles na mesma transação.
create function public.fn_enfileirar_raster(p_layer_id uuid, p_municipio uuid, p_nome text, p_ext text, p_bytes bigint)
returns uuid language plpgsql set search_path = '' as $$
declare caminho text;
begin
  if p_ext is null or p_ext not in ('tif','png','jpg') or p_bytes is null or p_bytes not between 1 and 209715200
    or p_nome is null or btrim(p_nome) = '' then raise invalid_parameter_value; end if;
  caminho := 'raster/' || p_municipio::text || '/' || p_layer_id::text || '.' || p_ext;
  insert into public.cartography_layers(id,municipality_id,nome,tipo,source_path,bytes)
    values(p_layer_id,p_municipio,p_nome,'raster',caminho,p_bytes);
  insert into public.jobs(tipo,payload) values('tile_raster',
    jsonb_build_object('layer_id',p_layer_id,'source_path',caminho,'source_bucket','docs'));
  return p_layer_id;
end $$;
revoke all on function public.fn_enfileirar_raster(uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.fn_enfileirar_raster(uuid,uuid,text,text,bigint) to service_role;

-- A troca da planta só acontece depois que o original e a cópia pública
-- subiram. Uma falha na geração do job desfaz também a troca da camada.
create function public.fn_publicar_dxf(p_layer_id uuid, p_municipio uuid, p_nome text, p_original text,
  p_publico text, p_bytes bigint, p_centro jsonb, p_diagnostico jsonb)
returns uuid language plpgsql set search_path = '' as $$
begin
  perform 1 from public.municipalities where id=p_municipio for update;
  if not found then raise foreign_key_violation; end if;
  -- A FK dos lotes e das exclusões usa ON DELETE CASCADE. Trave as camadas
  -- antes da verificação, inclusive contra criação concorrente de lotes.
  perform 1 from public.cartography_layers where municipality_id=p_municipio and tipo='vector' order by id for update;
  if exists (select 1 from public.cartography_layers c where c.municipality_id=p_municipio and c.tipo='vector' and (
    exists (select 1 from public.urban_lots l where l.layer_id=c.id) or
    exists (select 1 from public.cartografia_lotes_excluidos e where e.layer_id=c.id) or
    c.source_path is null or c.source_path not like 'cartografia/vetor/%' or
    c.edicoes_geometria <> '[]'::jsonb or c.ajustes_locais <> '[]'::jsonb or
    cardinality(c.linhas_excluidas)>0 or cardinality(c.layers_ocultos)>0 or
    (c.pontos_controle is not null and c.pontos_controle <> '[]'::jsonb) or
    c.offset_leste_m<>0 or c.offset_norte_m<>0 or c.escala<>1 or c.rotacao_graus<>0 or
    c.datum<>'sirgas' or c.espessura_linha<>1 or c.opacidade_padrao<>0.85 or c.min_zoom<>12 or c.max_zoom<>19
  )) then raise object_not_in_prerequisite_state; end if;
  insert into public.cartography_layers(id,municipality_id,nome,tipo,source_path,tiles_path,status,min_zoom,max_zoom,
      opacidade_padrao,bytes,diagnostico,publico_path,publico_bytes,publico_centro)
    values(p_layer_id,p_municipio,p_nome,'vector',p_original,p_original,'pronto',12,19,0.85,p_bytes,
      p_diagnostico,p_publico,p_bytes,p_centro);
  insert into public.jobs(tipo,payload) values('gerar_lotes',jsonb_build_object('layer_id',p_layer_id));
  delete from public.cartography_layers where municipality_id=p_municipio and tipo='vector' and id<>p_layer_id;
  return p_layer_id;
end $$;
revoke all on function public.fn_publicar_dxf(uuid,uuid,text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fn_publicar_dxf(uuid,uuid,text,text,text,bigint,jsonb,jsonb) to service_role;
