-- Inventário comercial da Diretoria. Importação dos anexos pelo operador.
create table public.matriz_personas (
  id integer primary key check (id > 0),
  titulo text not null,
  natureza text not null check (natureza in ('F', 'I', 'X', 'N')),
  modulo text not null,
  subsecao text not null,
  permissoes jsonb not null check (jsonb_typeof(permissoes) = 'object')
);
alter table public.matriz_personas enable row level security;
revoke all on public.matriz_personas from public, anon, authenticated;
grant select on public.matriz_personas to service_role;
