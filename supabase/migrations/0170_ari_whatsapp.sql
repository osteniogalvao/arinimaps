-- 0170 · Ari no WhatsApp (24/11/2026, pedido do Carlos, aprovado pelo Stenio)
--
-- O cliente consulta imóveis pelo mesmo número da ARINI conversando com a Ari.
--   · o menu ganha a opção "Consultar imóveis à venda" (acao = 'ari');
--   · se a PRIMEIRA mensagem já for uma busca clara ("fazenda de 100 ha em
--     Iturama"), a Ari responde direto, sem menu;
--   · "0", "corretor" ou "quero visitar" passam para o Comercial (lead com
--     rodízio quando há imóvel de interesse);
--   · a Ari fala só enquanto nenhum humano assumiu a conversa.
-- Idempotente. Depois de rodar, nada muda até o WhatsApp estar conectado.

-- 1. Liga/desliga e limite diário (Atendimento › Configurar)
alter table public.atendimento_menu add column if not exists ari_ativo boolean not null default true;
alter table public.atendimento_menu add column if not exists ari_limite_dia int not null default 40;
alter table public.atendimento_menu drop constraint if exists atendimento_menu_ari_limite_dia_check;
alter table public.atendimento_menu add constraint atendimento_menu_ari_limite_dia_check check (ari_limite_dia between 1 and 500);

-- 2. O que cada opção do menu faz: encaminhar a um setor (padrão) ou abrir a Ari
alter table public.atendimento_menu_opcoes add column if not exists acao text not null default 'setor';
alter table public.atendimento_menu_opcoes drop constraint if exists atendimento_menu_opcoes_acao_check;
alter table public.atendimento_menu_opcoes add constraint atendimento_menu_opcoes_acao_check check (acao in ('setor', 'ari'));

-- "0 - Falar com um atendente" continua por último
update public.atendimento_menu_opcoes set ordem = 8 where chave = '0' and ordem = 7;
insert into public.atendimento_menu_opcoes (ordem, chave, rotulo, setor, etiqueta, acao, confirmacao) values
  (7, '7', 'Consultar imóveis à venda', null, 'busca-imoveis', 'ari',
   'Perfeito! Sou a Ari, assistente da ARINI. Me conte o que você procura: tipo (fazenda, sítio, lote, casa), cidade, tamanho e faixa de valor.' || chr(10) ||
   'Ex.: *fazenda de 100 ha em Iturama até 3 milhões*' || chr(10) || chr(10) ||
   'Para falar com um corretor a qualquer momento, responda *0*.')
on conflict (chave) do nothing;

-- 3. Estado da Ari na conversa
alter table public.atendimento_conversas add column if not exists ari_ativa_em timestamptz;
alter table public.atendimento_conversas add column if not exists ari_dia date;
alter table public.atendimento_conversas add column if not exists ari_respostas_dia int not null default 0;
alter table public.atendimento_conversas add column if not exists ari_ultimo_imovel text;

-- 4. Conversa com a Ari (sem humano) não vira tarefa de "sem resposta"
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
      and not (c.ari_ativa_em is not null and c.setor is null and c.responsavel is null)
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
