-- 0177 — as views *_oficiais (0142) voltam a mostrar todas as colunas das tabelas.
--
-- Uma view criada com `select r.*` congela a lista de colunas no momento em
-- que foi criada. A 0142 criou as views antes da 0147 acrescentar em
-- opportunities as colunas temperatura, etiquetas, proxima_acao e
-- proxima_acao_em (e em leads, criado_por). Resultado em produção (27/11/2026):
-- a tela /admin/leads pedia essas colunas à view, recebia "column does not
-- exist", caía na lista simples e mostrava o aviso "aparecem depois da
-- migration 0147", mesmo com a 0147 rodada.
--
-- `create or replace view` com o mesmo `select r.*` mantém as colunas antigas
-- na mesma ordem e acrescenta as novas no fim. Não mexe em dados.

create or replace view public.oportunidades_oficiais with (security_invoker = true) as
select r.* from public.opportunities r
where not exists (select 1 from public.properties p where p.id = r.property_id and p.demonstracao);

create or replace view public.leads_oficiais with (security_invoker = true) as
select r.* from public.leads r
where not exists (select 1 from public.properties p where p.id = r.property_id and p.demonstracao);

create or replace view public.comissoes_oficiais with (security_invoker = true) as
select r.* from public.commissions r
where not exists (select 1 from public.sales s join public.properties p on p.id = s.property_id
  where s.id = r.sale_id and p.demonstracao);

create or replace view public.vendas_oficiais with (security_invoker = true) as
select r.* from public.sales r
where not exists (select 1 from public.properties p where p.id = r.property_id and p.demonstracao);

-- mesmas permissões da 0142: só o servidor (service_role) lê
revoke all on public.oportunidades_oficiais, public.leads_oficiais,
  public.comissoes_oficiais, public.vendas_oficiais from public, anon, authenticated, service_role;
grant select on public.oportunidades_oficiais, public.leads_oficiais,
  public.comissoes_oficiais, public.vendas_oficiais to service_role;
