-- 0171 · Atendimento: horário e prazo (SLA) por setor + canais do site e do Telegram
--
-- Até a 0156 o atendimento tinha UM expediente (o do rodízio) e UM prazo de
-- resposta para todos os setores. Agora cada setor pode ter:
--   · dias e horário próprios (ex.: Financeiro seg–sex 8h–17h; Comercial também sábado)
--   · prazo de primeira resposta em minutos de expediente (SLA)
--   · mensagem de fora do horário própria
-- Setor sem linha aqui continua no expediente e no prazo gerais.
--
-- Canais novos na mesma caixa (a conversa continua única pelo "telefone"):
--   site:<hash>  chat do site (widget)  ·  tg:<chat_id>  Telegram
--
-- Idempotente. Depende de 0147 (fn_crm_prazo_expediente), 0156, 0157 e 0170 (ari_ativa_em).

create table if not exists public.atendimento_setores_horario (
  setor text primary key check (setor in ('operacoes','comercial','financeiro','juridico','marketing','marketing_trafego','cartografia','suporte','seguranca','diretoria')),
  dias smallint[] not null default '{1,2,3,4,5}' check (dias <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(dias) between 1 and 7),
  inicio time not null default '08:00',
  fim time not null default '18:00',
  prazo_minutos int not null default 30 check (prazo_minutos between 5 and 1440),
  mensagem_fora text not null default '' check (length(mensagem_fora) <= 1000),
  updated_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  check (fim > inicio)
);
alter table public.atendimento_setores_horario enable row level security;
revoke all on public.atendimento_setores_horario from anon, authenticated;
grant select on public.atendimento_setores_horario to authenticated;
grant all on public.atendimento_setores_horario to service_role;
drop policy if exists horario_equipe on public.atendimento_setores_horario;
create policy horario_equipe on public.atendimento_setores_horario for select to authenticated
  using (public.fn_role() in ('admin_central','analista_arini'));

-- Prazo contando só o horário do setor (fuso de Brasília). Sem linha do setor,
-- usa o expediente geral (fn_crm_prazo_expediente).
create or replace function public.fn_atendimento_prazo(p_setor text, p_inicio timestamptz, p_minutos int)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  h public.atendimento_setores_horario;
  v_local timestamp := p_inicio at time zone 'America/Sao_Paulo';
  v_resto int := greatest(p_minutos, 1);
  v_fim_dia timestamp;
  v_livre int;
  v_guarda int := 0;
begin
  select * into h from public.atendimento_setores_horario where setor = p_setor;
  if not found then return public.fn_crm_prazo_expediente(p_inicio, p_minutos); end if;
  loop
    v_guarda := v_guarda + 1;
    if v_guarda > 30 then return p_inicio + make_interval(mins => v_resto); end if;
    if not (extract(isodow from v_local)::smallint = any(h.dias)) then
      v_local := date_trunc('day', v_local) + interval '1 day' + h.inicio;
      continue;
    end if;
    if v_local::time < h.inicio then v_local := date_trunc('day', v_local) + h.inicio; end if;
    v_fim_dia := date_trunc('day', v_local) + h.fim;
    if v_local >= v_fim_dia then
      v_local := date_trunc('day', v_local) + interval '1 day' + h.inicio;
      continue;
    end if;
    v_livre := floor(extract(epoch from (v_fim_dia - v_local)) / 60)::int;
    if v_resto <= v_livre then
      return (v_local + make_interval(mins => v_resto)) at time zone 'America/Sao_Paulo';
    end if;
    v_resto := v_resto - v_livre;
    v_local := date_trunc('day', v_local) + interval '1 day' + h.inicio;
  end loop;
end $$;
revoke all on function public.fn_atendimento_prazo(text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.fn_atendimento_prazo(text, timestamptz, int) to service_role;

-- A regra do worker passa a usar o prazo e o horário do setor da conversa.
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
    left join atendimento_setores_horario h on h.setor = c.setor
    where c.status = 'aberta'
      and c.ultima_entrada_em is not null
      and c.ultima_entrada_em > now() - interval '3 days'
      and (c.ultima_saida_em is null or c.ultima_saida_em < c.ultima_entrada_em)
      and not (c.ari_ativa_em is not null and c.setor is null and c.responsavel is null)
      and fn_atendimento_prazo(c.setor, c.ultima_entrada_em, coalesce(h.prazo_minutos, v_min)) < now()
    order by c.ultima_entrada_em
    limit 200
  loop
    if fn_tarefa_automatica(
         'atendimento_sem_resposta:' || r.id || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
         'atendimento_sem_resposta', coalesce(r.setor, 'comercial'),
         'Responder ' || case when r.telefone like 'site:%' then 'chat do site'
                              when r.telefone like 'tg:%' then 'Telegram'
                              when r.telefone like 'ig:%' then 'Instagram'
                              when r.telefone like 'fb:%' then 'Messenger'
                              else 'WhatsApp' end
           || ' de ' || coalesce(nullif(r.nome, ''), case when r.telefone ~ '^[0-9]+$' then '+' || r.telefone else 'contato' end) || ' (' || r.codigo || ')',
         'Conversa ' || case when r.setor is null then 'na caixa central (sem triagem)' else 'na fila do setor' end
           || ' esperando resposta além do prazo do setor. Abra em Central > Atendimento.',
         r.responsavel, current_date, 'alta') is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.fn_atendimento_regras() from public, anon, authenticated;
grant execute on function public.fn_atendimento_regras() to service_role;

-- Canais novos
alter table public.atendimento_conversas drop constraint if exists atendimento_conversas_canal_check;
alter table public.atendimento_conversas add constraint atendimento_conversas_canal_check
  check (canal in ('whatsapp', 'instagram', 'messenger', 'site', 'telegram'));

-- Chat do site: liga/desliga pela Diretoria (Configurar atendimento). Começa desligado.
insert into public.settings (chave, valor) values ('atendimento_chat_site', 'false'::jsonb)
on conflict (chave) do nothing;
