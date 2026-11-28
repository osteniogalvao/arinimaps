-- 0178 — despesa ligada a um imóvel (Financeiro do imóvel, porte do CRM da
-- Arini Negócios). No CRM antigo, "despesa de imóvel" era uma despesa com o
-- imóvel ligado; aqui a despesa continua passando pela mesma aprovação do
-- Financeiro, só ganha o imóvel. Não mexe em dados.

alter table public.despesas
  add column if not exists property_id uuid references public.properties(id) on delete set null;

create index if not exists idx_despesas_property on public.despesas (property_id, vencimento)
  where property_id is not null;
