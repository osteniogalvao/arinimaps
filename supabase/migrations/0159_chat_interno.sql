-- =====================================================================
-- 0159 — CHAT INTERNO DA EQUIPE
--
-- O mesmo desenho do chat interno do CRM da Arini Negócios Imobiliários
-- (repo arini, 0051), adaptado à Central:
--   · `direta` — entre duas pessoas da equipe, uma conversa por par
--     (membro_a < membro_b impede duas conversas para o mesmo par);
--   · `setor`  — um canal por setor, lido por quem atua nele (diretoria
--     lê todos).
-- Não reaproveita `atendimento_conversas` (conversa com cliente) nem a
-- "Conversa" do item do CRM (presa a um item).
--
-- Acesso só pelo servidor (service_role), com a mesma regra de setores da
-- Central; RLS ligada e sem policy para anon/authenticated.
--
-- Idempotente. Depende de profiles(user_id).
-- =====================================================================

create table if not exists public.chat_conversas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('direta', 'setor')),
  setor text,
  membro_a uuid references public.profiles(user_id) on delete cascade,
  membro_b uuid references public.profiles(user_id) on delete cascade,
  ultima_em timestamptz not null default now(),
  ultima_previa text,
  ultima_autor uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chat_conversa_coerente check (
    (tipo = 'setor' and setor is not null and membro_a is null and membro_b is null)
    or (tipo = 'direta' and setor is null and membro_a is not null and membro_b is not null and membro_a < membro_b)
  )
);
create unique index if not exists uq_chat_conversa_setor on public.chat_conversas (setor) where tipo = 'setor';
create unique index if not exists uq_chat_conversa_direta on public.chat_conversas (membro_a, membro_b) where tipo = 'direta';
create index if not exists idx_chat_conversas_recentes on public.chat_conversas (ultima_em desc);

-- Estado de leitura de cada pessoa (no canal de setor a linha nasce no primeiro acesso).
create table if not exists public.chat_participantes (
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  lido_em timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversa_id, user_id)
);
create index if not exists idx_chat_participantes_pessoa on public.chat_participantes (user_id);

create table if not exists public.chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  autor uuid references public.profiles(user_id) on delete set null,
  texto text not null check (char_length(texto) between 1 and 4000),
  -- apagar não remove a linha: quem já leu continua vendo que existiu algo
  apagada_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_mensagens_thread on public.chat_mensagens (conversa_id, created_at desc);

-- Prévia e hora da última mensagem na conversa (a lista não varre mensagens).
create or replace function public.fn_chat_ultima() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.chat_conversas
     set ultima_em = new.created_at, ultima_previa = left(new.texto, 140), ultima_autor = new.autor
   where id = new.conversa_id;
  return new;
end $$;
drop trigger if exists trg_chat_ultima on public.chat_mensagens;
create trigger trg_chat_ultima after insert on public.chat_mensagens
  for each row execute function public.fn_chat_ultima();

-- Abre (ou devolve) a conversa direta entre duas pessoas, sem corrida.
create or replace function public.fn_chat_direta(p_eu uuid, p_outro uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare a uuid := least(p_eu, p_outro); b uuid := greatest(p_eu, p_outro); cid uuid;
begin
  if p_eu = p_outro then raise exception 'conversa consigo mesmo' using errcode = '22023'; end if;
  insert into public.chat_conversas (tipo, membro_a, membro_b) values ('direta', a, b)
    on conflict (membro_a, membro_b) where tipo = 'direta' do nothing;
  select id into cid from public.chat_conversas where tipo = 'direta' and membro_a = a and membro_b = b;
  insert into public.chat_participantes (conversa_id, user_id) values (cid, a), (cid, b)
    on conflict do nothing;
  return cid;
end $$;

-- Um canal por setor da Central (src/lib/setores.ts).
insert into public.chat_conversas (tipo, setor)
select 'setor', s from unnest(array['diretoria','operacoes','comercial','financeiro','juridico',
  'marketing','marketing_trafego','cartografia','suporte','seguranca']) s
on conflict (setor) where tipo = 'setor' do nothing;

alter table public.chat_conversas enable row level security;
alter table public.chat_participantes enable row level security;
alter table public.chat_mensagens enable row level security;
revoke all on public.chat_conversas, public.chat_participantes, public.chat_mensagens from anon, authenticated;
grant all on public.chat_conversas, public.chat_participantes, public.chat_mensagens to service_role;
revoke all on function public.fn_chat_direta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_chat_direta(uuid, uuid) to service_role;
