-- 0162: Matriz — cobrança por níveis, prazos por setor, resumo diário da Ari,
-- fila de gargalos e saída da equipe ("ARINI Matriz: Estrutura dos CRMs por
-- Setor", Carlos, 19/11/2026, seções 3, 4, 5, 6, 9 e 10).
--
-- O que já existia e continua igual: tarefas por setor com origem, aceite,
-- devolução e repasse (0065), aviso ao responsável na criação (0067, nível 0),
-- escalonamento de encaminhamento sem aceite (0065) e auditoria somente-inserção
-- (0036). Esta migration acrescenta:
--
--  1. matriz_prazos      — prazo padrão e limites de cada setor, com exceção por
--                          tipo de tarefa (regra). A Diretoria edita na tela de
--                          Automações, sem mexer em código.
--  2. tasks.nivel_cobranca — 0 criada · 1 metade do prazo (lembrete ao
--                          responsável) · 2 prazo vencido (aviso ao gestor do
--                          setor) · 3 vencida além do limite do setor (alerta à
--                          Diretoria e fila de gargalos).
--  3. tasks.saltos       — quantas vezes a tarefa mudou de setor. Mais de 2 sem
--                          concluir = gargalo na Matriz.
--  4. matriz_resumos     — resumo diário por setor e geral ("Resumo da Ari"),
--                          com carga contra capacidade e déficit.
--  5. Saída da equipe    — quem é desativado ou sai de um setor tem as tarefas
--                          abertas daquele setor repassadas ao gestor do setor
--                          (ou devolvidas à fila do setor), com registro.
--
-- A Ari só cria, avisa e sobe nível: não conclui, não apaga e não altera valor.
-- Cada cobrança fica na auditoria com a regra e o motivo.

-- 0161 (Equipe e funções) cria esta coluna; repetida aqui para a 0162 rodar
-- mesmo se for aplicada antes.
alter table public.profiles add column if not exists setores_gestor text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 1. Prazos e limites por setor (e por tipo de tarefa)
-- ---------------------------------------------------------------------------
create table if not exists public.matriz_prazos (
  setor text not null,
  regra text not null default '',          -- '' = padrão do setor; senão, o tipo (tasks.regra)
  prazo_dias int not null default 3 check (prazo_dias between 0 and 365),
  limite_dias int not null default 2 check (limite_dias between 0 and 365),
  atencao int not null default 1 check (atencao >= 0),   -- vencidas a partir disto = atenção
  critico int not null default 5 check (critico >= 1),   -- vencidas a partir disto = crítico
  updated_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (setor, regra)
);
alter table public.matriz_prazos enable row level security;  -- só o servidor

insert into public.matriz_prazos (setor, regra, prazo_dias, limite_dias, atencao, critico)
select s, '', p, l, 1, c from (values
  ('operacoes', 2, 2, 5), ('comercial', 1, 2, 5), ('financeiro', 3, 3, 5), ('juridico', 5, 5, 3),
  ('marketing', 3, 3, 5), ('marketing_trafego', 3, 3, 5), ('cartografia', 5, 5, 5), ('suporte', 1, 1, 5),
  ('seguranca', 1, 1, 3), ('diretoria', 3, 3, 5)
) v(s, p, l, c)
on conflict (setor, regra) do nothing;

-- prazo e limite que valem para uma tarefa: exceção do tipo > padrão do setor > 3/2
create or replace function public.fn_matriz_prazo(p_setor text, p_regra text)
returns public.matriz_prazos language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m from public.matriz_prazos m where m.setor = p_setor and m.regra = coalesce(p_regra, '') and p_regra is not null and p_regra <> ''),
    (select m from public.matriz_prazos m where m.setor = p_setor and m.regra = ''),
    row(p_setor, '', 3, 2, 1, 5, null, now())::public.matriz_prazos
  );
$$;

-- ---------------------------------------------------------------------------
-- 2 e 3. Nível de cobrança e saltos entre setores
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists nivel_cobranca smallint not null default 0,
  add column if not exists nivel_em timestamptz,
  add column if not exists saltos smallint not null default 0;
