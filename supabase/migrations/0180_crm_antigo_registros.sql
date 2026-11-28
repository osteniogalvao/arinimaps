-- 0180 — Dados importados do CRM da Arini Negócios (fase 6 do porte).
--
-- O histórico de atendimento (conversas e mensagens) vai direto para o
-- Atendimento, como conversas resolvidas com a etiqueta "crm-antigo". O resto
-- (imóveis, leads, clientes, proprietários, despesas, interações) fica aqui,
-- guardado como veio, para a equipe consultar em /admin/crm-antigo e trazer
-- para o sistema novo pelo fluxo normal (imóvel pela Captação, por exemplo).
-- Assim nada entra pela porta dos fundos em properties, que não aceita
-- remoção (LGPD), e nada se perde. Só o servidor lê (service_role).

create table if not exists public.crm_antigo_registros (
  tabela text not null check (tabela in ('properties', 'leads', 'clients', 'owners', 'expenses', 'lead_interactions', 'property_clients', 'property_capture_info')),
  id_antigo uuid not null,
  dados jsonb not null,
  criado_em_antigo timestamptz,
  importado_em timestamptz not null default now(),
  trazido_em timestamptz,
  trazido_por uuid references public.profiles(user_id) on delete set null,
  primary key (tabela, id_antigo)
);
create index if not exists idx_crm_antigo_tabela on public.crm_antigo_registros (tabela, criado_em_antigo desc);
alter table public.crm_antigo_registros enable row level security;
revoke all on public.crm_antigo_registros from anon, authenticated;
