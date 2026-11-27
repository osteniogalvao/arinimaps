-- Arini Maps — migration 0175: limites de uso por assinatura (26/11/2026).
--
-- Áudio do Carlos (22h39) e tabela do Stenio: dois níveis de limite — uma trava
-- exagerada contra robô e venda de dados (20 consultas por minuto, para todos)
-- e um limite "bom" por plano (100 consultas por dia, 300 downloads de KML/KMZ
-- por mês, 1 aparelho por vez), que leva quem usa demais a um plano maior.
--
-- As consultas por dia contam em `consultas_area_log` (já existe, 0023). Aqui
-- entram só o que ainda não tinha onde ser contado:
--   · arquivos_baixados_log — cada KML/KMZ baixado por conta;
--   · aparelhos_ativos      — os aparelhos em uso na mesma conta.
-- Os números moram em Configurações > Segurança (padrão) e nas cotas de cada
-- plano em Admin > Planos (consultas_area_dia, downloads_arquivos_mes,
-- aparelhos_simultaneos). Só o servidor (service role) lê e grava.
--
-- (0174 está reservada para as quadras manuais da cartografia.)

create table if not exists public.arquivos_baixados_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  formato text not null check (formato in ('kml', 'kmz')),
  origem text,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists arquivos_baixados_log_user_idx on public.arquivos_baixados_log (user_id, created_at desc);
alter table public.arquivos_baixados_log enable row level security;
revoke all on public.arquivos_baixados_log from public, anon, authenticated;

create table if not exists public.aparelhos_ativos (
  user_id uuid not null references auth.users(id) on delete cascade,
  aparelho uuid not null,
  criado_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  user_agent text,
  ip text,
  primary key (user_id, aparelho)
);
alter table public.aparelhos_ativos enable row level security;
revoke all on public.aparelhos_ativos from public, anon, authenticated;

/**
 * Registra o aparelho como ativo e tira da conta os mais antigos além de
 * p_max (o último a entrar fica). p_max <= 0 = sem limite.
 */
create or replace function public.fn_aparelho_entrar(p_user uuid, p_aparelho uuid, p_max integer, p_ua text, p_ip text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into aparelhos_ativos (user_id, aparelho, user_agent, ip)
  values (p_user, p_aparelho, left(p_ua, 300), left(p_ip, 60))
  on conflict (user_id, aparelho) do update set visto_em = now(), user_agent = excluded.user_agent, ip = excluded.ip;
  if p_max > 0 then
    delete from aparelhos_ativos a
     where a.user_id = p_user
       and a.aparelho not in (
         select b.aparelho from aparelhos_ativos b where b.user_id = p_user
          order by b.criado_em desc limit p_max);
  end if;
end $$;
revoke all on function public.fn_aparelho_entrar(uuid, uuid, integer, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