alter table public.tasks drop constraint if exists chk_tasks_nivel_cobranca;
alter table public.tasks add constraint chk_tasks_nivel_cobranca check (nivel_cobranca between 0 and 3);
create index if not exists idx_tasks_cobranca on public.tasks (prazo, nivel_cobranca)
  where status in ('aberta', 'andamento', 'aguardando', 'bloqueada');

alter table public.task_events drop constraint if exists task_events_tipo_check;
alter table public.task_events add constraint task_events_tipo_check check (tipo in (
  'criada', 'encaminhada', 'aceita', 'recusada', 'status', 'responsavel',
  'comentario', 'evidencia', 'escalonada', 'prazo', 'cobranca', 'reatribuida'
));

-- toda tarefa nasce com prazo (o do setor, se ninguém deu um); prazo novo e
-- mais longo zera a cobrança; mudança de setor conta um salto
create or replace function public.fn_tasks_matriz() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg public.matriz_prazos;
begin
  if tg_op = 'INSERT' then
    if new.prazo is null then
      cfg := public.fn_matriz_prazo(new.setor, new.regra);
      new.prazo := (now() at time zone 'America/Sao_Paulo')::date + cfg.prazo_dias;
    end if;
    return new;
  end if;
  if new.setor is distinct from old.setor then
    new.saltos := least(old.saltos + 1, 32000);
    new.nivel_cobranca := 0;
    new.nivel_em := null;
  end if;
  if new.prazo is distinct from old.prazo and (old.prazo is null or new.prazo > old.prazo) then
    new.nivel_cobranca := 0;
    new.nivel_em := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_tasks_matriz on public.tasks;
create trigger trg_tasks_matriz before insert or update of setor, prazo on public.tasks
  for each row execute function public.fn_tasks_matriz();

