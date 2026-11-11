-- 0066 · Central de CRMs, etapa 2: financeiro central e central fiscal.
-- Despesas com aprovação por alçada, fornecedores, centros de custo, plano de
-- contas, lançamentos contábeis automáticos (despesa paga, comissão recebida,
-- mensalidade paga) e notas fiscais de serviço (emissão pelo Asaas, ligada por
-- configuração). Idempotente: pode rodar de novo.

create table if not exists centros_custo (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  setor text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists plano_contas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  tipo text not null check (tipo in ('receita','despesa','ativo','passivo')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf_cnpj text,
  email text,
  telefone text,
  pix text,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence if not exists despesa_codigo_seq;
create table if not exists despesas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('DP-' || lpad(nextval('despesa_codigo_seq')::text, 6, '0')),
  descricao text not null,
  fornecedor_id uuid references fornecedores(id),
  centro_custo_id uuid references centros_custo(id),
  conta_id uuid references plano_contas(id),
  valor numeric(14,2) not null check (valor > 0),
  competencia date not null default current_date,
  vencimento date,
  forma_pagamento text,
  documento text,
  recorrente boolean not null default false,
  status text not null default 'pendente'
    check (status in ('pendente','aprovada','reprovada','paga','cancelada')),
  solicitante uuid references profiles(user_id),
  aprovado_por uuid references profiles(user_id),
  aprovado_em timestamptz,
  motivo text,
  pago_em date,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_despesas_status on despesas (status, vencimento);
drop trigger if exists trg_despesas_touch on despesas;
create trigger trg_despesas_touch before update on despesas for each row execute function fn_touch_updated_at();

create table if not exists lancamentos_contabeis (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  historico text not null,
  conta_id uuid references plano_contas(id),
  centro_custo_id uuid references centros_custo(id),
  natureza text not null check (natureza in ('entrada','saida')),
  valor numeric(14,2) not null check (valor > 0),
  origem text not null default 'manual',
  origem_id uuid,
  estornado boolean not null default false,
  criado_por uuid references profiles(user_id),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_lancamento_origem on lancamentos_contabeis (origem, origem_id) where origem_id is not null and not estornado;
create index if not exists idx_lancamentos_data on lancamentos_contabeis (data);

create sequence if not exists nota_fiscal_codigo_seq;
create table if not exists notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('NF-' || lpad(nextval('nota_fiscal_codigo_seq')::text, 6, '0')),
  tomador_nome text not null,
  tomador_doc text not null,
  tomador_email text,
  descricao text not null,
  valor numeric(14,2) not null check (valor > 0),
  origem text not null default 'manual' check (origem in ('manual','comissao','mensalidade')),
  origem_id uuid,
  status text not null default 'rascunho' check (status in ('rascunho','enviada','emitida','cancelada','erro')),
  gateway_id text,
  numero text,
  pdf_url text,
  xml_url text,
  erro text,
  emitida_em timestamptz,
  criado_por uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_nf_status on notas_fiscais (status);
drop trigger if exists trg_nf_touch on notas_fiscais;
create trigger trg_nf_touch before update on notas_fiscais for each row execute function fn_touch_updated_at();

alter table centros_custo enable row level security;
alter table plano_contas enable row level security;
alter table fornecedores enable row level security;
alter table despesas enable row level security;
alter table lancamentos_contabeis enable row level security;
alter table notas_fiscais enable row level security;

-- configurações
insert into settings (chave, valor) values
  ('despesa_alcada_diretoria', '5000'),
  ('nf_servico_codigo', '""'),
  ('nf_servico_nome', '"Intermediação de negócios imobiliários"'),
  ('nf_iss_aliquota', '2'),
  ('nf_emitir_automatico', 'false')
on conflict (chave) do nothing;

-- plano de contas e centros de custo iniciais (a Diretoria ajusta na tela)
insert into plano_contas (codigo, nome, tipo) values
  ('1.1', 'Caixa e bancos', 'ativo'),
  ('3.1', 'Comissões de intermediação', 'receita'),
  ('3.2', 'Mensalidades de anúncio', 'receita'),
  ('3.9', 'Outras receitas', 'receita'),
  ('4.1', 'Pessoal e encargos', 'despesa'),
  ('4.2', 'Marketing e anúncios', 'despesa'),
  ('4.3', 'Tecnologia e sistemas', 'despesa'),
  ('4.4', 'Aluguel e estrutura', 'despesa'),
  ('4.5', 'Impostos e taxas', 'despesa'),
  ('4.6', 'Deslocamento e visitas', 'despesa'),
  ('4.9', 'Outras despesas', 'despesa')
on conflict (codigo) do nothing;

insert into centros_custo (nome, setor) values
  ('Diretoria', 'diretoria'), ('Operações', 'operacoes'), ('Comercial', 'comercial'),
  ('Financeiro', 'financeiro'), ('Jurídico', 'juridico'), ('Marketing', 'marketing'),
  ('Cartografia e dados', 'cartografia'), ('Suporte', 'suporte'), ('Segurança', 'seguranca')
on conflict (nome) do nothing;

-- ---------------------------------------------------------------------------
-- Lançamentos automáticos: cada fato financeiro vira um lançamento só.
-- ---------------------------------------------------------------------------
create or replace function fn_lancar(p_origem text, p_origem_id uuid, p_data date, p_historico text,
  p_conta_codigo text, p_conta_id uuid, p_centro uuid, p_natureza text, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_conta uuid := p_conta_id;
begin
  if v_conta is null and p_conta_codigo is not null then
    select id into v_conta from plano_contas where codigo = p_conta_codigo;
  end if;
  if exists (select 1 from lancamentos_contabeis where origem = p_origem and origem_id = p_origem_id and not estornado) then
    return;
  end if;
  insert into lancamentos_contabeis (data, historico, conta_id, centro_custo_id, natureza, valor, origem, origem_id)
  values (coalesce(p_data, current_date), p_historico, v_conta, p_centro, p_natureza, p_valor, p_origem, p_origem_id);
end $$;

create or replace function fn_estornar(p_origem text, p_origem_id uuid)
returns void language sql security definer set search_path = public as $$
  update lancamentos_contabeis set estornado = true where origem = p_origem and origem_id = p_origem_id and not estornado;
$$;

create or replace function trg_despesa_lancamento() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paga' and (tg_op = 'INSERT' or old.status is distinct from 'paga') then
    perform fn_lancar('despesa', new.id, coalesce(new.pago_em, current_date),
      new.codigo || ' · ' || new.descricao, '4.9', new.conta_id, new.centro_custo_id, 'saida', new.valor);
  elsif tg_op = 'UPDATE' and old.status = 'paga' and new.status <> 'paga' then
    perform fn_estornar('despesa', new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_despesas_lancamento on despesas;
create trigger trg_despesas_lancamento after insert or update of status on despesas
  for each row execute function trg_despesa_lancamento();

create or replace function trg_comissao_lancamento() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('paga','conciliada') and old.status not in ('paga','conciliada') then
    perform fn_lancar('comissao', new.id, coalesce(new.pago_em, current_date),
      'Comissão recebida', '3.1', null, (select id from centros_custo where setor = 'comercial' limit 1), 'entrada', new.valor);
  elsif old.status in ('paga','conciliada') and new.status not in ('paga','conciliada') then
    perform fn_estornar('comissao', new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_commissions_lancamento on commissions;
create trigger trg_commissions_lancamento after update of status on commissions
  for each row execute function trg_comissao_lancamento();

create or replace function trg_fatura_lancamento() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paga' and old.status is distinct from 'paga' then
    perform fn_lancar('mensalidade', new.id, coalesce(new.pago_em, current_date),
      'Mensalidade de anúncio ' || to_char(new.competencia, 'MM/YYYY'), '3.2', null,
      (select id from centros_custo where setor = 'operacoes' limit 1), 'entrada', new.valor);
  elsif old.status = 'paga' and new.status <> 'paga' then
    perform fn_estornar('mensalidade', new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_invoices_lancamento on invoices;
create trigger trg_invoices_lancamento after update of status on invoices
  for each row execute function trg_fatura_lancamento();

-- carga inicial: o que já foi recebido antes desta migration
insert into lancamentos_contabeis (data, historico, conta_id, natureza, valor, origem, origem_id)
select coalesce(c.pago_em, c.updated_at::date), 'Comissão recebida', (select id from plano_contas where codigo = '3.1'),
       'entrada', c.valor, 'comissao', c.id
from commissions c
where c.status in ('paga','conciliada') and c.valor > 0
  and not exists (select 1 from lancamentos_contabeis l where l.origem = 'comissao' and l.origem_id = c.id);
insert into lancamentos_contabeis (data, historico, conta_id, natureza, valor, origem, origem_id)
select coalesce(i.pago_em, i.competencia), 'Mensalidade de anúncio ' || to_char(i.competencia, 'MM/YYYY'),
       (select id from plano_contas where codigo = '3.2'), 'entrada', i.valor, 'mensalidade', i.id
from invoices i
where i.status = 'paga' and i.valor > 0
  and not exists (select 1 from lancamentos_contabeis l where l.origem = 'mensalidade' and l.origem_id = i.id);

-- Resultado por mês (painel da Diretoria): entradas, saídas e saldo.
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
  left join lancamentos_contabeis l on to_char(l.data, 'YYYY-MM') = m.mes and not l.estornado
  group by m.mes order by m.mes desc;
$$;

revoke all on function fn_lancar(text, uuid, date, text, text, uuid, uuid, text, numeric) from public, anon, authenticated;
revoke all on function fn_estornar(text, uuid) from public, anon, authenticated;
revoke all on function fn_resultado_mensal(int) from public, anon, authenticated;
grant execute on function fn_resultado_mensal(int) to service_role;

-- despesas vencidas sem pagamento viram tarefa do Financeiro (regra das automações)
create or replace function fn_central_financeiro_regras() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id, codigo, descricao, valor, vencimento from despesas
           where status = 'aprovada' and vencimento < current_date loop
    if fn_tarefa_automatica('despesa_vencida:' || r.id, 'despesa_vencida', 'financeiro',
        'Pagar despesa vencida ' || r.codigo, r.descricao || ' · R$ ' || to_char(r.valor, 'FM999G999G990D00'),
        null, current_date + 1, 'alta', null, null) is not null then n := n + 1; end if;
  end loop;
  for r in select id, codigo, descricao from despesas
           where status = 'pendente' and created_at < now() - interval '2 days' loop
    if fn_tarefa_automatica('despesa_aprovacao:' || r.id, 'despesa_sem_aprovacao', 'diretoria',
        'Aprovar despesa ' || r.codigo, r.descricao, null, current_date + 1, 'normal', null, null) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function fn_central_financeiro_regras() from public, anon, authenticated;
grant execute on function fn_central_financeiro_regras() to service_role;

-- Regras dos módulos novos, chamadas junto com fn_central_automacoes (worker e
-- botão "Rodar agora"). Cada etapa redefine esta função somando as suas regras.
create or replace function fn_central_modulos() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object('despesas_cobradas', fn_central_financeiro_regras());
end $$;
revoke all on function fn_central_modulos() from public, anon, authenticated;
grant execute on function fn_central_modulos() to service_role;
