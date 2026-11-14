-- Pedidos de avaliação comercial. Não cria assinatura, fatura nem permissão.
create table public.solicitacoes_planos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  chave uuid not null,
  email_contato text,
  selecao jsonb not null check (jsonb_typeof(selecao) = 'object'),
  cotacao jsonb not null check (jsonb_typeof(cotacao) = 'object'),
  status text not null default 'pendente' check (status in ('pendente','em_analise','concluido','cancelado')),
  atendido_por uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, chave)
);
create index solicitacoes_planos_fila on public.solicitacoes_planos(status, created_at desc, id desc);
create index solicitacoes_planos_historico on public.solicitacoes_planos(user_id, created_at desc, id desc);
alter table public.solicitacoes_planos enable row level security;
revoke all on public.solicitacoes_planos from public, anon, authenticated, service_role;
grant select on public.solicitacoes_planos to service_role;

-- Inserção e auditoria na mesma transação. A mesma chave não cria outro pedido,
-- mesmo com reenvio concorrente; mudança posterior na tabela de preços não
-- recalcula o orçamento já registrado ao repetir a solicitação original.
create function public.fn_solicitar_plano(p_user_id uuid, p_chave uuid, p_selecao jsonb, p_cotacao jsonb)
returns public.solicitacoes_planos language plpgsql security definer set search_path = '' as $$
declare r public.solicitacoes_planos;
begin
  perform 1 from public.profiles where user_id = p_user_id and ativo for share;
  if not found then raise sqlstate '42501' using message = 'Conta indisponível'; end if;
  insert into public.solicitacoes_planos(user_id, chave, selecao, cotacao, email_contato)
    values (p_user_id, p_chave, p_selecao, p_cotacao, (select email from auth.users where id = p_user_id))
    on conflict (user_id, chave) do nothing returning * into r;
  if found then
    insert into public.audit_log(user_id, acao, entidade, entidade_id, dados_depois)
      values (p_user_id, 'plano.solicitado', 'solicitacoes_planos', r.id, jsonb_build_object('status', r.status));
  else
    select * into strict r from public.solicitacoes_planos where user_id = p_user_id and chave = p_chave;
    if r.selecao is distinct from p_selecao then
      raise sqlstate '23505' using message = 'Chave já usada para outra seleção';
    end if;
  end if;
  return r;
end $$;

create function public.fn_atualizar_solicitacao_plano(p_ator uuid, p_id uuid, p_status text, p_central boolean)
returns public.solicitacoes_planos language plpgsql security definer set search_path = '' as $$
declare r public.solicitacoes_planos; anterior text;
begin
  perform 1 from public.profiles where user_id = p_ator and ativo and (
    p_central = false or role = 'admin_central' or (role = 'analista_arini' and 'financeiro' = any(setores))
  ) for share;
  if not found or p_central is null then raise sqlstate '42501' using message = 'Acesso negado'; end if;
  if p_status is null or p_status not in ('em_analise','concluido','cancelado') or
      (not p_central and p_status <> 'cancelado') then
    raise sqlstate '22023' using message = 'Situação inválida';
  end if;
  select * into r from public.solicitacoes_planos
    where id = p_id and (p_central or user_id = p_ator) for update;
  if not found then raise sqlstate 'P0002' using message = 'Pedido não encontrado'; end if;
  if r.status = p_status then return r; end if;
  if not ((r.status = 'pendente' and p_status in ('em_analise','cancelado'))
       or (r.status = 'em_analise' and p_status in ('concluido','cancelado'))) then
    raise sqlstate '55000' using message = 'A situação mudou; atualize a fila';
  end if;
  anterior := r.status;
  update public.solicitacoes_planos set status = p_status, updated_at = now(),
      atendido_por = case when p_central then p_ator else atendido_por end
    where id = p_id returning * into r;
  insert into public.audit_log(user_id, acao, entidade, entidade_id, dados_antes, dados_depois)
    values (p_ator, 'plano.situacao', 'solicitacoes_planos', r.id,
      jsonb_build_object('status', anterior), jsonb_build_object('status', r.status));
  return r;
end $$;

revoke all on function public.fn_solicitar_plano(uuid,uuid,jsonb,jsonb),
  public.fn_atualizar_solicitacao_plano(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.fn_solicitar_plano(uuid,uuid,jsonb,jsonb),
  public.fn_atualizar_solicitacao_plano(uuid,uuid,text,boolean) to service_role;
