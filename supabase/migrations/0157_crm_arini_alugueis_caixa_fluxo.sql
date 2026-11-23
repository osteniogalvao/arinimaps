-- 0157 · O que faltava do CRM da Arini Negócios Imobiliários (repositório
-- osteniogalvao/arini), trazido para a Central do ARINI Maps:
--
--   1. Caixa: contas bancárias/caixa com saldo, cada lançamento numa conta,
--      transferência entre contas (Arini: bank_accounts, /admin/caixa).
--   2. Aluguéis: contrato de locação, parcela mensal do inquilino, atraso e
--      repasse ao proprietário com taxa de administração (Arini: 0019).
--   3. Fluxo do imóvel captação → marketing → aprovação da Diretoria
--      (Arini: "captação sobe, vai pro marketing, só a diretoria aprova").
--   4. Instagram e Messenger no Atendimento (canal da conversa).
--
-- Idempotente. Depende de 0066 (financeiro), 0065 (tarefas) e 0156 (atendimento).

-- ===========================================================================
-- 1. Caixa
-- ===========================================================================
create table if not exists public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  banco text,
  agencia text,
  numero text,
  tipo text not null default 'conta_corrente' check (tipo in ('conta_corrente', 'poupanca', 'caixa', 'investimento', 'gateway')),
  saldo_inicial numeric(14,2) not null default 0,
  saldo_inicial_em date not null default current_date,
  padrao boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contas_bancarias_uma_padrao on public.contas_bancarias (padrao) where padrao;
drop trigger if exists trg_contas_bancarias_touch on public.contas_bancarias;
create trigger trg_contas_bancarias_touch before update on public.contas_bancarias for each row execute function fn_touch_updated_at();
insert into public.contas_bancarias (nome, tipo, padrao) values ('Conta principal', 'conta_corrente', true) on conflict (nome) do nothing;

alter table public.lancamentos_contabeis add column if not exists conta_bancaria_id uuid references public.contas_bancarias(id);
alter table public.despesas add column if not exists conta_bancaria_id uuid references public.contas_bancarias(id);
create index if not exists idx_lancamentos_conta_bancaria on public.lancamentos_contabeis (conta_bancaria_id, data);

-- lançamento sem conta cai na conta da despesa ou na conta padrão: assim o
-- saldo do caixa bate com o resultado sem ninguém lembrar de escolher conta
create or replace function public.trg_lancamento_conta_bancaria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.conta_bancaria_id is null and new.origem = 'despesa' and new.origem_id is not null then
    select conta_bancaria_id into new.conta_bancaria_id from despesas where id = new.origem_id;
  end if;
  if new.conta_bancaria_id is null then
    select id into new.conta_bancaria_id from contas_bancarias where padrao and ativo limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_lancamentos_conta_bancaria on public.lancamentos_contabeis;
create trigger trg_lancamentos_conta_bancaria before insert on public.lancamentos_contabeis
  for each row execute function public.trg_lancamento_conta_bancaria();

-- o que já existe vai para a conta padrão
update public.lancamentos_contabeis set conta_bancaria_id = (select id from public.contas_bancarias where padrao limit 1)
where conta_bancaria_id is null;

create or replace function public.fn_caixa_saldos()
returns table (id uuid, nome text, tipo text, ativo boolean, padrao boolean, saldo_inicial numeric, entradas numeric, saidas numeric, saldo numeric)
language sql stable security definer set search_path = public as $$
  select b.id, b.nome, b.tipo, b.ativo, b.padrao, b.saldo_inicial,
    coalesce(sum(l.valor) filter (where l.natureza = 'entrada'), 0),
    coalesce(sum(l.valor) filter (where l.natureza = 'saida'), 0),
    b.saldo_inicial + coalesce(sum(case when l.natureza = 'entrada' then l.valor else -l.valor end), 0)
  from contas_bancarias b
  left join lancamentos_contabeis l on l.conta_bancaria_id = b.id and not l.estornado and l.data >= b.saldo_inicial_em
  group by b.id order by b.padrao desc, b.nome;
