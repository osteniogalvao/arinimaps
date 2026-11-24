-- 0172 · Marketing > Tags e pixels
--
-- Códigos de terceiros (Google Tag Manager, Google Analytics, Meta Pixel,
-- TikTok, Hotjar, verificações…) cadastrados pelo Marketing no painel, no
-- estilo dos plugins de "headers and footers" do WordPress, tudo num lugar:
--   · posicao: dentro do <head>, no início do <body> ou no fim do <body>
--   · todas_paginas = true  → vale no site inteiro, menos o que estiver em `excluir`
--   · todas_paginas = false → vale só nos caminhos de `paginas`, menos `excluir`
-- Caminhos: "/mapa" (só a página), "/imovel/**" (a página e todas as
-- subpáginas), "/imovel/*/tour" (o * vale um trecho do endereço).
-- O painel da equipe (/admin) nunca recebe esses códigos, por segurança.
--
-- Só o servidor (service role) lê e grava: a tela do admin confere o setor
-- (Marketing ou Diretoria) e registra cada mudança no audit_log.
-- Idempotente.

create table if not exists public.marketing_tags (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 1 and 120),
  codigo text not null check (length(codigo) between 1 and 20000),
  posicao text not null default 'head' check (posicao in ('head','body_inicio','body_fim')),
  ativo boolean not null default true,
  todas_paginas boolean not null default true,
  paginas text[] not null default '{}' check (cardinality(paginas) <= 60),
  excluir text[] not null default '{}' check (cardinality(excluir) <= 60),
  observacao text not null default '' check (length(observacao) <= 500),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "só nas páginas escolhidas" sem nenhuma página não carregaria em lugar nenhum
  check (todas_paginas or cardinality(paginas) > 0)
);

create index if not exists marketing_tags_ativo_idx on public.marketing_tags (ativo, created_at);

alter table public.marketing_tags enable row level security;
revoke all on public.marketing_tags from anon, authenticated;
grant all on public.marketing_tags to service_role;
-- sem policy para anon/authenticated de propósito: ninguém lê nem grava pelo
-- navegador; o site recebe só os códigos ativos, montados no servidor.
