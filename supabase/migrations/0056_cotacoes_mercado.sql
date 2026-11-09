-- Arini Imóveis Brasil — migration 0056: cotações do agro (faixa do topo e /mercado).
--
-- Itens 1.2.1 e 1.2.2 da revisão e item 27 da segunda etapa. O worker (job
-- `coletar_cotacoes`, worker/jobs/cotacoes.mjs) busca as cotações em fontes
-- públicas e gratuitas algumas vezes ao dia e grava aqui com upsert; o site só
-- lê do banco, com cache — nenhuma chamada externa no acesso do visitante.
--
--  · cotacoes_series  — uma linha por série: produto, praça/região, unidade,
--    fonte e o endereço da fonte (citação obrigatória: CEPEA, Scot, etc.).
--    `destaque` = entra na faixa do topo; `ordem` = posição na faixa e nas listas.
--  · cotacoes_valores — um valor por série e por dia (data no fuso de Brasília),
--    com a variação % sobre o pregão anterior quando a fonte informa (ou o job
--    calcula). Se a fonte cair, nada é apagado: fica o último valor.
--
-- Leitura pública (anon e authenticated); escrita só pelo service role e pelo
-- worker (conexão postgres), que passam por cima da RLS. Tudo idempotente.

create table if not exists cotacoes_series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                 -- ex.: cepea-boi-gordo, scot-boi-gordo-mg-triangulo
  produto text not null,                     -- boi-gordo | milho | soja | frango | dolar | ibovespa
  nome text not null,                        -- rótulo curto (faixa): "Boi gordo"
  descricao text,                            -- nome completo do indicador
  praca text,                                -- praça/região quando a fonte informa
  uf char(2),
  unidade text not null,                     -- R$/@ · R$/sc 60 kg · R$/kg · R$/US$ · pontos
  casas smallint not null default 2,         -- casas decimais na exibição
  fonte text not null,                       -- quem publica (citação)
  url_fonte text not null,                   -- página pública da fonte
  destaque boolean not null default false,   -- aparece na faixa do topo
  ordem int not null default 100,
  ativa boolean not null default true,
  atualizado_em timestamptz,                 -- última coleta com sucesso
  ultimo_erro text,                          -- última falha (null quando a coleta volta)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cotacoes_series_produto on cotacoes_series (produto, ordem) where ativa;
create index if not exists idx_cotacoes_series_destaque on cotacoes_series (ordem) where ativa and destaque;
create index if not exists idx_cotacoes_series_uf on cotacoes_series (uf) where ativa;

drop trigger if exists trg_cotacoes_series_touch on cotacoes_series;
create trigger trg_cotacoes_series_touch before update on cotacoes_series
  for each row execute function fn_touch_updated_at();

create table if not exists cotacoes_valores (
  serie_id uuid not null references cotacoes_series(id) on delete cascade,
  data date not null,
  valor numeric(16,4) not null check (valor > 0),
  variacao numeric(10,4),                    -- % sobre o pregão anterior
  coletado_em timestamptz not null default now(),
  primary key (serie_id, data)
);
-- a chave primária já serve "série + período"; este atende "o mais recente primeiro"
create index if not exists idx_cotacoes_valores_recentes on cotacoes_valores (serie_id, data desc);

-- Último valor de cada série ativa (faixa do topo e lista do /mercado).
-- security_invoker: a view respeita a RLS de quem consulta.
create or replace view cotacoes_ultimas with (security_invoker = true) as
select distinct on (v.serie_id)
  s.id, s.slug, s.produto, s.nome, s.descricao, s.praca, s.uf, s.unidade, s.casas,
  s.fonte, s.url_fonte, s.destaque, s.ordem, s.atualizado_em,
  v.data, v.valor, v.variacao
from cotacoes_valores v
join cotacoes_series s on s.id = v.serie_id
where s.ativa
order by v.serie_id, v.data desc;

alter table cotacoes_series enable row level security;
alter table cotacoes_valores enable row level security;

-- leitura pública; sem policy de insert/update/delete: só service role/worker escrevem
drop policy if exists p_cotacoes_series_leitura on cotacoes_series;
create policy p_cotacoes_series_leitura on cotacoes_series for select using (ativa);

drop policy if exists p_cotacoes_valores_leitura on cotacoes_valores;
create policy p_cotacoes_valores_leitura on cotacoes_valores for select
  using (exists (select 1 from cotacoes_series s where s.id = serie_id and s.ativa));

grant select on cotacoes_series, cotacoes_valores, cotacoes_ultimas to anon, authenticated;
revoke insert, update, delete, truncate on cotacoes_series, cotacoes_valores from anon, authenticated;
