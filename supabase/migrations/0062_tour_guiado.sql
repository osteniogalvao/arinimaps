-- Arini Imóveis Brasil — migration 0062: tour guiado de novos usuários (09/11/2026)
--
-- 2ª etapa do cliente, item 14: o tour leve aparece na primeira visita, por
-- perfil (mapa, painel, parceiro, central). O "já viu" fica no localStorage
-- do navegador e, para quem está logado, também aqui, para não repetir em
-- outro aparelho. Lido e gravado só pelo servidor (GET/POST /api/conta/tour,
-- service role); as políticas de profiles continuam as mesmas.
--
-- Aditiva: sem esta coluna a rota responde "sem registro" e o tour usa só o
-- localStorage.

alter table profiles add column if not exists tours_vistos text[] not null default '{}';

comment on column profiles.tours_vistos is
  'Tours guiados já vistos ou pulados (mapa, painel, parceiro, central). Gravado por POST /api/conta/tour.';
