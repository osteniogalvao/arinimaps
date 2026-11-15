-- A 0107 original impedia cadastrar autorizações simples e imóveis de parceiros
-- mesmo quando o prazo estava vazio. A constraint recebeu nome automático.
do $$
declare
  tabela regclass := 'public.property_authorizations'::regclass;
  prazo smallint;
  tipo smallint;
  nome name;
begin
  select attnum into strict prazo from pg_attribute where attrelid = tabela and attname = 'prazo_meses';
  select attnum into strict tipo from pg_attribute where attrelid = tabela and attname = 'tipo';
  select conname into strict nome from pg_constraint
   where conrelid = tabela and contype = 'c' and cardinality(conkey) = 2
     and conkey @> array[prazo, tipo];

  execute format('alter table public.property_authorizations drop constraint %I,
    add constraint property_authorizations_prazo_exclusividade_check
      check (prazo_meses is null or (tipo = ''exclusividade'' and prazo_meses in (6, 12)))', nome);
end $$;
