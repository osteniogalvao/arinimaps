-- 0068 · Central de CRMs, etapa 4: marketing e WhatsApp.
-- Central de publicação multicanal com aprovação (edição prepara, tráfego
-- aprova e publica), feed XML para os portais, campanhas de tráfego com os
-- leads que cada uma trouxe e conversa de WhatsApp dentro da oportunidade.
-- Idempotente.

create sequence if not exists publicacao_codigo_seq;
create table if not exists publicacoes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('PB-' || lpad(nextval('publicacao_codigo_seq')::text, 6, '0')),
  property_id uuid not null references properties(id) on delete cascade,
  canal text not null check (canal in ('instagram','facebook','portais','site')),
  legenda text not null default '',
  midias text[] not null default '{}',
  agendada_para timestamptz,
  status text not null default 'rascunho'
    check (status in ('rascunho','aprovacao','agendada','publicada','erro','cancelada')),
  criado_por uuid references profiles(user_id),
  aprovado_por uuid references profiles(user_id),
  aprovado_em timestamptz,
  publicado_em timestamptz,
  externo_id text,
  link_externo text,
  erro text,
  motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_publicacoes_status on publicacoes (status, agendada_para);
create index if not exists idx_publicacoes_property on publicacoes (property_id);
drop trigger if exists trg_publicacoes_touch on publicacoes;
create trigger trg_publicacoes_touch before update on publicacoes for each row execute function fn_touch_updated_at();

create table if not exists campanhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  canal text not null check (canal in ('meta','google','portal','outro')),
  utm_campaign text,
  inicio date,
  fim date,
  orcamento numeric(14,2),
  gasto numeric(14,2),
  property_id uuid references properties(id) on delete set null,
  observacoes text,
  ativa boolean not null default true,
  criado_por uuid references profiles(user_id),
  created_at timestamptz not null default now()
);

create table if not exists whatsapp_mensagens (
  id uuid primary key default gen_random_uuid(),
  wa_id text unique,
  telefone text not null,
  direcao text not null check (direcao in ('entrada','saida')),
  tipo text not null default 'text',
  texto text,
  opportunity_id uuid references opportunities(id) on delete set null,
  status text,
  enviado_por uuid references profiles(user_id),
  erro text,
  created_at timestamptz not null default now()
);
create index if not exists idx_whatsapp_opp on whatsapp_mensagens (opportunity_id, created_at);
create index if not exists idx_whatsapp_tel on whatsapp_mensagens (telefone, created_at);

alter table publicacoes enable row level security;
alter table campanhas enable row level security;
alter table whatsapp_mensagens enable row level security;

-- leads por campanha (utm_campaign) para o painel de tráfego
create or replace function fn_campanhas_resultado()
returns table (campanha_id uuid, leads bigint, oportunidades bigint, vendas bigint)
language sql stable security definer set search_path = public as $$
  select c.id,
    count(distinct l.id),
    count(distinct o.id),
    count(distinct o.id) filter (where o.etapa in ('fechado','pos_venda'))
  from campanhas c
  left join leads l on c.utm_campaign is not null and lower(l.utm->>'utm_campaign') = lower(c.utm_campaign)
    and (c.inicio is null or l.created_at >= c.inicio) and (c.fim is null or l.created_at < c.fim + 1)
  left join opportunities o on o.lead_id = l.id
  group by c.id;
$$;
revoke all on function fn_campanhas_resultado() from public, anon, authenticated;
grant execute on function fn_campanhas_resultado() to service_role;

-- regras: publicação esperando aprovação há mais de 1 dia; mensagem de
-- WhatsApp sem resposta há mais de 2 h em horário comercial
create or replace function fn_central_marketing_regras() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select p.id, p.codigo, pr.codigo imovel from publicacoes p join properties pr on pr.id = p.property_id
           where p.status = 'aprovacao' and p.updated_at < now() - interval '1 day' loop
    if fn_tarefa_automatica('publicacao_aprovacao:' || r.id, 'publicacao_parada', 'marketing',
        'Aprovar publicação ' || r.codigo || ' (' || r.imovel || ')', null, null, current_date, 'normal', null, null) is not null then n := n + 1; end if;
  end loop;
  for r in
    select distinct on (m.opportunity_id) m.id, m.opportunity_id, o.codigo, o.responsavel_user_id, m.created_at
    from whatsapp_mensagens m join opportunities o on o.id = m.opportunity_id
    where m.created_at > now() - interval '2 days'
    order by m.opportunity_id, m.created_at desc
  loop
    if r.created_at < now() - interval '2 hours'
       and exists (select 1 from whatsapp_mensagens x where x.id = r.id and x.direcao = 'entrada')
       and extract(hour from now() at time zone 'America/Sao_Paulo') between 8 and 18 then
      if fn_tarefa_automatica('whatsapp_sem_resposta:' || r.id, 'whatsapp_sem_resposta', 'comercial',
          'Responder WhatsApp do cliente ' || r.codigo, null, r.responsavel_user_id, current_date, 'alta', null, r.opportunity_id) is not null then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function fn_central_marketing_regras() from public, anon, authenticated;

create or replace function fn_central_modulos() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'despesas_cobradas', fn_central_financeiro_regras(),
    'avisos_de_ponto', fn_central_pessoas_regras(),
    'marketing_e_whatsapp', fn_central_marketing_regras());
end $$;
revoke all on function fn_central_modulos() from public, anon, authenticated;
grant execute on function fn_central_modulos() to service_role;
