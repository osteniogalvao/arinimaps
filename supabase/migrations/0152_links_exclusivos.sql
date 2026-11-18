-- Link exclusivo (áudio do Carlos, 18/11/2026, 9h25): o corretor gera um link
-- do Tour 3D/ficha do imóvel para UMA pessoa. O primeiro aparelho que abre fica
-- com o link; em outro aparelho ele avisa que já foi usado, então não dá para
-- repassar. Vale 7 dias por padrão. Quem criou pode revogar.
-- Idempotente.

create table if not exists public.links_exclusivos (
  token        uuid primary key default gen_random_uuid(),
  criado_por   uuid not null references auth.users(id) on delete cascade,
  codigo       text not null,
  destino      text not null default 'tour' check (destino in ('tour', 'ficha')),
  destinatario text check (char_length(destinatario) <= 80),
  criado_em    timestamptz not null default now(),
  expira_em    timestamptz not null default now() + interval '7 days',
  usado_em     timestamptz,
  dispositivo  uuid,
  aberturas    integer not null default 0,
  recusas      integer not null default 0,
  revogado_em  timestamptz
);
create index if not exists links_exclusivos_criador on public.links_exclusivos (criado_por, criado_em desc);
alter table public.links_exclusivos enable row level security;
-- sem políticas: só o servidor (service_role) lê e grava
revoke all on public.links_exclusivos from anon, authenticated;

-- Abre o link para um aparelho. Atômico: dois aparelhos ao mesmo tempo não
-- ficam os dois com o link. Resultado: ok (primeira abertura), mesmo (o mesmo
-- aparelho voltou), usado, expirado, revogado ou nulo (não existe).
create or replace function public.link_exclusivo_abrir(p_token uuid, p_dispositivo uuid)
returns table (situacao text, codigo text, destino text, expira_em timestamptz)
language plpgsql security definer set search_path = '' as $$
declare l public.links_exclusivos%rowtype;
begin
  select * into l from public.links_exclusivos where token = p_token for update;
  if not found then return; end if;
  if l.revogado_em is not null then
    return query select 'revogado'::text, l.codigo, l.destino, l.expira_em; return;
  end if;
  if l.expira_em < now() then
    return query select 'expirado'::text, l.codigo, l.destino, l.expira_em; return;
  end if;
  if l.dispositivo is null then
    update public.links_exclusivos set dispositivo = p_dispositivo, usado_em = now(), aberturas = 1 where token = p_token;
    return query select 'ok'::text, l.codigo, l.destino, l.expira_em; return;
  end if;
  if l.dispositivo = p_dispositivo then
    update public.links_exclusivos set aberturas = aberturas + 1 where token = p_token;
    return query select 'mesmo'::text, l.codigo, l.destino, l.expira_em; return;
  end if;
  update public.links_exclusivos set recusas = recusas + 1 where token = p_token;
  return query select 'usado'::text, l.codigo, l.destino, l.expira_em;
end $$;

revoke all on function public.link_exclusivo_abrir(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_exclusivo_abrir(uuid, uuid) to service_role;