-- gestores do setor (0161); sem gestor, a Diretoria
create or replace function public.fn_matriz_gestores(p_setor text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select user_id from public.profiles
   where ativo and role = 'analista_arini' and p_setor = any(setores_gestor)
  union
  select user_id from public.profiles
   where ativo and role = 'admin_central'
     and not exists (select 1 from public.profiles g where g.ativo and g.role = 'analista_arini' and p_setor = any(g.setores_gestor));
$$;

-- Motor de cobrança. Roda a cada 10 min pelo worker. Sobe direto ao nível
-- devido (uma tarefa já muito atrasada não recebe os três avisos de uma vez).
create or replace function public.fn_matriz_cobranca() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record; alvo smallint; cfg public.matriz_prazos; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  motivo text; g uuid; n1 int := 0; n2 int := 0; n3 int := 0; nome_setor text;
begin
  for r in
    select t.* from public.tasks t
     where t.status in ('aberta', 'andamento', 'aguardando', 'bloqueada')
       and t.prazo is not null and t.nivel_cobranca < 3
       and t.prazo <= hoje + 365
     order by t.prazo
     limit 500
  loop
    cfg := public.fn_matriz_prazo(r.setor, r.regra);
    alvo := case
      when r.prazo < hoje - cfg.limite_dias then 3
      when r.prazo < hoje then 2
      -- metade do caminho entre a criação e o fim do dia do prazo
      when now() >= r.created_at + ((r.prazo + 1)::timestamp at time zone 'America/Sao_Paulo' - r.created_at) / 2 then 1
      else 0 end;
    continue when alvo <= r.nivel_cobranca;

    motivo := case alvo
      when 1 then 'Metade do prazo: "' || r.titulo || '" vence em ' || to_char(r.prazo, 'DD/MM') || '.'
      when 2 then 'Prazo vencido em ' || to_char(r.prazo, 'DD/MM') || ': "' || r.titulo || '"'
                  || case when r.responsavel is null then ' está sem responsável.' else '.' end
      else 'Vencida há ' || (hoje - r.prazo) || ' dias, além do limite de ' || cfg.limite_dias || ' do setor: "' || r.titulo || '".'
    end;

    update public.tasks set nivel_cobranca = alvo, nivel_em = now() where id = r.id;
    insert into public.task_events (task_id, tipo, texto, dados)
    values (r.id, 'cobranca', motivo, jsonb_build_object('nivel', alvo, 'regra', 'matriz_cobranca', 'prazo', r.prazo, 'responsavel', r.responsavel));
    insert into public.audit_log (user_id, acao, entidade, entidade_id, dados_depois)
    values (null, 'cobranca_nivel_' || alvo, 'tasks', r.id,
            jsonb_build_object('regra', 'matriz_cobranca', 'motivo', motivo, 'setor', r.setor, 'responsavel', r.responsavel));

    if alvo = 1 then
      n1 := n1 + 1;
      perform public.fn_notificar(r.responsavel, 'info', 'Lembrete: ' || r.titulo, motivo,
        '/admin/tarefas/' || r.id, 'cobranca:1:' || r.id);
    elsif alvo = 2 then
      n2 := n2 + 1;
      perform public.fn_notificar(r.responsavel, 'atencao', 'Tarefa vencida: ' || r.titulo, motivo,
        '/admin/tarefas/' || r.id, 'cobranca:2:' || r.id);
      for g in select public.fn_matriz_gestores(r.setor) loop
        continue when g = r.responsavel;
        perform public.fn_notificar(g, 'atencao', 'Vencida no seu setor: ' || r.titulo, motivo,
          '/admin/tarefas/' || r.id, 'cobranca:2:' || r.id);
      end loop;
    else
      n3 := n3 + 1;
      for g in select public.fn_matriz_gestores(r.setor) loop
        perform public.fn_notificar(g, 'atencao', 'Gargalo no setor: ' || r.titulo, motivo,
          '/admin/tarefas/' || r.id, 'cobranca:3:' || r.id);
      end loop;
    end if;
  end loop;

  -- nível 3 chega à Diretoria num aviso só por dia, com o total (sem inundar o sino)
  if n3 > 0 then
    for g in select user_id from public.profiles where ativo and role = 'admin_central' loop
      perform public.fn_notificar(g, 'critico', 'Fila de gargalos da Matriz',
        (select count(*) from public.tasks where nivel_cobranca = 3 and status in ('aberta', 'andamento', 'aguardando', 'bloqueada'))
          || ' tarefa(s) vencida(s) além do limite do setor. Veja a fila de gargalos na Matriz.',
        '/admin#gargalos', 'cobranca:3:dia:' || hoje);
    end loop;
  end if;

  return jsonb_build_object('cobranca_n1', n1, 'cobranca_n2', n2, 'cobranca_n3', n3);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Resumo diário da Ari (regras fixas; sem IA, sem custo por chamada)
-- ---------------------------------------------------------------------------
create table if not exists public.matriz_resumos (
  dia date not null,
  setor text not null default '',   -- '' = resumo geral da Matriz
  texto text not null,
  dados jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (dia, setor)
);
alter table public.matriz_resumos enable row level security;  -- só o servidor

-- números por setor: abertas, vencidas, nível 3, novas e concluídas em 24 h,
-- pessoas ativas, capacidade somada e déficit
create or replace function public.fn_matriz_carga()
returns table (setor text, abertas int, vencidas int, nivel3 int, novas24 int, concluidas24 int,
               pessoas int, capacidade int, deficit boolean)
language sql stable security definer set search_path = '' as $$
  with s(setor) as (
    select unnest(array['operacoes','comercial','financeiro','juridico','marketing','marketing_trafego',
                        'cartografia','suporte','seguranca','diretoria'])
  ), t as (
    select t.setor,
      count(*) filter (where t.status in ('aberta','andamento','aguardando','bloqueada'))::int abertas,
      count(*) filter (where t.status in ('aberta','andamento','aguardando','bloqueada')
                         and t.prazo < (now() at time zone 'America/Sao_Paulo')::date)::int vencidas,
      count(*) filter (where t.status in ('aberta','andamento','aguardando','bloqueada') and t.nivel_cobranca = 3)::int nivel3,
      count(*) filter (where t.created_at > now() - interval '24 hours')::int novas24,
      count(*) filter (where t.status = 'concluida' and t.concluida_em > now() - interval '24 hours')::int concluidas24
    from public.tasks t group by t.setor
  ), p as (
    select x.setor, count(*)::int pessoas, coalesce(sum(pr.capacidade_tarefas), 0)::int capacidade
      from s x join public.profiles pr
        on pr.ativo and (pr.role = 'admin_central' and x.setor = 'diretoria'
                         or pr.role = 'analista_arini' and x.setor = any(pr.setores))
     group by x.setor
  )
  select s.setor, coalesce(t.abertas,0), coalesce(t.vencidas,0), coalesce(t.nivel3,0), coalesce(t.novas24,0),
         coalesce(t.concluidas24,0), coalesce(p.pessoas,0), coalesce(p.capacidade,0),
         (coalesce(t.abertas,0) > 0 and coalesce(p.pessoas,0) = 0)
           or coalesce(t.abertas,0) > coalesce(p.capacidade,0)
           or coalesce(t.vencidas,0) >= (public.fn_matriz_prazo(s.setor, null)).critico
  from s left join t on t.setor = s.setor left join p on p.setor = s.setor;
$$;

create or replace function public.fn_matriz_resumo(p_forcar boolean default false) returns int
language plpgsql security definer set search_path = '' as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record; txt text; partes text[] := '{}'; deficit text[] := '{}'; g uuid; n int := 0;
  tot_ab int := 0; tot_ve int := 0; tot_n3 int := 0; tot_co int := 0;
  nomes jsonb := '{"operacoes":"Operações","comercial":"Comercial","financeiro":"Financeiro","juridico":"Jurídico",
    "marketing":"Marketing Produção","marketing_trafego":"Marketing Tráfego","cartografia":"Cartografia e Dados",
    "suporte":"Suporte","seguranca":"Segurança","diretoria":"Diretoria"}';
