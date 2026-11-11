-- 0067 · Central de CRMs, etapa 3: pessoas e comunicação.
-- Ponto eletrônico (marcação imutável e encadeada, ajustes com aprovação,
-- espelho), notificações em 3 níveis, conversa dentro do registro e
-- capacidade de trabalho por pessoa. Idempotente.

-- ---------------------------------------------------------------- ponto
create table if not exists ponto_jornadas (
  user_id uuid primary key references profiles(user_id) on delete cascade,
  carga_diaria_min int not null default 480 check (carga_diaria_min between 60 and 720),
  intervalo_min int not null default 60 check (intervalo_min between 0 and 240),
  dias_semana int[] not null default '{1,2,3,4,5}',
  entrada_prevista time not null default '08:00',
  tolerancia_min int not null default 10 check (tolerancia_min between 0 and 60),
  ativo boolean not null default true,
  updated_at timestamptz not null default now()
);

create sequence if not exists ponto_nsr_seq;
create table if not exists ponto_marcacoes (
  id uuid primary key default gen_random_uuid(),
  nsr bigint not null unique default nextval('ponto_nsr_seq'),
  user_id uuid not null references profiles(user_id),
  marcado_em timestamptz not null default now(),
  origem text not null default 'web' check (origem in ('web','offline','ajuste')),
  ip text,
  user_agent text,
  latitude double precision,
  longitude double precision,
  precisao_m double precision,
  ajuste_id uuid,
  hash text,
  hash_anterior text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ponto_user_dia on ponto_marcacoes (user_id, marcado_em);

-- cada marcação carrega o hash da anterior: apagar ou trocar uma quebra a cadeia
create or replace function trg_ponto_hash() returns trigger language plpgsql as $$
declare v_ant text;
begin
  perform pg_advisory_xact_lock(hashtext('ponto_marcacoes'));
  select hash into v_ant from ponto_marcacoes order by nsr desc limit 1;
  new.hash_anterior := coalesce(v_ant, '');
  new.hash := encode(sha256(convert_to(
    coalesce(v_ant, '') || '|' || new.nsr || '|' || new.user_id || '|' || to_char(new.marcado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'UTF8')), 'hex');
  return new;
end $$;
drop trigger if exists trg_ponto_marcacoes_hash on ponto_marcacoes;
create trigger trg_ponto_marcacoes_hash before insert on ponto_marcacoes for each row execute function trg_ponto_hash();

create or replace function trg_ponto_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'Marcação de ponto não pode ser alterada nem apagada. Use um ajuste.';
end $$;
drop trigger if exists trg_ponto_marcacoes_imutavel on ponto_marcacoes;
create trigger trg_ponto_marcacoes_imutavel before update or delete on ponto_marcacoes for each row execute function trg_ponto_imutavel();

create table if not exists ponto_ajustes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id),
  tipo text not null check (tipo in ('incluir','desconsiderar','abono')),
  horario timestamptz,
  marcacao_id uuid references ponto_marcacoes(id),
  data date not null,
  motivo text not null,
  status text not null default 'pendente' check (status in ('pendente','aprovado','reprovado')),
  decidido_por uuid references profiles(user_id),
  decidido_em timestamptz,
  resposta text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ponto_ajustes_status on ponto_ajustes (status, created_at);

alter table ponto_jornadas enable row level security;
alter table ponto_marcacoes enable row level security;
alter table ponto_ajustes enable row level security;

-- ------------------------------------------------------- notificações
create table if not exists notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  nivel text not null default 'info' check (nivel in ('info','atencao','critico')),
  titulo text not null,
  texto text,
  link text,
  chave text,
  lida_em timestamptz,
  email_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_notificacoes_chave on notificacoes (user_id, chave) where chave is not null;
create index if not exists idx_notificacoes_user on notificacoes (user_id, lida_em, created_at desc);
alter table notificacoes enable row level security;

create or replace function fn_notificar(p_user uuid, p_nivel text, p_titulo text, p_texto text, p_link text, p_chave text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into notificacoes (user_id, nivel, titulo, texto, link, chave)
  values (p_user, p_nivel, left(p_titulo, 200), left(p_texto, 1000), p_link, p_chave)
  on conflict (user_id, chave) where chave is not null do nothing;
end $$;
revoke all on function fn_notificar(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function fn_notificar(uuid, text, text, text, text, text) to service_role;

-- tarefa com responsável novo, tarefa encaminhada e tarefa escalonada avisam
create or replace function trg_tarefa_notifica() returns trigger language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if new.responsavel is not null and (tg_op = 'INSERT' or new.responsavel is distinct from old.responsavel) then
    perform fn_notificar(new.responsavel, case when new.prioridade = 'alta' then 'atencao' else 'info' end,
      'Tarefa para você: ' || new.titulo, new.descricao, '/admin/tarefas/' || new.id, 'tarefa:' || new.id || ':' || new.responsavel);
  end if;
  if new.origem = 'encaminhada' and new.aceite_em is null and new.responsavel is null and tg_op = 'INSERT' then
    for m in select user_id from profiles where ativo and role = 'analista_arini' and new.setor = any(setores) loop
      perform fn_notificar(m.user_id, 'atencao', 'Tarefa encaminhada ao seu setor: ' || new.titulo, new.descricao,
        '/admin/tarefas/' || new.id, 'encaminhada:' || new.id);
    end loop;
  end if;
  if new.escalonada_em is not null and (tg_op = 'INSERT' or old.escalonada_em is null) then
    for m in select user_id from profiles where ativo and role = 'admin_central' loop
      perform fn_notificar(m.user_id, 'critico', 'Tarefa sem aceite subiu para a Diretoria: ' || new.titulo, null,
        '/admin/tarefas/' || new.id, 'escalonada:' || new.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_tasks_notifica on tasks;
create trigger trg_tasks_notifica after insert or update of responsavel, escalonada_em on tasks
  for each row execute function trg_tarefa_notifica();

create or replace function trg_lead_notifica() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.responsavel_user_id is not null and new.responsavel_user_id is distinct from old.responsavel_user_id then
    perform fn_notificar(new.responsavel_user_id, 'atencao', 'Lead novo para você: ' || new.codigo,
      'Faça o primeiro contato dentro do prazo do rodízio.', '/admin/oportunidades/' || new.id,
      'lead:' || new.id || ':' || new.responsavel_user_id || ':' || coalesce(new.rodizio_tentativas, 0));
  end if;
  return new;
end $$;
drop trigger if exists trg_opportunities_notifica on opportunities;
create trigger trg_opportunities_notifica after update of responsavel_user_id on opportunities
  for each row execute function trg_lead_notifica();

-- ------------------------------------------- conversa dentro do registro
create table if not exists registro_mensagens (
  id uuid primary key default gen_random_uuid(),
  entidade text not null check (entidade in ('opportunities','properties','tasks','despesas','crm_itens')),
  entidade_id uuid not null,
  autor uuid not null references profiles(user_id),
  texto text not null check (length(texto) between 1 and 4000),
  mencoes uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_registro_mensagens on registro_mensagens (entidade, entidade_id, created_at);
alter table registro_mensagens enable row level security;

-- ------------------------------------------------------------ capacidade
alter table profiles add column if not exists capacidade_tarefas int not null default 15;

-- ----------------------------------------------------------------- regras
-- ponto incompleto ontem (número ímpar de marcações) e ajustes parados
create or replace function fn_central_pessoas_regras() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_ontem date := (now() at time zone 'America/Sao_Paulo')::date - 1;
begin
  for r in
    select j.user_id, count(m.id) qtd
    from ponto_jornadas j
    left join ponto_marcacoes m on m.user_id = j.user_id
      and (m.marcado_em at time zone 'America/Sao_Paulo')::date = v_ontem
    where j.ativo and extract(isodow from v_ontem)::int = any(j.dias_semana)
    group by j.user_id
    having count(m.id) % 2 = 1
  loop
    if not exists (select 1 from notificacoes where user_id = r.user_id and chave = 'ponto_incompleto:' || v_ontem) then
      perform fn_notificar(r.user_id, 'atencao', 'Ponto de ontem ficou incompleto',
        'Há uma marcação sem par em ' || to_char(v_ontem, 'DD/MM') || '. Peça um ajuste no espelho de ponto.', '/admin/ponto',
        'ponto_incompleto:' || v_ontem);
      n := n + 1;
    end if;
  end loop;
  for r in select id, user_id, data from ponto_ajustes where status = 'pendente' and created_at < now() - interval '2 days' loop
    if fn_tarefa_automatica('ponto_ajuste:' || r.id, 'ajuste_ponto_parado', 'diretoria',
        'Decidir ajuste de ponto de ' || to_char(r.data, 'DD/MM'), null, null, current_date + 1, 'normal', null, null) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function fn_central_pessoas_regras() from public, anon, authenticated;

create or replace function fn_central_modulos() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'despesas_cobradas', fn_central_financeiro_regras(),
    'avisos_de_ponto', fn_central_pessoas_regras());
end $$;
revoke all on function fn_central_modulos() from public, anon, authenticated;
grant execute on function fn_central_modulos() to service_role;

-- --------------------------------------------- IA proativa: resumo do dia
-- Um resumo por pessoa e escopo por dia (cache: a IA só roda uma vez).
create table if not exists ia_resumos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  escopo text not null,
  dia date not null,
  texto text not null,
  modelo text,
  created_at timestamptz not null default now(),
  unique (user_id, escopo, dia)
);
alter table ia_resumos enable row level security;
