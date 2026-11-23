-- 0155: contratação direta dos planos (áudios do Carlos, 23/11/2026).
--
-- Antes, todo plano pago virava um pedido que esperava a Central "liberar a
-- proposta" (assinatura_liberar) para só então o cliente aceitar e pagar.
-- Na prática ninguém conseguia comprar: o pedido caía na Central, o cliente
-- não via Pix nem cartão e ficava sem acesso.
--
-- Esta função faz a liberação no lugar da Central quando o plano não precisa
-- de atendimento individual: preço fechado na tabela, plano por conta (não de
-- escritório) e sem complementos que a Central configure à mão. Depois dela o
-- servidor chama a mesma assinatura_aceitar de sempre, que emite a fatura no
-- Asaas (Pix, boleto ou cartão). Planos de escritório, sob orçamento ou com
-- complementos especiais continuam indo para a fila da Central.
--
-- Planos de escritório (corretor Essencial/Profissional/Premium e técnico
-- Essencial em diante) precisam de um escritório administrado pelo titular.
-- Se a conta ainda não tem, a função cria o escritório com o titular como
-- administrador; o plano só passa a valer nele depois do pagamento. O
-- profissional técnico continua precisando do cadastro profissional aprovado.
--
-- A "Consulta territorial" (tecnico_consulta, R$ 29,90) serve qualquer conta
-- que só quer consultar: corretor, comprador ou profissional técnico. Por isso
-- ela é contratada no perfil ativo da conta, e não só no de profissional técnico.
--
-- Idempotente: create or replace.

