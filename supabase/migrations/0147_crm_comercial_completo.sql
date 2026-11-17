-- 0147 · CRM comercial completo (Central de CRMs, parte 5 do documento do Carlos,
-- mais o que fazia sentido do CRM antigo da Arini: agenda, carteira de clientes,
-- cadastro manual de lead, modelos de mensagem e metas por corretor).
--
-- O que muda:
--   1. Oportunidade ganha temperatura, etiquetas, próxima ação (follow-up) e
--      último contato. A linha do tempo passa a registrar ligação, WhatsApp,
--      e-mail e reunião (tipos novos em opportunity_events, sem tabela nova).
--   2. Lead pode nascer na Central (telefone, balcão, indicação, evento, portal),
--      pela função fn_crm_lead_manual.
--   3. Rodízio com regras: peso, imóvel urbano/rural, UF, limite por dia, pausa
--      (férias) e carteira (o cliente que já tem corretor volta para ele). Com a
--      fila vazia, o lead vai para a equipe do setor Comercial, em vez de ficar
--      sem dono. Prazo do primeiro contato conta só no horário de expediente.
--   4. Catálogos: motivos de perda e modelos de mensagem.
--   5. Metas mensais por corretor.
--
-- Idempotente: pode rodar de novo sem efeito colateral.

-- ===========================================================================
-- 1. Oportunidade: temperatura, etiquetas, próxima ação, último contato
-- ===========================================================================
alter table public.opportunities
  add column if not exists temperatura text,
  add column if not exists etiquetas text[] not null default '{}',
  add column if not exists proxima_acao text,
  add column if not exists proxima_acao_em timestamptz,
  add column if not exists ultimo_contato_em timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'opportunities_temperatura_check') then
    alter table public.opportunities add constraint opportunities_temperatura_check
      check (temperatura is null or temperatura in ('quente', 'morno', 'frio'));
  end if;
end $$;

create index if not exists idx_opportunities_proxima_acao on public.opportunities (proxima_acao_em)
  where proxima_acao_em is not null;
create index if not exists idx_opportunities_etiquetas on public.opportunities using gin (etiquetas);

-- lead criado na Central: quem cadastrou
alter table public.leads add column if not exists criado_por uuid references public.profiles(user_id) on delete set null;
create index if not exists idx_leads_telefone on public.leads (regexp_replace(coalesce(telefone, ''), '\D', '', 'g'));
create index if not exists idx_leads_email on public.leads (lower(email));

