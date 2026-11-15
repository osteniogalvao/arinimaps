-- Nomes de exibição da Matriz; o identificador vindo do CAD continua servindo
-- à seleção de linhas, às exclusões e à geração do arquivo público.
alter table public.cartography_layers
  add column if not exists apelidos_cad jsonb not null default '{}'::jsonb
  check (jsonb_typeof(apelidos_cad) = 'object');
