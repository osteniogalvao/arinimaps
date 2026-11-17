-- Relatório mensal da área monitorada (17/11/2026, "FarmScan" do Dados Fazenda).
-- Leitura somente: retrato da área, registros atuais por fonte e ocorrências do período.
-- Sem tabela nova; o aviso do dia 1º usa fn_notificar com chave por área e mês.

create or replace function public.monitor_relatorio(p_titular uuid, p_area uuid, p_desde timestamptz)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
   'nome', a.nome,
   'hectares', round((ST_Area(a.geom::geography)/10000)::numeric, 2),
   'ativo', a.ativo,
   'aceite_em', a.aceite_em,
   'geometria', ST_AsGeoJSON(a.geom, 6)::jsonb,
   'leituras', coalesce((select jsonb_agg(jsonb_build_object(
       'fonte', l.fonte, 'lida_em', l.lida_em, 'falhou', l.falhou,
       'registros', (select count(*) from jsonb_object_keys(coalesce(l.registros, '{}'::jsonb)))) order by l.fonte)
     from monitor_leituras l where l.area_id = a.id and l.ativa), '[]'::jsonb),
   'eventos', coalesce((select jsonb_agg(jsonb_build_object(
       'fonte', e.fonte, 'titulo', e.titulo, 'codigo', e.codigo, 'detectado_em', e.detectado_em, 'novo', e.anterior is null)
       order by e.detectado_em desc)
     from (select * from monitor_eventos where area_id = a.id and detectado_em >= p_desde order by id desc limit 200) e), '[]'::jsonb))
 from monitor_areas a where a.id = p_area and a.titular = p_titular
$$;

-- Áreas que recebem o aviso do relatório mensal: ativas e liberadas pelo plano.
create or replace function public.monitor_areas_relatorio_mensal()
returns table(titular uuid, area uuid, nome text) language sql stable security definer set search_path=public,pg_temp as $$
 select a.titular, a.id, a.nome from monitor_areas a where a.ativo and monitor_area_habilitada(a)
$$;

revoke all on function public.monitor_relatorio(uuid, uuid, timestamptz), public.monitor_areas_relatorio_mensal() from public, anon, authenticated;
grant execute on function public.monitor_relatorio(uuid, uuid, timestamptz), public.monitor_areas_relatorio_mensal() to service_role;
