-- 0069 · Central de CRMs, etapa 5: motor de CRM configurável por setor.
-- Cada setor monta os seus funis (etapas com prazo, campos próprios, campo
-- exigido a partir de certa etapa) sem programação. Itens com histórico,
-- prazo por etapa e cobrança automática quando o prazo estoura. Idempotente.

create table if not exists crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  setor text not null,
  nome text not null,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists crm_etapas (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references crm_pipelines(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  sla_horas int check (sla_horas is null or sla_horas between 1 and 8760),
  final boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_crm_etapas_pipeline on crm_etapas (pipeline_id, ordem);

create table if not exists crm_campos (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references crm_pipelines(id) on delete cascade,
  chave text not null,
  rotulo text not null,
  tipo text not null default 'texto' check (tipo in ('texto','textarea','numero','dinheiro','data','select','bool')),
  opcoes text[] not null default '{}',
  exigido_desde uuid references crm_etapas(id) on delete set null,
  ordem int not null default 0,
  unique (pipeline_id, chave)
);

create sequence if not exists crm_item_codigo_seq;
create table if not exists crm_itens (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('CR-' || lpad(nextval('crm_item_codigo_seq')::text, 6, '0')),
  pipeline_id uuid not null references crm_pipelines(id) on delete cascade,
  etapa_id uuid references crm_etapas(id) on delete set null,
  titulo text not null,
  descricao text,
  responsavel uuid references profiles(user_id),
  dados jsonb not null default '{}',
  prazo_etapa timestamptz,
  entrou_etapa_em timestamptz not null default now(),
  status text not null default 'aberto' check (status in ('aberto','concluido','cancelado')),
  property_id uuid references properties(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  criado_por uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_crm_itens_pipeline on crm_itens (pipeline_id, status, etapa_id);
create index if not exists idx_crm_itens_resp on crm_itens (responsavel, status);
drop trigger if exists trg_crm_itens_touch on crm_itens;
create trigger trg_crm_itens_touch before update on crm_itens for each row execute function fn_touch_updated_at();

create table if not exists crm_item_eventos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references crm_itens(id) on delete cascade,
  tipo text not null,
  autor uuid references profiles(user_id),
  texto text,
  dados jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_crm_item_eventos on crm_item_eventos (item_id, created_at);

alter table crm_pipelines enable row level security;
alter table crm_etapas enable row level security;
alter table crm_campos enable row level security;
alter table crm_itens enable row level security;
alter table crm_item_eventos enable row level security;

-- notifica o responsável quando recebe um item
create or replace function trg_crm_item_notifica() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.responsavel is not null and (tg_op = 'INSERT' or new.responsavel is distinct from old.responsavel) then
    perform fn_notificar(new.responsavel, 'info', 'Item de CRM para você: ' || new.titulo, null,
      '/admin/crm/item/' || new.id, 'crm:' || new.id || ':' || new.responsavel);
  end if;
  return new;
end $$;
drop trigger if exists trg_crm_itens_notifica on crm_itens;
create trigger trg_crm_itens_notifica after insert or update of responsavel on crm_itens
  for each row execute function trg_crm_item_notifica();

-- modelos iniciais (só se ainda não existe nenhum funil)
do $$
declare p uuid;
begin
  if exists (select 1 from crm_pipelines) then return; end if;

  insert into crm_pipelines (setor, nome, descricao) values ('juridico', 'Análise documental', 'Documentos do imóvel e do negócio até a liberação.') returning id into p;
  insert into crm_etapas (pipeline_id, nome, ordem, sla_horas, final) values
    (p, 'Recebido', 1, 24, false), (p, 'Em análise', 2, 72, false), (p, 'Pendência com o cliente', 3, 120, false),
    (p, 'Liberado', 4, null, true);
  insert into crm_campos (pipeline_id, chave, rotulo, tipo, ordem) values
    (p, 'matricula', 'Matrícula', 'texto', 1), (p, 'pendencias', 'Pendências encontradas', 'textarea', 2);

  insert into crm_pipelines (setor, nome, descricao) values ('operacoes', 'Captação de imóveis', 'Do primeiro contato com o proprietário até o anúncio no ar.') returning id into p;
  insert into crm_etapas (pipeline_id, nome, ordem, sla_horas, final) values
    (p, 'Contato', 1, 48, false), (p, 'Visita de captação', 2, 120, false), (p, 'Documentação', 3, 168, false),
    (p, 'Anúncio no ar', 4, null, true);
  insert into crm_campos (pipeline_id, chave, rotulo, tipo, ordem) values
    (p, 'proprietario', 'Proprietário', 'texto', 1), (p, 'telefone', 'Telefone', 'texto', 2), (p, 'valor_pedido', 'Valor pedido', 'dinheiro', 3);

  insert into crm_pipelines (setor, nome, descricao) values ('cartografia', 'Levantamentos', 'Pedidos de levantamento, georreferenciamento e mapas.') returning id into p;
  insert into crm_etapas (pipeline_id, nome, ordem, sla_horas, final) values
    (p, 'Pedido', 1, 24, false), (p, 'Em campo', 2, 168, false), (p, 'Processamento', 3, 72, false), (p, 'Entregue', 4, null, true);

  insert into crm_pipelines (setor, nome, descricao) values ('marketing', 'Produção de conteúdo', 'Fotos, vídeos e textos dos imóveis.') returning id into p;
  insert into crm_etapas (pipeline_id, nome, ordem, sla_horas, final) values
    (p, 'Pauta', 1, 48, false), (p, 'Produção', 2, 120, false), (p, 'Revisão', 3, 24, false), (p, 'Pronto', 4, null, true);
end $$;

-- prazo da etapa estourado vira tarefa do setor (uma por item e etapa)
create or replace function fn_central_crm_regras() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select i.id, i.codigo, i.titulo, i.responsavel, i.etapa_id, e.nome etapa, p.setor
    from crm_itens i join crm_etapas e on e.id = i.etapa_id join crm_pipelines p on p.id = i.pipeline_id
    where i.status = 'aberto' and i.prazo_etapa < now() and not e.final
  loop
    if fn_tarefa_automatica('crm_sla:' || r.id || ':' || r.etapa_id, 'crm_prazo_etapa', r.setor,
        'Prazo estourado em "' || r.etapa || '": ' || r.codigo, r.titulo, r.responsavel, current_date, 'alta', null, null) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function fn_central_crm_regras() from public, anon, authenticated;

create or replace function fn_central_modulos() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'despesas_cobradas', fn_central_financeiro_regras(),
    'avisos_de_ponto', fn_central_pessoas_regras(),
    'marketing_e_whatsapp', fn_central_marketing_regras(),
    'prazos_de_crm', fn_central_crm_regras());
end $$;
revoke all on function fn_central_modulos() from public, anon, authenticated;
grant execute on function fn_central_modulos() to service_role;