$$;
revoke all on function public.fn_caixa_saldos() from public, anon, authenticated;
grant execute on function public.fn_caixa_saldos() to service_role;

insert into public.plano_contas (codigo, nome, tipo) values
  ('1.2', 'Transferências entre contas', 'ativo'),
  ('2.1', 'Aluguéis a repassar', 'passivo'),
  ('3.3', 'Taxa de administração de aluguéis', 'receita')
on conflict (codigo) do nothing;

alter table public.contas_bancarias enable row level security;

-- ===========================================================================
-- 2. Aluguéis
-- ===========================================================================
create sequence if not exists public.contrato_locacao_seq;
create table if not exists public.contratos_locacao (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('LC-' || lpad(nextval('public.contrato_locacao_seq')::text, 5, '0')),
  property_id uuid references public.properties(id) on delete set null,
  endereco text,
  proprietario_nome text not null,
  proprietario_doc text,
  proprietario_telefone text,
  proprietario_pix text,
  inquilino_nome text not null,
  inquilino_doc text,
  inquilino_telefone text,
  inquilino_email text,
  valor_aluguel numeric(14,2) not null check (valor_aluguel > 0),
  taxa_administracao numeric(5,2) not null default 10 check (taxa_administracao between 0 and 100),
  dia_vencimento int not null default 10 check (dia_vencimento between 1 and 28),
  dias_repasse int not null default 5 check (dias_repasse between 0 and 60),
  inicio date not null default current_date,
  fim date,
  indice_reajuste text default 'IGP-M',
  garantia text,
  contrato_url text,
  conta_bancaria_id uuid references public.contas_bancarias(id),
  responsavel uuid references public.profiles(user_id),
  status text not null default 'ativo' check (status in ('ativo', 'suspenso', 'encerrado')),
  observacoes text,
  criado_por uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_contratos_locacao_status on public.contratos_locacao (status);
drop trigger if exists trg_contratos_locacao_touch on public.contratos_locacao;
create trigger trg_contratos_locacao_touch before update on public.contratos_locacao for each row execute function fn_touch_updated_at();

create table if not exists public.alugueis_parcelas (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos_locacao(id) on delete cascade,
  competencia date not null,
  vencimento date not null,
  valor numeric(14,2) not null check (valor >= 0),
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'atrasado', 'cancelado')),
  pago_em date,
  valor_pago numeric(14,2),
  valor_repasse numeric(14,2),
  repasse_vencimento date,
  repasse_status text not null default 'pendente' check (repasse_status in ('pendente', 'repassado', 'retido')),
  repasse_em date,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contrato_id, competencia)
);
create index if not exists idx_alugueis_parcelas_venc on public.alugueis_parcelas (status, vencimento);
drop trigger if exists trg_alugueis_parcelas_touch on public.alugueis_parcelas;
create trigger trg_alugueis_parcelas_touch before update on public.alugueis_parcelas for each row execute function fn_touch_updated_at();

