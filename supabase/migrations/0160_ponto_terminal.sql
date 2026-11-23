-- =====================================================================
-- 0160 — TERMINAL DE PONTO (quiosque da recepção)
--
-- Pedido do Carlos (CRM da Arini, 21/08): "em vez de cada um abrir o ponto
-- no seu computador, deixa o ponto só no setor central; quando eles
-- chegam, vêm no principal e marcam".
--
-- O computador da recepção fica logado numa conta só (o OPERADOR). Cada
-- pessoa escolhe o nome e digita o PIN dela; a marcação é DELA
-- (user_id), com origem 'terminal' e o operador registrado. O PIN existe
-- para que ninguém bata ponto no nome de outro: ele é criado pela própria
-- pessoa em "Meu ponto" e guardado só como hash (bcrypt) em ponto_pins.
--
-- Idempotente. Depende de 0067 e 0074 (ponto), e de pgcrypto (schema
-- extensions no Supabase).
-- =====================================================================

alter table public.ponto_marcacoes drop constraint if exists ponto_marcacoes_origem_check;
alter table public.ponto_marcacoes add constraint ponto_marcacoes_origem_check
  check (origem in ('web', 'offline', 'ajuste', 'terminal'));
alter table public.ponto_marcacoes add column if not exists operador uuid references public.profiles(user_id);

-- Tabela à parte (e não coluna em profiles) para o hash nunca sair por uma
-- leitura de perfil: só o servidor lê.
create table if not exists public.ponto_pins (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  pin_hash text not null,
  definido_em timestamptz not null default now()
);
alter table public.ponto_pins enable row level security;
revoke all on public.ponto_pins from anon, authenticated;
grant all on public.ponto_pins to service_role;

-- Define (ou troca) o PIN de 4 a 6 dígitos da própria pessoa.
create or replace function public.fn_ponto_definir_pin(p_user uuid, p_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^[0-9]{4,6}$' then return false; end if;
  insert into public.ponto_pins (user_id, pin_hash) values (p_user, crypt(p_pin, gen_salt('bf', 8)))
    on conflict (user_id) do update set pin_hash = excluded.pin_hash, definido_em = now();
  return true;
end $$;

-- Marca o ponto pelo terminal: confere o PIN e grava com origem 'terminal'.
create or replace function public.fn_registrar_ponto_terminal(
  p_user uuid, p_pin text, p_operador uuid, p_ip text, p_agente text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare h text; m ponto_marcacoes%rowtype;
begin
  select k.pin_hash into h from public.ponto_pins k join public.profiles p on p.user_id = k.user_id
   where k.user_id = p_user and p.ativo is not false and p.role in ('admin_central', 'analista_arini');
  if h is null then return jsonb_build_object('erro', 'sem_pin'); end if;
  if p_pin is null or crypt(p_pin, h) <> h then return jsonb_build_object('erro', 'pin'); end if;
  -- o mesmo bloqueio da 0074 protege a cadeia de hashes da 0067
  perform pg_advisory_xact_lock(hashtext('ponto_marcacoes'));
  if exists (select 1 from public.ponto_marcacoes where user_id = p_user
      and marcado_em > now() - interval '1 minute' and marcado_em < now() + interval '1 minute') then
    return jsonb_build_object('erro', 'proxima');
  end if;
  insert into public.ponto_marcacoes (user_id, marcado_em, origem, ip, user_agent, operador)
    values (p_user, now(), 'terminal', p_ip, p_agente, p_operador) returning * into m;
  return jsonb_build_object('comprovante', jsonb_build_object('id', m.id, 'nsr', m.nsr, 'marcado_em', m.marcado_em, 'hash', m.hash));
end $$;

revoke all on function public.fn_ponto_definir_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_ponto_definir_pin(uuid, text) to service_role;
revoke all on function public.fn_registrar_ponto_terminal(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_registrar_ponto_terminal(uuid, text, uuid, text, text) to service_role;
