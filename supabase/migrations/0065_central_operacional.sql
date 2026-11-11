-- Arini Imóveis Brasil — migration 0065: Central operacional (bloco 1 da "Central de CRMs").
--
-- Pedido do Carlos (PDF "Desenvolvimento geral Central de CRMs ARINI", 63 páginas,
-- 11/11/2026). Este bloco cresce a Matriz que já existe (migration 0024) em vez
-- de criar outro sistema, como o próprio documento pede ("não duplicar CRMs,
-- bancos ou motores de tarefas"):
--
--   1. Tarefas com origem (manual, encaminhada, automática), código, encaminhamento
--      entre setores com aceite e prazo para assumir, recusa justificada,
--      evidência de conclusão e linha do tempo (task_events).
--   2. Rodízio automático de leads entre os corretores da equipe, com prazo para
--      o primeiro atendimento; sem atendimento, o lead passa para o próximo.
--   3. Relatório estruturado depois da visita, com o resumo que o proprietário vê.
--   4. Automações por evento, sem tarefa duplicada (chave_evento única) e com
--      registro em audit_log: lead sem atendimento, visita sem relatório,
--      encaminhamento sem aceite e cadastro parado em análise.
--   5. Ranking de imóveis (audiência e oportunidade) do dia, da semana e do mês.
--
-- Tudo aditivo: colunas com padrão, tabelas e funções novas. O site atual segue
-- funcionando antes do deploy.

-- ===========================================================================
-- 1. Tarefas
-- ===========================================================================
create sequence if not exists task_codigo_seq;
alter table tasks add column if not exists codigo text;
update tasks set codigo = 'TF-' || lpad(nextval('task_codigo_seq')::text, 6, '0') where codigo is null;
alter table tasks alter column codigo set default ('TF-' || lpad(nextval('task_codigo_seq')::text, 6, '0'));
create unique index if not exists uq_tasks_codigo on tasks (codigo);

alter table tasks
  add column if not exists origem text not null default 'manual',
  add column if not exists setor_origem text,
  add column if not exists aceite_em timestamptz,
  add column if not exists aceite_por uuid references profiles(user_id) on delete set null,
  add column if not exists prazo_aceite timestamptz,
  add column if not exists regra text,
  add column if not exists chave_evento text,
  add column if not exists evidencia text,
  add column if not exists criterio_conclusao text,
  add column if not exists motivo text,
  add column if not exists escalonada_em timestamptz;

alter table tasks drop constraint if exists chk_tasks_origem;
alter table tasks add constraint chk_tasks_origem check (origem in ('manual', 'encaminhada', 'automatica'));

-- novos estados: "aguardando" (terceiros/outro setor) e "bloqueada"
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks drop constraint if exists chk_tasks_status;
alter table tasks add constraint chk_tasks_status
  check (status in ('aberta', 'andamento', 'aguardando', 'bloqueada', 'concluida', 'cancelada'));

-- um evento gera no máximo uma tarefa, para sempre (critério de aceite 9 do PDF)
create unique index if not exists uq_tasks_chave_evento on tasks (chave_evento) where chave_evento is not null;
create index if not exists idx_tasks_sem_aceite on tasks (prazo_aceite) where origem = 'encaminhada' and aceite_em is null;

-- linha do tempo da tarefa: quem fez o quê, de que setor para qual
create table if not exists task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  tipo text not null check (tipo in (
    'criada', 'encaminhada', 'aceita', 'recusada', 'status', 'responsavel',
    'comentario', 'evidencia', 'escalonada', 'prazo'
  )),
  autor uuid references profiles(user_id) on delete set null,
  de_setor text,
  para_setor text,
  texto text,
  dados jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_task_events_task on task_events (task_id, created_at);
alter table task_events enable row level security;  -- só o servidor (service role)

-- histórico das tarefas que já existiam
insert into task_events (task_id, tipo, autor, para_setor, texto, created_at)
select t.id, 'criada', t.criado_por, t.setor, 'Tarefa criada', t.created_at
from tasks t
where not exists (select 1 from task_events e where e.task_id = t.id);

insert into settings (chave, valor) values
  ('tarefa_aceite_horas', '24'::jsonb),
  ('rodizio_minutos', '30'::jsonb),
  ('rodizio_max_repasses', '3'::jsonb),
  ('visita_relatorio_horas', '3'::jsonb),
  ('cadastro_parado_dias', '2'::jsonb)
on conflict (chave) do nothing;

-- ===========================================================================
-- 2. Rodízio de leads
-- ===========================================================================
alter table profiles
  add column if not exists rodizio_leads boolean not null default false,
  add column if not exists rodizio_ultimo_em timestamptz;

alter table opportunities
  add column if not exists responsavel_user_id uuid references profiles(user_id) on delete set null,
  add column if not exists atribuida_em timestamptz,
  add column if not exists prazo_atendimento timestamptz,
  add column if not exists primeiro_atendimento_em timestamptz,
  add column if not exists rodizio_tentativas int not null default 0;
create index if not exists idx_opportunities_responsavel on opportunities (responsavel_user_id, etapa);
create index if not exists idx_opportunities_prazo_atendimento on opportunities (prazo_atendimento)
  where primeiro_atendimento_em is null;

-- quem já recebeu cada lead (para o rodízio não devolver ao mesmo corretor)
create table if not exists opportunity_atribuicoes (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  user_id uuid references profiles(user_id) on delete set null,
  motivo text not null check (motivo in ('rodizio', 'sem_atendimento', 'manual', 'assumiu')),
  autor uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_opp_atribuicoes_opp on opportunity_atribuicoes (opportunity_id, created_at);
alter table opportunity_atribuicoes enable row level security;

-- Entrega o lead ao próximo corretor da fila. Ordem: quem ainda não recebeu
-- este lead, depois quem recebeu lead há mais tempo. Volta null quando não há
-- ninguém no rodízio (aí o lead fica com a equipe, como antes).
create or replace function fn_rodizio_atribuir(p_opp uuid, p_motivo text default 'rodizio')
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_ant uuid;
  v_user uuid;
  v_min int;
  v_nome text;
begin
  select responsavel_user_id into v_ant from opportunities where id = p_opp for update;
  if not found then return null; end if;
  select coalesce((select round((valor #>> '{}')::numeric)::int from settings where chave = 'rodizio_minutos'), 30) into v_min;

  select p.user_id, p.nome into v_user, v_nome
  from profiles p
  where p.rodizio_leads
    and coalesce(p.ativo, true)
    and p.role in ('admin_central', 'analista_arini')
    and (p.role = 'admin_central' or 'comercial' = any (p.setores))
    and p.user_id is distinct from v_ant
  order by
    exists (select 1 from opportunity_atribuicoes a where a.opportunity_id = p_opp and a.user_id = p.user_id),
    p.rodizio_ultimo_em nulls first,
    p.user_id
  limit 1
  for update of p skip locked;

  if v_user is null then return null; end if;

  update opportunities set
    responsavel_user_id = v_user,
    atribuida_em = now(),
    prazo_atendimento = now() + make_interval(mins => greatest(5, v_min)),
    rodizio_tentativas = rodizio_tentativas + 1
  where id = p_opp;
  update profiles set rodizio_ultimo_em = now() where user_id = v_user;
  insert into opportunity_atribuicoes (opportunity_id, user_id, motivo) values (p_opp, v_user, p_motivo);
  insert into opportunity_events (opportunity_id, tipo, descricao)
  values (p_opp, 'encaminhamento',
    case when p_motivo = 'sem_atendimento'
      then 'Sem atendimento no prazo: lead repassado para ' || coalesce(v_nome, 'o próximo corretor')
      else 'Rodízio: lead entregue a ' || coalesce(v_nome, 'um corretor') end);
  insert into audit_log (acao, entidade, entidade_id, opportunity_id, dados_antes, dados_depois)
  values ('lead_rodizio', 'opportunities', p_opp, p_opp,
    jsonb_build_object('responsavel', v_ant),
    jsonb_build_object('responsavel', v_user, 'motivo', p_motivo, 'automatico', true));
  return v_user;
end;
$$;
revoke execute on function fn_rodizio_atribuir(uuid, text) from public, anon, authenticated;
grant execute on function fn_rodizio_atribuir(uuid, text) to service_role;

-- ===========================================================================
-- 3. Relatório depois da visita
-- ===========================================================================
alter table visits
  add column if not exists relatorio jsonb,
  add column if not exists relatorio_em timestamptz,
  add column if not exists relatorio_por uuid references profiles(user_id) on delete set null;

-- ===========================================================================
-- 4. Automações por evento
-- ===========================================================================
-- Cria uma tarefa automática (uma por chave_evento) com o evento "criada" e o
-- registro de auditoria. Devolve o id, ou null se a chave já existia.
create or replace function fn_tarefa_automatica(
  p_chave text, p_regra text, p_setor text, p_titulo text, p_descricao text,
  p_responsavel uuid, p_prazo date, p_prioridade text,
  p_property uuid default null, p_opportunity uuid default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare v_id uuid;
begin
  -- confere antes para não gastar número de tarefa à toa; o índice único segura a corrida
  if exists (select 1 from tasks where chave_evento = p_chave) then return null; end if;
  insert into tasks (titulo, descricao, setor, responsavel, prazo, prioridade, origem, regra, chave_evento,
                     property_id, opportunity_id, aceite_em)
  values (left(p_titulo, 200), p_descricao, p_setor, p_responsavel, p_prazo, p_prioridade, 'automatica', p_regra, p_chave,
          p_property, p_opportunity, now())
  on conflict (chave_evento) where chave_evento is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  insert into task_events (task_id, tipo, para_setor, texto, dados)
  values (v_id, 'criada', p_setor, 'Criada automaticamente pela regra "' || p_regra || '"', jsonb_build_object('chave', p_chave));
  insert into audit_log (acao, entidade, entidade_id, property_id, opportunity_id, dados_depois)
  values ('tarefa_automatica', 'tasks', v_id, p_property, p_opportunity,
          jsonb_build_object('regra', p_regra, 'chave', p_chave, 'setor', p_setor, 'automatico', true));
  return v_id;
end;
$$;
revoke execute on function fn_tarefa_automatica(text, text, text, text, text, uuid, date, text, uuid, uuid) from public, anon, authenticated;
grant execute on function fn_tarefa_automatica(text, text, text, text, text, uuid, date, text, uuid, uuid) to service_role;

-- Roda todas as regras. O worker chama a cada 10 min; a Diretoria pode rodar na hora.
create or replace function fn_central_automacoes()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_max int := coalesce((select round((valor #>> '{}')::numeric)::int from settings where chave = 'rodizio_max_repasses'), 3);
  v_vis int := coalesce((select round((valor #>> '{}')::numeric)::int from settings where chave = 'visita_relatorio_horas'), 3);
  v_dias int := coalesce((select round((valor #>> '{}')::numeric)::int from settings where chave = 'cadastro_parado_dias'), 2);
  n_atrib int := 0; n_repasse int := 0; n_lead int := 0; n_visita int := 0; n_aceite int := 0; n_cadastro int := 0;
begin
  -- 4.1 lead novo ainda sem corretor (chegou antes do rodízio ou ninguém estava na fila)
  for r in
    select o.id from opportunities o
    where o.responsavel_user_id is null and o.etapa = 'novo_lead' and o.primeiro_atendimento_em is null
      and o.responsavel_tipo = 'arini' and o.created_at > now() - interval '30 days'
    order by o.created_at limit 100
  loop
    if fn_rodizio_atribuir(r.id, 'rodizio') is not null then n_atrib := n_atrib + 1; end if;
  end loop;

  -- 4.2 lead sem atendimento no prazo: repassa; depois de N repasses, vira tarefa da gerência
  for r in
    select o.id, o.codigo, o.rodizio_tentativas, o.property_id from opportunities o
    where o.primeiro_atendimento_em is null and o.etapa = 'novo_lead'
      and o.prazo_atendimento is not null and o.prazo_atendimento < now()
    order by o.prazo_atendimento limit 100
  loop
    if r.rodizio_tentativas < v_max and fn_rodizio_atribuir(r.id, 'sem_atendimento') is not null then
      n_repasse := n_repasse + 1;
    else
      update opportunities set prazo_atendimento = null where id = r.id;
      if fn_tarefa_automatica('lead_sem_atendimento:' || r.id, 'Lead sem atendimento', 'comercial',
           'Lead ' || r.codigo || ' sem atendimento',
           'O lead passou por ' || r.rodizio_tentativas || ' corretor(es) sem primeiro contato. Defina quem atende.',
           null, current_date, 'alta', r.property_id, r.id) is not null then
        n_lead := n_lead + 1;
      end if;
    end if;
  end loop;

  -- 4.3 visita que já passou e não tem relatório
  for r in
    select v.id, v.data_hora, o.id as opp, o.codigo, o.property_id,
           coalesce(v.responsavel, o.responsavel_user_id) as resp
    from visits v join opportunities o on o.id = v.opportunity_id
    where v.relatorio is null and v.status in ('agendada', 'realizada')
      and v.data_hora < now() - make_interval(hours => v_vis)
      and v.data_hora > now() - interval '30 days'
    limit 200
  loop
    if fn_tarefa_automatica('visita_sem_relatorio:' || r.id, 'Visita sem relatório', 'comercial',
         'Preencher o relatório da visita (' || r.codigo || ')',
         'A visita de ' || to_char(r.data_hora at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
           || ' ainda não tem relatório. O proprietário acompanha esse retorno.',
         r.resp, current_date, 'alta', r.property_id, r.opp) is not null then
      n_visita := n_visita + 1;
    end if;
  end loop;

  -- 4.4 tarefa encaminhada que ninguém assumiu no prazo: escalona para a Diretoria
  for r in
    select t.id, t.codigo, t.titulo, t.setor, t.property_id, t.opportunity_id from tasks t
    where t.origem = 'encaminhada' and t.aceite_em is null and t.escalonada_em is null
      and t.status = 'aberta' and t.prazo_aceite < now()
    limit 200
  loop
    update tasks set escalonada_em = now(), prioridade = 'alta' where id = r.id;
    insert into task_events (task_id, tipo, texto) values (r.id, 'escalonada', 'Sem aceite no prazo: escalonada para a Diretoria');
    if fn_tarefa_automatica('sem_aceite:' || r.id, 'Encaminhamento sem aceite', 'diretoria',
         r.codigo || ' sem aceite em ' || case r.setor
           when 'operacoes' then 'Operações' when 'comercial' then 'Comercial' when 'financeiro' then 'Financeiro'
           when 'juridico' then 'Jurídico' when 'marketing' then 'Marketing' when 'cartografia' then 'Cartografia'
           when 'suporte' then 'Suporte' when 'seguranca' then 'Segurança' else r.setor end,
         'Ninguém assumiu "' || r.titulo || '" dentro do prazo. Atribua um responsável ou cobre o setor.',
         null, current_date, 'alta', r.property_id, r.opportunity_id) is not null then
      n_aceite := n_aceite + 1;
    end if;
  end loop;

  -- 4.5 cadastro de imóvel parado em análise
  for r in
    select p.id, p.codigo, p.titulo, p.status::text as st from properties p
    where p.status in ('pendente', 'em_analise') and p.updated_at < now() - make_interval(days => v_dias)
    limit 200
  loop
    if fn_tarefa_automatica('cadastro_parado:' || r.id || ':' || r.st, 'Cadastro parado', 'operacoes',
         'Analisar o cadastro ' || r.codigo,
         '"' || coalesce(r.titulo, r.codigo) || '" está há mais de ' || v_dias || ' dia(s) aguardando análise.',
         null, current_date, 'normal', r.id, null) is not null then
      n_cadastro := n_cadastro + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'leads_atribuidos', n_atrib, 'leads_repassados', n_repasse, 'leads_sem_atendimento', n_lead,
    'visitas_sem_relatorio', n_visita, 'encaminhamentos_sem_aceite', n_aceite, 'cadastros_parados', n_cadastro,
    'rodou_em', now());
end;
$$;
revoke execute on function fn_central_automacoes() from public, anon, authenticated;
grant execute on function fn_central_automacoes() to service_role;

-- ===========================================================================
-- 5. Ranking de imóveis
-- ===========================================================================
-- Audiência: visitantes únicos (por IP) de ficha e página, favoritos, compartilhamentos
-- e tour, sem contar a equipe. Oportunidade: leads, propostas e visitas no período,
-- mais o interesse recente. Só imóveis à venda. O app mostra o Top 10 de cada.
create or replace function fn_ranking_imoveis(p_dias int)
returns table (
  property_id uuid, codigo text, titulo text,
  visitantes int, favoritos int, compartilhamentos int, interesses int,
  leads int, visitas int, propostas int, visitantes_antes int,
  audiencia numeric, oportunidade numeric
)
language sql
stable
set search_path = public
as $$
  with janela as (
    select now() - make_interval(days => greatest(1, p_dias)) as ini,
           now() - make_interval(days => 2 * greatest(1, p_dias)) as ini_antes
  ),
  equipe as (select user_id from profiles where role in ('admin_central', 'analista_arini')),
  ev as (
    select e.property_id, e.tipo, coalesce(e.user_id::text, e.ip, e.id::text) as quem, e.created_at
    from property_events e, janela j
    where e.created_at >= j.ini_antes
      and (e.user_id is null or e.user_id not in (select user_id from equipe))
  ),
  aud as (
    select ev.property_id,
      count(distinct quem) filter (where tipo in ('visualizacao', 'ficha') and created_at >= (select ini from janela)) as visitantes,
      count(distinct quem) filter (where tipo in ('visualizacao', 'ficha') and created_at < (select ini from janela)) as visitantes_antes,
      count(distinct quem) filter (where tipo = 'favorito' and created_at >= (select ini from janela)) as favoritos,
      count(distinct quem) filter (where tipo = 'compartilhamento' and created_at >= (select ini from janela)) as compartilhamentos,
      count(distinct quem) filter (where tipo = 'tour' and created_at >= (select ini from janela)) as tours,
      count(distinct quem) filter (where tipo = 'interesse' and created_at >= (select ini from janela)) as interesses
    from ev group by ev.property_id
  ),
  com as (
    select x.property_id, sum(x.leads) as leads, sum(x.visitas) as visitas, sum(x.propostas) as propostas
    from (
      select o.property_id, 1 as leads, 0 as visitas, 0 as propostas
        from opportunities o where o.created_at >= (select ini from janela)
      union all
      select o.property_id, 0, 1, 0
        from visits v join opportunities o on o.id = v.opportunity_id
        where v.data_hora >= (select ini from janela) and v.data_hora <= now()
      union all
      select o.property_id, 0, 0, 1
        from proposals pr join opportunities o on o.id = pr.opportunity_id
        where pr.created_at >= (select ini from janela)
    ) x group by x.property_id
  )
  select p.id, p.codigo, p.titulo,
    coalesce(a.visitantes, 0)::int, coalesce(a.favoritos, 0)::int, coalesce(a.compartilhamentos, 0)::int,
    coalesce(a.interesses, 0)::int, coalesce(c.leads, 0)::int, coalesce(c.visitas, 0)::int, coalesce(c.propostas, 0)::int,
    coalesce(a.visitantes_antes, 0)::int,
    (coalesce(a.visitantes, 0) + 4 * coalesce(a.favoritos, 0) + 5 * coalesce(a.compartilhamentos, 0)
      + 2 * coalesce(a.tours, 0)
      + greatest(0, coalesce(a.visitantes, 0) - coalesce(a.visitantes_antes, 0)) * 0.5)::numeric as audiencia,
    (10 * coalesce(c.leads, 0) + 4 * coalesce(a.interesses, 0) + 15 * coalesce(c.propostas, 0) + 8 * coalesce(c.visitas, 0)
      + 2 * coalesce(a.favoritos, 0))::numeric as oportunidade
  from properties p
  left join aud a on a.property_id = p.id
  left join com c on c.property_id = p.id
  where p.status in ('publicado', 'em_negociacao')
    and (a.property_id is not null or c.property_id is not null);
$$;
revoke execute on function fn_ranking_imoveis(int) from public, anon, authenticated;
grant execute on function fn_ranking_imoveis(int) to service_role;
