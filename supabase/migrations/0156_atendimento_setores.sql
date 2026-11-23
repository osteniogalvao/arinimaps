-- 0156 · Atendimento por setores (WhatsApp de 1 número), no molde do CRM
-- da Arini Negócios Imobiliários (repositório osteniogalvao/arini, migrations
-- 0025–0059 e docs/ATENDIMENTO-FLUXO.md).
--
-- Até aqui o WhatsApp da Central era uma lista solta de mensagens recebidas,
-- só do Comercial. Agora cada telefone vira UMA conversa, que anda assim:
--
--   cliente ──► menu automático ("digite 1 para…") ──► fila do setor
--                    │ (sem resposta válida)
--                    ▼
--              CAIXA CENTRAL ──► recepção/diretoria tria ──► fila do setor
--                                                              │
--                                       atendente do setor assume e responde
--
-- Quem já é conhecido pelo telefone pula o menu: cliente com negociação aberta
-- vai direto para o corretor dela (Comercial); proprietário vai para Operações;
-- parceiro (corretor, imobiliária…) vai para o Comercial.
--
-- Quem vê o quê (regra no servidor, src/lib/atendimento.ts):
--   diretoria          → tudo
--   recepção           → caixa central + tudo que já foi triado
--   atendente do setor → conversas da fila do setor (fila compartilhada,
--                        como na Arini) e as atribuídas a ele
--
-- Idempotente. Depende de 0068 (whatsapp_mensagens), 0065 (fn_tarefa_automatica)
-- e 0147 (fn_crm_prazo_expediente / expediente do rodízio).

-- ---------------------------------------------------------------------------
-- 1. Conversas
-- ---------------------------------------------------------------------------
create sequence if not exists public.atendimento_conversa_seq;
create table if not exists public.atendimento_conversas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('AT-' || lpad(nextval('public.atendimento_conversa_seq')::text, 6, '0')),
  telefone text not null,
  nome text,
  -- reconhecimento pelo telefone (perfil do sistema com o mesmo número)
  perfil_user_id uuid references public.profiles(user_id) on delete set null,
  perfil_tipo text,
  -- null = caixa central (ainda não triada)
  setor text,
  responsavel uuid references public.profiles(user_id) on delete set null,
  status text not null default 'aberta' check (status in ('aberta', 'pendente', 'resolvida')),
  etiquetas text[] not null default '{}',
  opportunity_id uuid references public.opportunities(id) on delete set null,
  crm_item_id uuid references public.crm_itens(id) on delete set null,
  nao_lidas int not null default 0,
  ultima_mensagem_em timestamptz not null default now(),
  ultima_entrada_em timestamptz,
  ultima_saida_em timestamptz,
  ultimo_texto text,
  triada_em timestamptz,
  resolvida_em timestamptz,
  -- estado do menu automático: a única memória que o menu precisa
  menu_enviado_em timestamptz,
  menu_tentativas int not null default 0,
  menu_respondido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- um telefone = uma conversa (resolvida reabre quando o cliente volta a escrever)
create unique index if not exists atendimento_conversas_telefone on public.atendimento_conversas (telefone);
create index if not exists atendimento_conversas_fila on public.atendimento_conversas (setor, status, ultima_mensagem_em desc);
create index if not exists atendimento_conversas_resp on public.atendimento_conversas (responsavel, status);
drop trigger if exists trg_atendimento_conversas_touch on public.atendimento_conversas;
create trigger trg_atendimento_conversas_touch before update on public.atendimento_conversas
  for each row execute function fn_touch_updated_at();

alter table public.whatsapp_mensagens add column if not exists conversa_id uuid references public.atendimento_conversas(id) on delete set null;
create index if not exists idx_whatsapp_conversa on public.whatsapp_mensagens (conversa_id, created_at);