-- pagamento e repasse viram lançamentos (entrada do aluguel, saída do repasse);
-- a diferença que fica é a taxa de administração
create or replace function public.trg_aluguel_lancamentos() returns trigger
language plpgsql security definer set search_path = public as $$
declare c contratos_locacao%rowtype;
begin
  select * into c from contratos_locacao where id = new.contrato_id;
  if new.status = 'pago' and (tg_op = 'INSERT' or old.status is distinct from 'pago') then
    perform fn_lancar('aluguel', new.id, coalesce(new.pago_em, current_date),
      c.codigo || ' · aluguel ' || to_char(new.competencia, 'MM/YYYY') || ' · ' || c.inquilino_nome,
      '2.1', null, null, 'entrada', coalesce(new.valor_pago, new.valor));
    if c.conta_bancaria_id is not null then
      update lancamentos_contabeis set conta_bancaria_id = c.conta_bancaria_id where origem = 'aluguel' and origem_id = new.id and not estornado;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pago' and new.status <> 'pago' then
    perform fn_estornar('aluguel', new.id);
  end if;
  if new.repasse_status = 'repassado' and (tg_op = 'INSERT' or old.repasse_status is distinct from 'repassado') then
    perform fn_lancar('repasse_aluguel', new.id, coalesce(new.repasse_em, current_date),
      c.codigo || ' · repasse ' || to_char(new.competencia, 'MM/YYYY') || ' · ' || c.proprietario_nome,
      '2.1', null, null, 'saida', coalesce(new.valor_repasse, 0));
    if c.conta_bancaria_id is not null then
      update lancamentos_contabeis set conta_bancaria_id = c.conta_bancaria_id where origem = 'repasse_aluguel' and origem_id = new.id and not estornado;
    end if;
  elsif tg_op = 'UPDATE' and old.repasse_status = 'repassado' and new.repasse_status <> 'repassado' then
    perform fn_estornar('repasse_aluguel', new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_alugueis_parcelas_lancamentos on public.alugueis_parcelas;
create trigger trg_alugueis_parcelas_lancamentos after insert or update of status, repasse_status on public.alugueis_parcelas
  for each row execute function public.trg_aluguel_lancamentos();

-- parcela de um mês de um contrato (idempotente)
create or replace function public.fn_aluguel_gerar_parcela(p_contrato uuid, p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c contratos_locacao%rowtype;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_venc date;
  v_id uuid;
begin
  select * into c from contratos_locacao where id = p_contrato;
  if not found or c.status <> 'ativo' then return null; end if;
  if v_comp < date_trunc('month', c.inicio)::date or (c.fim is not null and v_comp > c.fim) then return null; end if;
  v_venc := v_comp + (c.dia_vencimento - 1);
  insert into alugueis_parcelas (contrato_id, competencia, vencimento, valor, valor_repasse, repasse_vencimento)
  values (c.id, v_comp, v_venc, c.valor_aluguel,
          round(c.valor_aluguel * (1 - c.taxa_administracao / 100), 2), v_venc + c.dias_repasse)
  on conflict (contrato_id, competencia) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.fn_aluguel_gerar_parcela(uuid, date) from public, anon, authenticated;
grant execute on function public.fn_aluguel_gerar_parcela(uuid, date) to service_role;

-- rotina do worker: gera o mês atual e o próximo, marca atraso, cobra repasse
create or replace function public.fn_alugueis_rotina() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  for r in select id from contratos_locacao where status = 'ativo' loop
    if fn_aluguel_gerar_parcela(r.id, hoje) is not null then n := n + 1; end if;
    if fn_aluguel_gerar_parcela(r.id, (date_trunc('month', hoje) + interval '1 month')::date) is not null then n := n + 1; end if;
  end loop;

  update alugueis_parcelas set status = 'atrasado' where status = 'pendente' and vencimento < hoje;

  for r in
    select p.id, p.vencimento, p.competencia, c.codigo, c.inquilino_nome, c.responsavel
    from alugueis_parcelas p join contratos_locacao c on c.id = p.contrato_id
    where p.status = 'atrasado' and p.vencimento < hoje - 2
  loop
    if fn_tarefa_automatica('aluguel_atrasado:' || r.id, 'aluguel_atrasado', 'financeiro',
         'Cobrar aluguel atrasado ' || r.codigo || ' (' || to_char(r.competencia, 'MM/YYYY') || ')',
         r.inquilino_nome || ' não pagou o aluguel com vencimento em ' || to_char(r.vencimento, 'DD/MM/YYYY') || '. Veja em Financeiro > Aluguéis.',
         r.responsavel, hoje, 'alta') is not null then n := n + 1; end if;
  end loop;

  for r in
    select p.id, p.repasse_vencimento, p.competencia, c.codigo, c.proprietario_nome, c.responsavel
    from alugueis_parcelas p join contratos_locacao c on c.id = p.contrato_id
    where p.status = 'pago' and p.repasse_status = 'pendente' and p.repasse_vencimento <= hoje
  loop
    if fn_tarefa_automatica('aluguel_repasse:' || r.id, 'aluguel_repasse', 'financeiro',
         'Repassar aluguel ' || r.codigo || ' (' || to_char(r.competencia, 'MM/YYYY') || ') ao proprietário',
         'Repasse a ' || r.proprietario_nome || ' previsto para ' || to_char(r.repasse_vencimento, 'DD/MM/YYYY') || '. Veja em Financeiro > Aluguéis.',
         r.responsavel, r.repasse_vencimento, 'alta') is not null then n := n + 1; end if;
  end loop;

  -- contrato que termina em 60 dias: renovar ou encerrar
  for r in select id, codigo, fim, inquilino_nome, responsavel from contratos_locacao
           where status = 'ativo' and fim is not null and fim between hoje and hoje + 60 loop
    if fn_tarefa_automatica('aluguel_vencendo:' || r.id || ':' || r.fim, 'aluguel_vencendo', 'juridico',
         'Contrato de locação ' || r.codigo || ' termina em ' || to_char(r.fim, 'DD/MM/YYYY'),
         'Combinar renovação ou entrega das chaves com ' || r.inquilino_nome || '.', r.responsavel, r.fim - 30, 'normal') is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.fn_alugueis_rotina() from public, anon, authenticated;
grant execute on function public.fn_alugueis_rotina() to service_role;

alter table public.contratos_locacao enable row level security;
alter table public.alugueis_parcelas enable row level security;

-- ===========================================================================
-- 3. Fluxo do imóvel: captação (Operações) → Marketing → aprovação da Diretoria
-- ===========================================================================
alter table public.properties add column if not exists marketing_status text
  check (marketing_status in ('enviado', 'em_producao', 'aguardando_aprovacao', 'ajustes', 'aprovado'));
alter table public.properties add column if not exists marketing_enviado_em timestamptz;
alter table public.properties add column if not exists marketing_aprovado_em timestamptz;
alter table public.properties add column if not exists marketing_aprovado_por uuid references public.profiles(user_id);
alter table public.properties add column if not exists marketing_material jsonb not null default '[]';
create index if not exists idx_properties_marketing_status on public.properties (marketing_status) where marketing_status is not null;

create table if not exists public.imovel_fluxo_eventos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  acao text not null,
  de_status text,
  para_status text,
  texto text,
  para_setor text,
  autor uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_imovel_fluxo_eventos on public.imovel_fluxo_eventos (property_id, created_at);
alter table public.imovel_fluxo_eventos enable row level security;

-- ligado = Operações só publica imóvel com o material aprovado pela Diretoria
insert into public.settings (chave, valor) values ('publicacao_exige_marketing', 'false'::jsonb)
on conflict (chave) do nothing;

-- ===========================================================================
-- 4. Instagram e Messenger no Atendimento
-- ===========================================================================
-- Conversa de rede social guarda o id da pessoa no lugar do telefone, com
-- prefixo ("ig:123", "fb:456"), e o canal diz por onde responder.
alter table public.atendimento_conversas add column if not exists canal text not null default 'whatsapp'
  check (canal in ('whatsapp', 'instagram', 'messenger'));
alter table public.whatsapp_mensagens add column if not exists canal text not null default 'whatsapp';

-- transferência entre contas não é receita nem despesa: fica fora do resultado
create or replace function fn_resultado_mensal(p_meses int default 12)
returns table (mes text, entradas numeric, saidas numeric, saldo numeric)
language sql stable security definer set search_path = public as $$
  with meses as (
    select to_char(d, 'YYYY-MM') mes from generate_series(
      date_trunc('month', current_date) - make_interval(months => greatest(p_meses, 1) - 1),
      date_trunc('month', current_date), interval '1 month') d
  )
  select m.mes,
    coalesce(sum(l.valor) filter (where l.natureza = 'entrada'), 0),
    coalesce(sum(l.valor) filter (where l.natureza = 'saida'), 0),
    coalesce(sum(case when l.natureza = 'entrada' then l.valor else -l.valor end), 0)
  from meses m
  left join lancamentos_contabeis l on to_char(l.data, 'YYYY-MM') = m.mes and not l.estornado and l.origem <> 'transferencia'
  group by m.mes order by m.mes desc;
$$;
revoke all on function fn_resultado_mensal(int) from public, anon, authenticated;
grant execute on function fn_resultado_mensal(int) to service_role;