begin
  -- uma vez por dia, a partir das 7 h (ou quando a Diretoria pede na tela)
  if not p_forcar and (exists (select 1 from public.matriz_resumos where dia = hoje and setor = '')
                       or extract(hour from now() at time zone 'America/Sao_Paulo') < 7) then
    return 0;
  end if;

  for r in select * from public.fn_matriz_carga() order by vencidas desc, abertas desc loop
    tot_ab := tot_ab + r.abertas; tot_ve := tot_ve + r.vencidas; tot_n3 := tot_n3 + r.nivel3; tot_co := tot_co + r.concluidas24;
    txt := case
      when r.abertas = 0 then 'Sem tarefas abertas.'
      else r.abertas || ' aberta(s), ' || r.vencidas || ' vencida(s)'
           || case when r.nivel3 > 0 then ', ' || r.nivel3 || ' além do limite' else '' end
           || '. ' || r.concluidas24 || ' concluída(s) e ' || r.novas24 || ' nova(s) nas últimas 24 h.'
    end
    || case
      when r.abertas > 0 and r.pessoas = 0 then ' Ninguém está no setor: defina a equipe.'
      when r.deficit then ' Acima do que o setor consegue entregar (' || r.pessoas || ' pessoa(s), capacidade ' || r.capacidade || ').'
      else '' end;
    insert into public.matriz_resumos (dia, setor, texto, dados)
    values (hoje, r.setor, txt, to_jsonb(r))
    on conflict (dia, setor) do update set texto = excluded.texto, dados = excluded.dados, created_at = now();
    n := n + 1;
    if r.vencidas > 0 or r.deficit then
      partes := partes || ((nomes->>r.setor) || ': ' || r.vencidas || ' vencida(s)');
    end if;
    if r.deficit then deficit := deficit || (nomes->>r.setor); end if;

    -- gestor recebe o resumo do próprio setor quando há algo vencido
    if r.vencidas > 0 then
      for g in select user_id from public.profiles where ativo and role = 'analista_arini' and r.setor = any(setores_gestor) loop
        perform public.fn_notificar(g, 'info', 'Resumo do setor ' || (nomes->>r.setor), txt,
          '/admin/tarefas?setor=' || r.setor, 'resumo:' || hoje || ':' || r.setor);
      end loop;
    end if;
  end loop;

  txt := case when tot_ab = 0 then 'Nenhuma tarefa aberta em toda a Matriz.'
    else tot_ab || ' tarefa(s) aberta(s) e ' || tot_ve || ' vencida(s) na Matriz'
         || case when tot_n3 > 0 then ', ' || tot_n3 || ' além do limite do setor' else '' end
         || '. ' || tot_co || ' concluída(s) nas últimas 24 h.' end
    || case when array_length(partes, 1) > 0 then ' Pede atenção: ' || array_to_string(partes[1:4], '; ') || '.' else ' Nada vencido.' end
    || case when array_length(deficit, 1) > 0 then ' Setor(es) com déficit: ' || array_to_string(deficit, ', ') || '.' else '' end;
  insert into public.matriz_resumos (dia, setor, texto, dados)
  values (hoje, '', txt, jsonb_build_object('abertas', tot_ab, 'vencidas', tot_ve, 'nivel3', tot_n3, 'concluidas24', tot_co, 'deficit', to_jsonb(deficit)))
  on conflict (dia, setor) do update set texto = excluded.texto, dados = excluded.dados, created_at = now();

  for g in select user_id from public.profiles where ativo and role = 'admin_central' loop
    perform public.fn_notificar(g, 'info', 'Resumo do dia da Ari', txt, '/admin', 'resumo:' || hoje);
  end loop;
  insert into public.audit_log (user_id, acao, entidade, dados_depois)
  values (null, 'resumo_diario_ari', 'matriz_resumos', jsonb_build_object('regra', 'matriz_resumo', 'dia', hoje, 'texto', txt));
  return n + 1;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Saída da equipe: tarefas abertas não ficam presas com quem saiu
