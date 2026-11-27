-- 0176: ficha do imóvel no jeito do CRM da Arini Negócios.
--
-- Pedido do Stenio em 27/11/2026: trazer do CRM antigo a organização, as telas
-- e a forma de usar. Na ficha do imóvel o antigo tinha o captador, a placa e as
-- observações de cada setor (Captação, Marketing, Jurídico, Financeiro...), que
-- deixavam o imóvel "interligado" entre os setores. Aqui:
--   · properties.captador_user_id  — quem da equipe captou o imóvel;
--   · properties.placa_status      — placa no imóvel (não colocada, colocada, retirada);
--   · imovel_observacoes           — anotações por setor, só inserção (ninguém edita nem apaga).
-- A gravação passa pelas rotas da Central (service role); RLS ligada sem
-- policy deixa a tabela fechada para o navegador.
-- Idempotente: pode rodar de novo.

alter table public.properties add column if not exists captador_user_id uuid references public.profiles(user_id);
alter table public.properties add column if not exists placa_status text not null default 'nao_colocada';
do $$ begin
  alter table public.properties add constraint chk_properties_placa_status
    check (placa_status in ('nao_colocada', 'colocada', 'retirada'));
exception when duplicate_object then null; end $$;

create table if not exists public.imovel_observacoes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  setor text not null check (setor in ('diretoria','operacoes','comercial','financeiro','juridico',
    'marketing','marketing_trafego','cartografia','suporte','seguranca')),
  autor uuid references public.profiles(user_id) on delete set null,
  texto text not null check (length(btrim(texto)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists idx_imovel_observacoes_imovel on public.imovel_observacoes (property_id, created_at desc);
alter table public.imovel_observacoes enable row level security;

-- só inserção: a anotação de um setor fica como foi escrita
create or replace function public.fn_imovel_observacoes_somente_insercao() returns trigger
language plpgsql as $$
begin
  raise exception 'Observações do imóvel não podem ser alteradas nem apagadas.';
end $$;
drop trigger if exists trg_imovel_observacoes_somente_insercao on public.imovel_observacoes;
create trigger trg_imovel_observacoes_somente_insercao before update or delete on public.imovel_observacoes
  for each row when (pg_trigger_depth() = 0) execute function public.fn_imovel_observacoes_somente_insercao();
