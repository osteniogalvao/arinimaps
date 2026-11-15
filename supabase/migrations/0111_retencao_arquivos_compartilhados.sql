-- Um loteamento pode usar a mesma selfie de aceite em todas as unidades.
-- Apagar o objeto no Storage exige que TODAS as referências possam ser descartadas.
create index if not exists retencao_autorizacao_selfie on public.property_authorizations(selfie_path) where selfie_path is not null;
create index if not exists retencao_autorizacao_documento on public.property_authorizations(documento_path) where documento_path is not null;
create index if not exists retencao_documento_arquivo on public.property_documents(storage_path);

create function public.lgpd_acesso_sob_guarda(p_imovel uuid,p_path text)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select from public.lgpd_guardas g where g.liberada_em is null and (
      g.property_id=p_imovel
      or (g.cofre_id is not null and split_part(p_path,'/',1)='cofre' and split_part(p_path,'/',3)=g.cofre_id::text)
      or g.property_id in (select a.property_id from public.property_authorizations a where a.selfie_path=p_path
                           union all select a.property_id from public.property_authorizations a where a.documento_path=p_path
                           union all select d.property_id from public.property_documents d where d.storage_path=p_path)
    )
  );
$$;
revoke all on function public.lgpd_acesso_sob_guarda(uuid,text) from public,anon,authenticated;

create or replace function public.fn_descarte_candidatos(p_selfie_dias int,p_docs_dias int,p_logs_dias int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare selfies jsonb; docs jsonb; logs jsonb:='{}'; t text; n bigint;
begin
  with guardados as materialized (
    select property_id from lgpd_guardas where liberada_em is null and property_id is not null
  ), referencias as materialized (
    select a.selfie_path as path,'selfie' as tipo,a.id,a.property_id,
      p_selfie_dias>0 and coalesce(a.validade::timestamptz,a.created_at)+make_interval(days=>p_selfie_dias)<now()
        and not exists(select from guardados g where g.property_id=a.property_id) as descartavel,
      null::text as tipo_doc,null::text as nome_doc
    from property_authorizations a where a.selfie_path is not null
    union all
    select d.storage_path,'documento',d.id,d.property_id,
      p_docs_dias>0 and p.status='reprovado' and p.updated_at+make_interval(days=>p_docs_dias)<now()
        and not exists(select from guardados g where g.property_id=d.property_id),
      d.tipo,d.nome_arquivo
    from property_documents d join properties p on p.id=d.property_id
    union all
    select a.documento_path,'autorizacao',a.id,a.property_id,false,null,null
    from property_authorizations a where a.documento_path is not null
  ), liberados as (
    select path from referencias group by path having bool_and(descartavel is true)
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('id',r.id,'property_id',r.property_id,'path',r.path))
      filter (where r.tipo='selfie'),'[]'),
    coalesce(jsonb_agg(jsonb_build_object('id',r.id,'property_id',r.property_id,'path',r.path,'tipo',r.tipo_doc,'nome',r.nome_doc))
      filter (where r.tipo='documento'),'[]')
    into selfies,docs from referencias r join liberados using(path);
  if p_logs_dias>0 then
    foreach t in array array['auth_events','document_access_log','access_attempts','consultas_area_log','alertas_seguranca'] loop
      if to_regclass('public.'||t) is not null then
        execute format('select count(*) from %I l where created_at<now()-make_interval(days=>$1)',t)
          ||case when t='document_access_log' then ' and not public.lgpd_acesso_sob_guarda(l.property_id,l.storage_path)' else '' end
          into n using p_logs_dias;
        logs:=logs||jsonb_build_object(t,n);
      end if;
    end loop;
  end if;
  return jsonb_build_object('selfies',selfies,'documentos',docs,'logs',logs,
    'prazos',jsonb_build_object('selfie',p_selfie_dias,'documentos',p_docs_dias,'logs',p_logs_dias));
end $$;

create or replace function public.lgpd_proteger_registro_imovel() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='document_access_log' and current_setting('arini.descarte_autorizado',true)='on' then
    if public.lgpd_acesso_sob_guarda(old.property_id,old.storage_path) then return null; end if;
    return old;
  end if;
  if exists(select from public.lgpd_guardas where property_id=old.property_id and liberada_em is null) then
    raise exception 'Registro preservado pelo Jurídico.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
