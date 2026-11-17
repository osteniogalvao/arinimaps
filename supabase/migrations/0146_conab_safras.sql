-- Safras de grãos da CONAB por UF (pedido do Carlos, 17/11: "CONAB safras" das
-- camadas do Dados Fazenda, que é tabela e não mapa, entra junto das cotações).
-- O worker (job `coletar_safras_conab`, worker/jobs/conabSafras.mjs) grava a
-- série histórica e o levantamento mais recente de cada safra. Uma linha por
-- safra, produto e UF; o levantamento novo substitui a estimativa anterior.
create table if not exists conab_safras (
  safra text not null,                 -- "2025/26"
  produto text not null,               -- "SOJA", "MILHO 1ª SAFRA"...
  uf text not null,                    -- sigla da UF
  levantamento text not null default '',  -- "4º levantamento" ou "série histórica"
  area_mil_ha numeric,
  producao_mil_t numeric,
  atualizado_em timestamptz not null default now(),
  primary key (safra, produto, uf)
);
create index if not exists idx_conab_safras_produto on conab_safras (produto, safra desc);
alter table conab_safras enable row level security;
revoke all on conab_safras from public, anon, authenticated;
grant select, insert, update, delete on conab_safras to service_role;