create or replace function public.assinatura_contratar_direto(p_titular uuid, p_pedido uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  conta public.profiles;
  p public.solicitacoes_planos;
  q jsonb;
  n text;
  prefixo text;
  v public.plans;
  orgs uuid[];
  nova_org uuid;
  extra int; vagas int; primeira int; normal int;
begin
  select * into conta from public.profiles where user_id = p_titular and ativo;
  if not found then raise exception using errcode = '42501', message = 'Conta indisponível.'; end if;

  select * into p from public.solicitacoes_planos where id = p_pedido and user_id = p_titular for update;
  if not found then raise exception using errcode = 'P0002', message = 'Pedido não encontrado.'; end if;
  -- já liberado (pela Central ou numa tentativa anterior): segue para o aceite
  if exists (select 1 from public.assinaturas_cotadas where id = p.id) and p.status <> 'cancelado' then
    return (select nicho from public.assinaturas_cotadas where id = p.id);
  end if;
  if p.status not in ('pendente', 'em_analise') then
    raise exception using errcode = '55000', message = 'Este pedido já foi tratado. Abra Meus pedidos para continuar.';
  end if;

  q := p.cotacao;
  prefixo := case q->>'personaId' when 'proprietario' then 'proprietario' when 'produtor_rural' then 'produtor'
                                  when 'profissional_tecnico' then 'tecnico' when 'corretor_imobiliaria' then 'corretor' end;
  n := case q->>'personaId' when 'proprietario' then 'proprietario' when 'produtor_rural' then 'produtor_rural'
                            when 'profissional_tecnico' then 'engenheiro' when 'corretor_imobiliaria' then 'corretor_imobiliaria' end;
  if q->>'planoId' = 'tecnico_consulta'
     and conta.nicho in ('engenheiro', 'corretor_imobiliaria', 'consulta', 'comprador_investidor') then
    n := conta.nicho;
  end if;

  select * into v from public.plans where id = q->>'planoId' and ativo and preco_mensal > 0;
  if not found or n is null or prefixo is null or split_part(v.id, '_', 1) <> prefixo
     or q->>'ciclo' not in ('mensal', 'anual') or (q->>'sobOrcamento')::boolean is distinct from false then
    raise exception using errcode = '55000', message = 'Este plano é configurado pela Central. Seu pedido já está na fila e você recebe a proposta em Meus pedidos.';
  end if;
  if v.escopo not in ('conta', 'organizacao') then
    raise exception using errcode = '55000', message = 'Este plano é configurado pela Central. Seu pedido já está na fila.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(q->'itens', '[]'::jsonb)) i
             where i->>'id' <> 'propriedade_adicional' or n <> 'proprietario')
     or exists (select 1 from public.cofre_concessoes where pedido_id = p.id) then
    raise exception using errcode = '55000', message = 'Os complementos escolhidos são configurados pela Central. Seu pedido já está na fila.';
  end if;
  if conta.nicho is distinct from n then
    raise exception using errcode = '55000', message = 'Este plano é de outro perfil da conta. Troque o perfil ativo para o do plano, ou fale com a Central.';
  end if;

  if v.escopo = 'organizacao' then
    if n = 'engenheiro' and not exists (select from public.partners where profile_id = p_titular and tipo = 'engenheiro' and status in ('ativo', 'aprovado')) then
      raise exception using errcode = '55000', message = 'O plano de escritório pede o cadastro profissional aprovado pela Central. Seu pedido ficou na fila e a Central entra em contato.';
    end if;
    select array_agg(m.org_id) into orgs from public.organization_members m join public.organizations o on o.id = m.org_id and o.ativo
      where m.user_id = p_titular and m.status = 'ativo' and m.papel_org = 'admin' and m.nicho_vinculo = n;
    if coalesce(cardinality(orgs), 0) > 1 then
      raise exception using errcode = '55000', message = 'A conta administra mais de um escritório. A Central confere qual recebe o plano.';
    end if;
    if coalesce(cardinality(orgs), 0) = 0 then
      if exists (select from public.organization_members where user_id = p_titular and status = 'ativo') then
        raise exception using errcode = '55000', message = 'Sua conta já participa de outro escritório. A Central confere antes da cobrança.';
      end if;
      insert into public.organizations(nome, tipo, ativo, created_by, observacoes)
        values (left(coalesce(nullif(trim(conta.nome), ''), 'Escritório') || ' · escritório', 120),
                case when n = 'corretor_imobiliaria' then 'imobiliaria' else 'empresa' end, true, p_titular,
                'Criado na contratação direta do plano ' || v.id || ' (pedido ' || p.id || ').')
        returning id into nova_org;
      insert into public.organization_members(org_id, user_id, email, papel_org, status, convidado_por, aceito_em, nicho_vinculo)
        values (nova_org, p_titular, coalesce((select email from auth.users where id = p_titular), ''), 'admin', 'ativo', p_titular, now(), n);
    end if;
  end if;

  extra := coalesce((q->>'adicionaisMensaisCentavos')::int, 0);
  primeira := (q->>'baseCicloCentavos')::int;
  normal := case q->>'ciclo' when 'anual' then primeira else (q->>'mensalRecorrenteCentavos')::int - extra end;
  select coalesce(sum((i->>'quantidade')::int), 0) into vagas from jsonb_array_elements(coalesce(q->'itens', '[]'::jsonb)) i;
  if coalesce(primeira, 0) <= 0 or coalesce(normal, 0) <= 0 or extra < 0 or (extra = 0) <> (vagas = 0) then
    raise exception using errcode = '55000', message = 'Os valores do pedido não conferem. A Central revisa e libera a proposta.';
  end if;

  update public.solicitacoes_planos set status = 'em_analise', updated_at = now() where id = p.id and status = 'pendente';
  insert into public.assinaturas_cotadas(id, titular, nicho, plano, ciclo, primeira, recorrente, adicionais, vagas, liberado_por, escopo_confirmado)
  values (p.id, p_titular, n, v.id, q->>'ciclo', primeira, normal, extra, vagas, p_titular,
          'Plano ' || v.nome || ', contratado diretamente pelo site. Recursos, limites e condições conforme a página de planos na data da contratação.')
  on conflict (id) do nothing;
  insert into public.audit_log(user_id, acao, entidade, entidade_id, dados_depois)
    values (p_titular, 'assinatura.contratacao_direta', 'solicitacoes_planos', p.id,
            jsonb_build_object('plano', v.id, 'ciclo', q->>'ciclo', 'nicho', n));
  return n;
end $$;

revoke all on function public.assinatura_contratar_direto(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assinatura_contratar_direto(uuid, uuid) to service_role;
