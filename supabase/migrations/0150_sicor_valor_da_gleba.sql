-- Vídeo do Carlos (17/11/2026, 22h00 e 22h02): ao clicar na gleba do crédito
-- rural, ver o valor do crédito. A gleba do BCB (SICOR_GLEBAS_WKT) só traz a
-- geometria; valor, finalidade, produto e datas estão na operação
-- (SICOR_OPERACAO_BASICA_ESTADO), ligada pela referência + ordem. A referência
-- continua fora do banco: guardamos só os campos da operação que o cartão mostra.
alter table public.sicor_glebas add column if not exists operacao jsonb;

create or replace function public.fn_importar_glebas_sicor(p_carga jsonb)
returns integer language plpgsql set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_ano smallint := (p_carga->>'ano')::smallint;
  v_bbox double precision[];
  n integer;
begin
  select array_agg(v::double precision order by i) into v_bbox
    from jsonb_array_elements_text(p_carga->'bbox') with ordinality elem(v,i);
  if v_bbox is null or cardinality(v_bbox) <> 4 or v_bbox[1] < -75 or v_bbox[3] > -28
    or v_bbox[2] < -35 or v_bbox[4] > 7 or v_bbox[1] >= v_bbox[3] or v_bbox[2] >= v_bbox[4]
    or jsonb_typeof(p_carga->'glebas') is distinct from 'array' or jsonb_array_length(p_carga->'glebas') < 1 then
    raise exception 'Carga ou área de cobertura inválida';
  end if;
  insert into public.sicor_cargas(ano,bbox,quantidade) values (v_ano,v_bbox,0)
  on conflict(ano) do update set bbox=excluded.bbox,importado_em=now();
  delete from public.sicor_glebas where ano=v_ano;
  insert into public.sicor_glebas(ano,id,geom,operacao)
  select v_ano, x.id, g.geom, case when jsonb_typeof(x.operacao) = 'object' then x.operacao end
  from jsonb_to_recordset(p_carga->'glebas') x(id text,wkt text,operacao jsonb)
  cross join lateral (select st_multi(st_collectionextract(st_makevalid(st_geomfromtext(x.wkt,4326)),3)) geom) g
  where x.id ~ '^[0-9a-f]{64}$' and not st_isempty(g.geom)
    and st_intersects(g.geom,st_makeenvelope(v_bbox[1],v_bbox[2],v_bbox[3],v_bbox[4],4326));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nenhuma gleba válida na cobertura'; end if;
  update public.sicor_cargas set quantidade=n where ano=v_ano;
  delete from public.camadas_celulas where camada='credito_rural';
  return n;
end; $$;
revoke all on function public.fn_importar_glebas_sicor(jsonb) from public,anon,authenticated,service_role;

-- Completa as glebas já carregadas (sem trocar a geometria): [{id, operacao}].
create or replace function public.fn_operacoes_glebas_sicor(p_lista jsonb)
returns integer language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare n integer;
begin
  update public.sicor_glebas g set operacao = x.operacao
  from jsonb_to_recordset(p_lista) x(id text, operacao jsonb)
  where g.id = x.id and jsonb_typeof(x.operacao) = 'object';
  get diagnostics n = row_count;
  delete from public.camadas_celulas where camada='credito_rural';
  return n;
end; $$;
revoke all on function public.fn_operacoes_glebas_sicor(jsonb) from public,anon,authenticated;
grant execute on function public.fn_operacoes_glebas_sicor(jsonb) to service_role;

create or replace function public.fn_sicor_glebas_mapa(p_xmin double precision,p_ymin double precision,p_xmax double precision,p_ymax double precision)
returns jsonb language sql stable set search_path = pg_catalog, public, extensions as $$
  select case when not exists(select from public.sicor_cargas) then null
    else coalesce(jsonb_agg(jsonb_build_object('type','Feature','geometry',st_asgeojson(g.geom,6)::jsonb,
      'properties',jsonb_build_object('id',g.id,'ano',g.ano, 'importado_em',c.importado_em)
        || coalesce(g.operacao, '{}'::jsonb))), '[]'::jsonb) end
  from public.sicor_glebas g join public.sicor_cargas c using(ano)
  where st_intersects(g.geom,st_makeenvelope(p_xmin,p_ymin,p_xmax,p_ymax,4326));
$$;
revoke all on function public.fn_sicor_glebas_mapa(double precision,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function public.fn_sicor_glebas_mapa(double precision,double precision,double precision,double precision) to service_role;
