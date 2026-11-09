-- 0063 — Auditoria de código (09/11/2026)
--
-- 1. presentations: uma por (imóvel, tipo).
--    Cada "publicado" em /api/admin/decisao inseria de novo o tour e o vídeo.
--    A ficha pública lia o vídeo com .maybeSingle() e, com duas linhas, o vídeo
--    sumia. Aqui: apaga os duplicados (fica o pronto e, entre iguais, o mais
--    recente) e cria o unique. O código já não duplica (checa antes de inserir)
--    e a ficha usa order+limit(1), então funciona com ou sem esta migration.
--
-- 2. fn_relatorio_kpis(): os indicadores de /admin/relatorios somados no banco.
--    Antes a página trazia as tabelas inteiras e somava no JS — o PostgREST
--    corta em 1000 linhas sem avisar, e os números ficavam errados calados.
--    A página tem fallback em lotes se esta função ainda não existir.

-- ---- 1. presentations sem duplicado
with ordenadas as (
  select id,
         row_number() over (
           partition by property_id, tipo
           order by (status = 'pronto') desc, (output_path is not null) desc, updated_at desc, created_at desc, id
         ) as n
  from presentations
)
delete from presentations p
using ordenadas o
where p.id = o.id and o.n > 1;

create unique index if not exists uq_presentations_imovel_tipo on presentations (property_id, tipo);

-- ---- 2. indicadores da Diretoria
create or replace function fn_relatorio_kpis()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'oportunidades_por_etapa', coalesce((
      select jsonb_object_agg(etapa, n) from (select etapa::text as etapa, count(*) as n from opportunities group by etapa) e
    ), '{}'::jsonb),
    'vendas_total', coalesce((select sum(valor_final) from sales), 0),
    'comissoes_por_status', coalesce((
      select jsonb_object_agg(status, total) from (select status::text as status, sum(valor) as total from commissions group by status) c
    ), '{}'::jsonb),
    'faturas_por_status', coalesce((
      select jsonb_object_agg(status, total) from (select status::text as status, sum(valor) as total from invoices group by status) f
    ), '{}'::jsonb),
    'leads_por_origem', coalesce((
      select jsonb_object_agg(origem, n) from (select coalesce(origem::text, 'direto') as origem, count(*) as n from leads group by 1) l
    ), '{}'::jsonb)
  );
$$;

-- só o servidor (service role) chama: a página da Diretoria confere o setor antes
revoke execute on function fn_relatorio_kpis() from public, anon, authenticated;
grant execute on function fn_relatorio_kpis() to service_role;
