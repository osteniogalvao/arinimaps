-- Leituras operacionais excluem os anúncios identificados na migration 0141.

create view public.oportunidades_oficiais with (security_invoker = true) as
select r.* from public.opportunities r
where not exists (select 1 from public.properties p where p.id = r.property_id and p.demonstracao);
revoke all on public.oportunidades_oficiais from public, anon, authenticated, service_role;
grant select on public.oportunidades_oficiais to service_role;

create view public.leads_oficiais with (security_invoker = true) as
select r.* from public.leads r
where not exists (select 1 from public.properties p where p.id = r.property_id and p.demonstracao);
revoke all on public.leads_oficiais from public, anon, authenticated, service_role;
grant select on public.leads_oficiais to service_role;

create view public.comissoes_oficiais with (security_invoker = true) as
select r.* from public.commissions r
where not exists (select 1 from public.sales s join public.properties p on p.id = s.property_id
  where s.id = r.sale_id and p.demonstracao);
revoke all on public.comissoes_oficiais from public, anon, authenticated, service_role;
grant select on public.comissoes_oficiais to service_role;

create view public.vendas_oficiais with (security_invoker = true) as
select r.* from public.sales r
where not exists (select 1 from public.properties p where p.id = r.property_id and p.demonstracao);
revoke all on public.vendas_oficiais from public, anon, authenticated, service_role;
grant select on public.vendas_oficiais to service_role;

create or replace function fn_relatorio_kpis()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'oportunidades_por_etapa', coalesce((
      select jsonb_object_agg(etapa, n) from (select etapa::text as etapa, count(*) as n from oportunidades_oficiais group by etapa) e
    ), '{}'::jsonb),
    'vendas_total', coalesce((select sum(valor_final) from vendas_oficiais), 0),
    'comissoes_por_status', coalesce((
      select jsonb_object_agg(status, total) from (select status::text as status, sum(valor) as total from comissoes_oficiais group by status) c
    ), '{}'::jsonb),
    'faturas_por_status', coalesce((
      select jsonb_object_agg(status, total) from (select status::text as status, sum(valor) as total from invoices group by status) f
    ), '{}'::jsonb),
    'leads_por_origem', coalesce((
      select jsonb_object_agg(origem, n) from (select coalesce(origem::text, 'direto') as origem, count(*) as n from leads_oficiais group by 1) l
    ), '{}'::jsonb)
  );
$$;

create or replace function fn_financeiro_mensal(p_meses integer default 12)
returns json language sql stable security definer set search_path = public as $$
  with meses as (
    select date_trunc('month', current_date) - make_interval(months => g) as mes
    from generate_series(0, greatest(p_meses, 1) - 1) g
  )
  select coalesce(json_agg(json_build_object(
    'mes', to_char(m.mes, 'YYYY-MM'),
    'vendas', (select count(*) from vendas_oficiais s where date_trunc('month', s.data_venda) = m.mes),
    'volume_vendido', (select coalesce(sum(s.valor_final), 0) from vendas_oficiais s where date_trunc('month', s.data_venda) = m.mes),
    'comissao_registrada', (select coalesce(sum(c.valor), 0) from comissoes_oficiais c join sales s on s.id = c.sale_id
                            where date_trunc('month', s.data_venda) = m.mes),
    'comissao_recebida', (select coalesce(sum(c.valor), 0) from comissoes_oficiais c
                          where c.autorizacao_id is null and c.pago_em is not null and date_trunc('month', c.pago_em) = m.mes) + (select coalesce(sum(cm.diferenca), 0) from comissao_movimentos cm join comissao_recebimentos cr on cr.id = cm.recebimento_id
                             join comissoes_oficiais c on c.id = cr.comissao_id where cm.tipo = 'recebimento' and date_trunc('month', cm.data) = m.mes),
    'mensalidade_faturada', (select coalesce(sum(i.valor), 0) from invoices i where date_trunc('month', i.competencia) = m.mes),
    'mensalidade_recebida', (select coalesce(sum(i.valor), 0) from invoices i
                             where i.pago_em is not null and date_trunc('month', i.pago_em) = m.mes)
  ) order by m.mes desc), '[]'::json)
  from meses m
$$;