-- ---------------------------------------------------------------------------
create or replace function public.fn_profiles_saida_tarefas() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t record; novo uuid;
begin
  for t in
    select id, setor, titulo from public.tasks
     where responsavel = new.user_id and status in ('aberta', 'andamento', 'aguardando', 'bloqueada')
       and (not new.ativo
            or new.role not in ('admin_central', 'analista_arini')
            or (new.role = 'analista_arini' and not (setor = any(coalesce(new.setores, '{}')))))
  loop
    select p.user_id into novo from public.profiles p
     where p.ativo and p.user_id <> new.user_id and p.role = 'analista_arini' and t.setor = any(p.setores_gestor)
     order by p.nome limit 1;
    update public.tasks set responsavel = novo, status = case when status = 'andamento' then 'aberta' else status end
     where id = t.id;
    insert into public.task_events (task_id, tipo, texto, dados)
    values (t.id, 'reatribuida',
      case when novo is null then 'Responsável saiu do setor: tarefa voltou para a fila do setor.'
           else 'Responsável saiu do setor: tarefa repassada ao gestor do setor.' end,
      jsonb_build_object('de', new.user_id, 'para', novo, 'regra', 'saida_equipe'));
    insert into public.audit_log (user_id, acao, entidade, entidade_id, dados_antes, dados_depois)
    values (null, 'tarefa_reatribuida', 'tasks', t.id, jsonb_build_object('responsavel', new.user_id),
            jsonb_build_object('responsavel', novo, 'regra', 'saida_equipe'));
    if novo is null then
      for novo in select public.fn_matriz_gestores(t.setor) loop
        perform public.fn_notificar(novo, 'atencao', 'Tarefa sem responsável: ' || t.titulo,
          'Quem cuidava saiu do setor. Atribua a alguém da equipe.', '/admin/tarefas/' || t.id, 'saida:' || t.id || ':' || new.user_id);
      end loop;
      novo := null;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_profiles_saida_tarefas on public.profiles;
create trigger trg_profiles_saida_tarefas after update of ativo, role, setores on public.profiles
  for each row when (old.ativo is distinct from new.ativo or old.role is distinct from new.role or old.setores is distinct from new.setores)
  execute function public.fn_profiles_saida_tarefas();

-- só o servidor
revoke all on function public.fn_matriz_prazo(text, text) from public, anon, authenticated;
revoke all on function public.fn_matriz_gestores(text) from public, anon, authenticated;
revoke all on function public.fn_matriz_cobranca() from public, anon, authenticated;
revoke all on function public.fn_matriz_carga() from public, anon, authenticated;
revoke all on function public.fn_matriz_resumo(boolean) from public, anon, authenticated;
grant execute on function public.fn_matriz_prazo(text, text), public.fn_matriz_gestores(text), public.fn_matriz_cobranca(),
  public.fn_matriz_carga(), public.fn_matriz_resumo(boolean) to service_role;
grant select, insert, update, delete on public.matriz_prazos to service_role;
grant select on public.matriz_resumos to service_role;