-- ===========================================================================
-- 2. Rodízio com regras
-- ===========================================================================
alter table public.profiles
  add column if not exists rodizio_peso int not null default 1,
  add column if not exists rodizio_tipos text[] not null default '{}',
  add column if not exists rodizio_ufs text[] not null default '{}',
  add column if not exists rodizio_limite_dia int,
  add column if not exists rodizio_pausa_ate timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_rodizio_peso_check') then
    alter table public.profiles add constraint profiles_rodizio_peso_check check (rodizio_peso between 1 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_rodizio_limite_dia_check') then
    alter table public.profiles add constraint profiles_rodizio_limite_dia_check
      check (rodizio_limite_dia is null or rodizio_limite_dia between 1 and 500);
  end if;
end $$;

-- motivo novo na trilha de atribuições: carteira (o cliente volta para o mesmo corretor)
-- e equipe (fila vazia, foi para quem é do Comercial)
do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.opportunity_atribuicoes'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%motivo%'
  loop
    execute format('alter table public.opportunity_atribuicoes drop constraint %I', c);
  end loop;
  alter table public.opportunity_atribuicoes add constraint opportunity_atribuicoes_motivo_check
    check (motivo in ('rodizio', 'sem_atendimento', 'manual', 'assumiu', 'carteira', 'equipe', 'cadastro'));
end $$;

insert into public.settings (chave, valor) values
  ('rodizio_sem_fila_equipe', 'true'::jsonb),
  ('rodizio_carteira', 'true'::jsonb),
  ('rodizio_expediente_inicio', '"08:00"'::jsonb),
  ('rodizio_expediente_fim', '"18:00"'::jsonb),
  ('rodizio_sabado', 'true'::jsonb),
  ('rodizio_domingo', 'false'::jsonb)
on conflict (chave) do nothing;

-- Prazo do primeiro contato contando só o expediente (horário de Brasília).
-- Lead que chega às 22h com 30 min de prazo vence às 8h30 do dia útil seguinte.
create or replace function public.fn_crm_prazo_expediente(p_inicio timestamptz, p_minutos int)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_ini time;
  v_fim time;
  v_sab boolean;
  v_dom boolean;
  v_local timestamp := p_inicio at time zone 'America/Sao_Paulo';
  v_resto int := greatest(p_minutos, 1);
  v_fim_dia timestamp;
  v_livre int;
  v_guarda int := 0;
begin
  begin
    v_ini := coalesce((select valor #>> '{}' from settings where chave = 'rodizio_expediente_inicio'), '08:00')::time;
    v_fim := coalesce((select valor #>> '{}' from settings where chave = 'rodizio_expediente_fim'), '18:00')::time;
  exception when others then
    v_ini := '08:00'; v_fim := '18:00';
  end;
  v_sab := coalesce((select (valor #>> '{}')::boolean from settings where chave = 'rodizio_sabado'), true);
  v_dom := coalesce((select (valor #>> '{}')::boolean from settings where chave = 'rodizio_domingo'), false);
  -- expediente inválido (fim antes do início): conta corrido, como antes
  if v_fim <= v_ini then return p_inicio + make_interval(mins => v_resto); end if;

  loop
    v_guarda := v_guarda + 1;
    if v_guarda > 30 then return p_inicio + make_interval(mins => v_resto); end if;
    -- dia sem expediente: pula para o início do próximo dia
    if (extract(isodow from v_local) = 6 and not v_sab) or (extract(isodow from v_local) = 7 and not v_dom) then
      v_local := date_trunc('day', v_local) + interval '1 day' + v_ini;
      continue;
    end if;
    if v_local::time < v_ini then v_local := date_trunc('day', v_local) + v_ini; end if;
    v_fim_dia := date_trunc('day', v_local) + v_fim;
    if v_local >= v_fim_dia then
      v_local := date_trunc('day', v_local) + interval '1 day' + v_ini;
      continue;
    end if;
    v_livre := floor(extract(epoch from (v_fim_dia - v_local)) / 60)::int;
    if v_resto <= v_livre then
      return (v_local + make_interval(mins => v_resto)) at time zone 'America/Sao_Paulo';
    end if;
    v_resto := v_resto - v_livre;
    v_local := date_trunc('day', v_local) + interval '1 day' + v_ini;
  end loop;
end;
$$;
revoke execute on function public.fn_crm_prazo_expediente(timestamptz, int) from public, anon, authenticated;
grant execute on function public.fn_crm_prazo_expediente(timestamptz, int) to service_role;

-- Entrega o lead. Mesma assinatura da 0065 (o site chama igual), regras novas:
--   a) carteira: o cliente (mesmo telefone ou e-mail) que já tem corretor ativo
--      volta para ele;
--   b) fila: quem está no rodízio, não pausado, dentro do limite do dia, que
--      atende o tipo de imóvel e a UF; ordem pela carga dos últimos 7 dias
--      dividida pelo peso, depois quem recebeu há mais tempo;
--   c) fila vazia: a equipe do setor Comercial (configurável);
--   d) ninguém: null (o lead fica com a equipe, como antes).
create or replace function public.fn_rodizio_atribuir(p_opp uuid, p_motivo text default 'rodizio')
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_ant uuid;
  v_user uuid;
  v_min int;
  v_nome text;
  v_tipo text;
  v_uf text;
  v_fone text;
  v_email text;
  v_motivo text := p_motivo;
  v_hoje timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
begin
  select o.responsavel_user_id, p.tipo::text, m.uf,
         nullif(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g'), ''), nullif(lower(trim(l.email)), '')
    into v_ant, v_tipo, v_uf, v_fone, v_email
  from opportunities o
  join properties p on p.id = o.property_id
  left join municipalities m on m.id = p.municipality_id
  left join leads l on l.id = o.lead_id
  where o.id = p_opp
  for update of o;
  if not found then return null; end if;
  select coalesce((select round((valor #>> '{}')::numeric)::int from settings where chave = 'rodizio_minutos'), 30) into v_min;

  -- a) carteira
  if p_motivo = 'rodizio'
     and coalesce((select (valor #>> '{}')::boolean from settings where chave = 'rodizio_carteira'), true)
     and (v_fone is not null or v_email is not null) then
    select o2.responsavel_user_id, pr.nome into v_user, v_nome
    from opportunities o2
    join leads l2 on l2.id = o2.lead_id
    join profiles pr on pr.user_id = o2.responsavel_user_id
    where o2.id <> p_opp
      and o2.responsavel_user_id is not null
      and o2.created_at > now() - interval '180 days'
      and coalesce(pr.ativo, true)
      and pr.role in ('admin_central', 'analista_arini')
      and ((v_fone is not null and length(v_fone) >= 8
            and regexp_replace(coalesce(l2.telefone, ''), '\D', '', 'g') = v_fone)
        or (v_email is not null and lower(trim(l2.email)) = v_email))
    order by (o2.etapa not in ('fechado', 'pos_venda', 'perdido')) desc, o2.created_at desc
    limit 1;
    if v_user is not null then v_motivo := 'carteira'; end if;
  end if;

  -- b) fila do rodízio
  if v_user is null then
    select p.user_id, p.nome into v_user, v_nome
    from profiles p
    where p.rodizio_leads
      and coalesce(p.ativo, true)
      and p.role in ('admin_central', 'analista_arini')
      and (p.role = 'admin_central' or 'comercial' = any (p.setores))
      and p.user_id is distinct from v_ant
      and (p.rodizio_pausa_ate is null or p.rodizio_pausa_ate < now())
      and (cardinality(p.rodizio_tipos) = 0 or v_tipo = any (p.rodizio_tipos))
      and (cardinality(p.rodizio_ufs) = 0 or v_uf is null or v_uf = any (p.rodizio_ufs))
      and (p.rodizio_limite_dia is null or p.rodizio_limite_dia > (
        select count(*) from opportunity_atribuicoes a
        where a.user_id = p.user_id and a.created_at >= v_hoje and a.motivo in ('rodizio', 'sem_atendimento', 'carteira', 'equipe')))
    order by
      exists (select 1 from opportunity_atribuicoes a where a.opportunity_id = p_opp and a.user_id = p.user_id),
      (select count(*) from opportunity_atribuicoes a
        where a.user_id = p.user_id and a.created_at > now() - interval '7 days')::numeric / greatest(p.rodizio_peso, 1),
      p.rodizio_ultimo_em nulls first,
      p.user_id
    limit 1
    for update of p skip locked;
  end if;

  -- c) fila vazia: equipe do Comercial
  if v_user is null
     and coalesce((select (valor #>> '{}')::boolean from settings where chave = 'rodizio_sem_fila_equipe'), true)
     and not exists (select 1 from profiles p where p.rodizio_leads and coalesce(p.ativo, true)
                       and p.role in ('admin_central', 'analista_arini')) then
    select p.user_id, p.nome into v_user, v_nome
    from profiles p
    where coalesce(p.ativo, true)
      and p.role = 'analista_arini'
      and 'comercial' = any (p.setores)
      and p.user_id is distinct from v_ant
      and (p.rodizio_pausa_ate is null or p.rodizio_pausa_ate < now())
    order by
      exists (select 1 from opportunity_atribuicoes a where a.opportunity_id = p_opp and a.user_id = p.user_id),
      p.rodizio_ultimo_em nulls first,
      p.user_id
    limit 1
    for update of p skip locked;
    if v_user is not null and v_motivo = 'rodizio' then v_motivo := 'equipe'; end if;
  end if;

  if v_user is null then return null; end if;

  update opportunities set
    responsavel_user_id = v_user,
    atribuida_em = now(),
    prazo_atendimento = fn_crm_prazo_expediente(now(), greatest(5, v_min)),
    rodizio_tentativas = rodizio_tentativas + 1
  where id = p_opp;
  update profiles set rodizio_ultimo_em = now() where user_id = v_user;
  insert into opportunity_atribuicoes (opportunity_id, user_id, motivo) values (p_opp, v_user, v_motivo);
  insert into opportunity_events (opportunity_id, tipo, descricao)
  values (p_opp, 'encaminhamento',
    case v_motivo
      when 'sem_atendimento' then 'Sem atendimento no prazo: lead repassado para ' || coalesce(v_nome, 'o próximo corretor')
      when 'carteira' then 'Cliente da carteira: lead entregue a ' || coalesce(v_nome, 'quem já o atende')
      when 'equipe' then 'Rodízio sem fila: lead entregue a ' || coalesce(v_nome, 'alguém do Comercial')
      else 'Rodízio: lead entregue a ' || coalesce(v_nome, 'um corretor') end);
  insert into audit_log (acao, entidade, entidade_id, opportunity_id, dados_antes, dados_depois)
  values ('lead_rodizio', 'opportunities', p_opp, p_opp,
    jsonb_build_object('responsavel', v_ant),
    jsonb_build_object('responsavel', v_user, 'motivo', v_motivo, 'automatico', true));
  return v_user;
end;
$$;
revoke execute on function public.fn_rodizio_atribuir(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_rodizio_atribuir(uuid, text) to service_role;

-- ===========================================================================
-- 3. Lead cadastrado na Central
-- ===========================================================================
-- Cria lead + oportunidade + evento + auditoria numa transação. Responsável:
--   p_atribuir = 'rodizio' → passa pelo rodízio (fn_rodizio_atribuir)
--   p_atribuir = 'eu' ou um uuid da equipe → fica com essa pessoa, já atendido
-- Devolve { id, codigo, lead_id, responsavel }.
create or replace function public.fn_crm_lead_manual(
  p_autor uuid, p_codigo_imovel text, p_nome text, p_telefone text, p_email text,
  p_mensagem text, p_origem text, p_temperatura text, p_etiquetas text[],
  p_responsavel uuid, p_rodizio boolean
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  im properties%rowtype;
  lid uuid;
  op opportunities%rowtype;
  v_resp uuid;
  dias int;
begin
  select * into im from properties where codigo = p_codigo_imovel;
  if not found then raise exception 'Imóvel não encontrado.' using errcode = 'P0001'; end if;
  if im.status::text in ('vendido', 'historico', 'reprovado') then
    raise exception 'O imóvel não aceita novos interessados (situação: %).', im.status using errcode = 'P0001';
  end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do cliente.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_telefone), '') = '' and coalesce(trim(p_email), '') = '' then
    raise exception 'Informe telefone ou e-mail.' using errcode = 'P0001';
  end if;

  select (valor #>> '{}')::integer into dias from settings where chave = 'protecao_dias' and jsonb_typeof(valor) = 'number';

  insert into leads (property_id, nome, telefone, email, mensagem, origem, canal, consentimento_lgpd, status, criado_por)
  values (im.id, left(trim(p_nome), 180), nullif(left(trim(coalesce(p_telefone, '')), 40), ''),
          nullif(left(lower(trim(coalesce(p_email, ''))), 254), ''), nullif(left(trim(coalesce(p_mensagem, '')), 2000), ''),
          coalesce(nullif(p_origem, ''), 'telefone'), 'central', false, 'em_oportunidade', p_autor)
  returning id into lid;

  insert into opportunities (lead_id, property_id, regime_na_origem, protecao_ate, responsavel_tipo,
                             temperatura, etiquetas)
  values (lid, im.id, im.regime_comercial,
          case when dias > 0 and im.regime_comercial = 'EXCLUSIVO_ARINI' then now() + make_interval(days => dias) end,
          'arini',
          case when p_temperatura in ('quente', 'morno', 'frio') then p_temperatura end,
          coalesce(p_etiquetas, '{}'))
  returning * into op;

  insert into opportunity_events (opportunity_id, tipo, descricao, autor)
  values (op.id, 'contato', 'Lead cadastrado na Central (origem: ' || coalesce(nullif(p_origem, ''), 'telefone') || ')', p_autor);
  insert into audit_log (user_id, acao, entidade, entidade_id, property_id, opportunity_id, dados_depois)
  values (p_autor, 'lead_criado', 'leads', lid, im.id, op.id,
          jsonb_build_object('origem', coalesce(nullif(p_origem, ''), 'telefone'), 'cadastro', 'central'));

  if p_rodizio then
    v_resp := fn_rodizio_atribuir(op.id, 'rodizio');
  elsif p_responsavel is not null then
    if not exists (select 1 from profiles where user_id = p_responsavel and coalesce(ativo, true)
                   and role in ('admin_central', 'analista_arini')) then
      raise exception 'Responsável precisa ser da equipe.' using errcode = 'P0001';
    end if;
    update opportunities set responsavel_user_id = p_responsavel, atribuida_em = now(),
      primeiro_atendimento_em = now(), ultimo_contato_em = now()
    where id = op.id;
    insert into opportunity_atribuicoes (opportunity_id, user_id, motivo, autor) values (op.id, p_responsavel, 'cadastro', p_autor);
    v_resp := p_responsavel;
  end if;

  return jsonb_build_object('id', op.id, 'codigo', op.codigo, 'lead_id', lid, 'responsavel', v_resp);
end;
$$;
revoke all on function public.fn_crm_lead_manual(uuid, text, text, text, text, text, text, text, text[], uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.fn_crm_lead_manual(uuid, text, text, text, text, text, text, text, text[], uuid, boolean)
  to service_role;

-- ===========================================================================
-- 4. Catálogos do CRM
-- ===========================================================================
create table if not exists public.crm_motivos_perda (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.crm_motivos_perda enable row level security;

insert into public.crm_motivos_perda (nome, ordem) values
  ('Preço acima do orçamento', 1),
  ('Comprou outro imóvel', 2),
  ('Sem crédito ou financiamento negado', 3),
  ('Documentação do imóvel', 4),
  ('Localização não atende', 5),
  ('Desistiu da compra', 6),
  ('Sem resposta do cliente', 7),
  ('Fechou com outra imobiliária', 8),
  ('Outro', 99)
on conflict (nome) do nothing;

create table if not exists public.crm_modelos_mensagem (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  canal text not null default 'whatsapp' check (canal in ('whatsapp', 'email', 'ambos')),
  assunto text,
  texto text not null check (length(texto) <= 4000),
  etapa text,
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_por uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_modelos_mensagem enable row level security;
drop trigger if exists trg_crm_modelos_touch on public.crm_modelos_mensagem;
create trigger trg_crm_modelos_touch before update on public.crm_modelos_mensagem
  for each row execute function fn_touch_updated_at();

insert into public.crm_modelos_mensagem (titulo, canal, texto, etapa, ordem)
select * from (values
  ('Primeiro contato', 'whatsapp',
   'Olá, {{nome}}! Aqui é {{corretor}}, da ARINI. Recebi seu interesse no imóvel {{imovel}} ({{codigo}}). Posso te ligar agora para tirar suas dúvidas?',
   'novo_lead', 1),
  ('Agendar visita', 'whatsapp',
   '{{nome}}, que tal conhecermos o {{imovel}} pessoalmente? Tenho horários nesta semana. Qual dia fica melhor para você?',
   'qualificacao', 2),
  ('Confirmação de visita', 'whatsapp',
   'Olá, {{nome}}! Confirmando nossa visita ao {{imovel}}. Qualquer imprevisto, me avise por aqui. Até lá!',
   'visita_agendada', 3),
  ('Pós-visita', 'whatsapp',
   '{{nome}}, obrigado pela visita ao {{imovel}}. O que achou? Se quiser, preparo uma simulação de proposta para você.',
   'visitou', 4),
  ('Retomar contato', 'whatsapp',
   'Oi, {{nome}}! Tudo bem? Passando para saber se ainda procura imóvel. Temos novidades parecidas com o {{imovel}}.',
   null, 5),
  ('Envio de proposta', 'email',
   'Olá, {{nome}},\n\nSegue a proposta referente ao imóvel {{imovel}} ({{codigo}}). Fico à disposição para qualquer ajuste.\n\nAtenciosamente,\n{{corretor}}\nARINI',
   'proposta_enviada', 6)
) v(titulo, canal, texto, etapa, ordem)
where not exists (select 1 from public.crm_modelos_mensagem);

-- ===========================================================================
-- 5. Metas mensais por corretor
-- ===========================================================================
create table if not exists public.crm_metas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  atendimentos int not null default 0 check (atendimentos >= 0),
  visitas int not null default 0 check (visitas >= 0),
  propostas int not null default 0 check (propostas >= 0),
  vendas int not null default 0 check (vendas >= 0),
  vgv numeric(16, 2) not null default 0 check (vgv >= 0),
  definida_por uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, mes)
);
alter table public.crm_metas enable row level security;

grant select, insert, update, delete on public.crm_motivos_perda, public.crm_modelos_mensagem, public.crm_metas to service_role;