-- quem faz a triagem da caixa central (além da diretoria)
alter table public.profiles add column if not exists atendimento_recepcao boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Histórico: triagem, transferência, assumir, devolver, menu, notas internas
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_eventos (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.atendimento_conversas(id) on delete cascade,
  acao text not null check (acao in ('criada', 'menu', 'reconhecida', 'triagem', 'transferencia', 'assumir', 'devolver',
                                     'resolver', 'reabrir', 'nota', 'etiquetas', 'lead', 'crm', 'automatica')),
  de_setor text,
  para_setor text,
  de_user uuid references public.profiles(user_id) on delete set null,
  para_user uuid references public.profiles(user_id) on delete set null,
  texto text,
  autor uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists atendimento_eventos_conversa on public.atendimento_eventos (conversa_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Menu automático (ramais) — um só, do número principal
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_menu (
  id smallint primary key default 1 check (id = 1),
  ativo boolean not null default true,
  saudacao text not null default 'Olá{{nome}}! Você está falando com a ARINI. Para agilizar, responda com o número do assunto:',
  confirmacao text not null default 'Certo! Seu atendimento foi encaminhado para {{setor}}. Em instantes alguém da equipe responde por aqui.',
  nao_entendi text not null default 'Não entendi a opção. Responda só com o número, por favor:',
  fora_expediente text not null default 'Nosso horário é de segunda a sexta, das 8h às 18h. Sua mensagem ficou registrada e respondemos assim que o expediente começar.',
  max_tentativas int not null default 2 check (max_tentativas between 1 and 5),
  -- para onde vai quem não acertou a opção (null = caixa central)
  setor_escape text,
  -- conversa parada esquece o menu aberto: um "1" daqui a semanas não é resposta
  expira_minutos int not null default 720 check (expira_minutos > 0),
  -- conversa resolvida há mais que isso recebe o menu de novo ao voltar
  reenviar_apos_horas int not null default 12 check (reenviar_apos_horas > 0),
  updated_at timestamptz not null default now()
);
insert into public.atendimento_menu (id) values (1) on conflict (id) do nothing;

create table if not exists public.atendimento_menu_opcoes (
  id uuid primary key default gen_random_uuid(),
  ordem int not null default 0,
  chave text not null unique,
  rotulo text not null,
  -- null = caixa central (falar com atendente)
  setor text,
  responsavel uuid references public.profiles(user_id) on delete set null,
  etiqueta text,
  confirmacao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.atendimento_menu_opcoes (ordem, chave, rotulo, setor, etiqueta) values
  (1, '1', 'Quero comprar ou alugar um imóvel', 'comercial', 'compra'),
  (2, '2', 'Quero anunciar ou vender meu imóvel', 'operacoes', 'captacao'),
  (3, '3', 'Pagamentos, boletos e planos', 'financeiro', 'financeiro'),
  (4, '4', 'Documentação e contratos', 'juridico', 'documentacao'),
  (5, '5', 'Mapas, CAR e relatórios da plataforma', 'cartografia', 'mapas'),
  (6, '6', 'Ajuda com a minha conta no site', 'suporte', 'suporte'),
  (7, '0', 'Falar com um atendente', null, null)
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Respostas prontas (atalho "/" no campo de resposta)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_respostas (
  id uuid primary key default gen_random_uuid(),
  atalho text not null unique check (atalho ~ '^[a-z0-9_-]{2,30}$'),
  titulo text not null,
  texto text not null,
  -- null = todos os setores
  setor text,
  criado_por uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);
insert into public.atendimento_respostas (atalho, titulo, texto) values
  ('ola', 'Saudação', 'Olá! Aqui é da equipe ARINI, tudo bem? Como posso ajudar?'),
  ('docs', 'Pedir documentos', 'Para seguirmos, envie por aqui: matrícula atualizada do imóvel, documento com foto do proprietário e o CAR (se for rural).'),
  ('visita', 'Agendar visita', 'Podemos agendar a visita! Quais dias e horários ficam melhores para você?'),
  ('obrigado', 'Encerramento', 'Obrigado pelo contato! Qualquer coisa é só chamar por aqui.')
on conflict (atalho) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Conversas a partir do histórico que já existe
-- ---------------------------------------------------------------------------
-- Cada telefone que já escreveu vira uma conversa. Quem tem negociação
-- aberta entra no Comercial com o corretor dela; o resto vai para a caixa
-- central como resolvido (histórico), para não inundar a fila no primeiro dia.
insert into public.atendimento_conversas (telefone, status, setor, responsavel, opportunity_id, ultima_mensagem_em,
                                          ultima_entrada_em, ultima_saida_em, ultimo_texto, triada_em, resolvida_em, menu_respondido_em)
select m.telefone,
       case when o.id is not null and o.etapa not in ('fechado', 'pos_venda', 'perdido') then 'aberta' else 'resolvida' end,
       case when o.id is not null then 'comercial' end,
       o.responsavel_user_id, o.id, m.ultima, m.ultima_entrada, m.ultima_saida, m.texto,
       case when o.id is not null then m.ultima end,
       case when o.id is null or o.etapa in ('fechado', 'pos_venda', 'perdido') then m.ultima end,
       m.ultima
from (
  select distinct on (telefone) telefone, created_at ultima, texto, opportunity_id,
         max(created_at) filter (where direcao = 'entrada') over (partition by telefone) ultima_entrada,
         -- sem isto, toda conversa com negociação aberta parecia "sem resposta" e virava tarefa no 1º ciclo do worker
         max(created_at) filter (where direcao = 'saida') over (partition by telefone) ultima_saida
  from public.whatsapp_mensagens
  order by telefone, created_at desc
) m
left join lateral (
  select o.* from public.whatsapp_mensagens w join public.opportunities o on o.id = w.opportunity_id
  where w.telefone = m.telefone order by w.created_at desc limit 1
) o on true
on conflict (telefone) do nothing;

update public.whatsapp_mensagens w set conversa_id = c.id
from public.atendimento_conversas c
where c.telefone = w.telefone and w.conversa_id is null;

-- ---------------------------------------------------------------------------
-- 6. RLS: só o servidor (service_role) lê e grava; a regra de acesso fica
--    em src/lib/atendimento.ts, igual às demais tabelas da Central.
-- ---------------------------------------------------------------------------
alter table public.atendimento_conversas enable row level security;
alter table public.atendimento_eventos enable row level security;
alter table public.atendimento_menu enable row level security;
alter table public.atendimento_menu_opcoes enable row level security;
alter table public.atendimento_respostas enable row level security;

-- ---------------------------------------------------------------------------
-- 7. Regra do worker: conversa esperando resposta há mais de N minutos de
--    expediente vira tarefa do setor (ou do responsável). Uma por conversa/dia.
-- ---------------------------------------------------------------------------
insert into public.settings (chave, valor) values ('atendimento_prazo_minutos', '30'::jsonb)
on conflict (chave) do nothing;

create or replace function public.fn_atendimento_regras() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
  v_min int := coalesce((select round((valor #>> '{}')::numeric)::int from settings where chave = 'atendimento_prazo_minutos'), 30);
begin
  for r in
    select c.id, c.codigo, c.nome, c.telefone, c.setor, c.responsavel, c.ultima_entrada_em
    from atendimento_conversas c
    where c.status = 'aberta'
      and c.ultima_entrada_em is not null
      and c.ultima_entrada_em > now() - interval '3 days'
      and (c.ultima_saida_em is null or c.ultima_saida_em < c.ultima_entrada_em)
      and fn_crm_prazo_expediente(c.ultima_entrada_em, v_min) < now()
    order by c.ultima_entrada_em
    limit 200
  loop
    if fn_tarefa_automatica(
         'atendimento_sem_resposta:' || r.id || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
         'atendimento_sem_resposta', coalesce(r.setor, 'comercial'),
         'Responder WhatsApp de ' || coalesce(nullif(r.nome, ''), '+' || r.telefone) || ' (' || r.codigo || ')',
         'Conversa ' || case when r.setor is null then 'na caixa central (sem triagem)' else 'na fila do setor' end
           || ' esperando resposta. Abra em Central > Atendimento.',
         r.responsavel, current_date, 'alta') is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.fn_atendimento_regras() from public, anon, authenticated;
grant execute on function public.fn_atendimento_regras() to service_role;
