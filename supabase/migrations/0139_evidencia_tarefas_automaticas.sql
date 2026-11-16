-- Critério e distribuição das novas tarefas. A fila setorial continua atendendo
-- instalações sem colaborador ativo e as atribuições anteriores permanecem como registradas.
create function public.central_preparar_tarefa_automatica() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if nullif(trim(new.criterio_conclusao),'') is null then
    new.criterio_conclusao:=case lower(coalesce(new.regra,''))
      when 'lead sem atendimento' then 'Registrar o primeiro atendimento na oportunidade ou a atribuição a um responsável com encaminhamento documentado.'
      when 'visita sem relatório' then 'Anexar o relatório à visita realizada ou registrar seu cancelamento ou não comparecimento.'
      when 'encaminhamento sem aceite' then 'Registrar na tarefa de origem o aceite, a redistribuição ou a decisão da Diretoria.'
      when 'cadastro parado' then 'Registrar a decisão ou pendência na ficha do imóvel e referenciar a movimentação.'
      when 'despesa_vencida' then 'Conferir o pagamento registrado na despesa ou documentar sua baixa e o comprovante correspondente.'
      when 'despesa_sem_aprovacao' then 'Registrar aprovação ou reprovação na despesa, com o autor da decisão.'
      when 'ajuste_ponto_parado' then 'Conferir o pedido de ajuste e registrar a decisão da Diretoria.'
      when 'publicacao_parada' then 'Registrar a decisão de aprovação do material e identificar a publicação correspondente.'
      when 'whatsapp_sem_resposta' then 'Registrar a mensagem de saída da conversa ou o encaminhamento comercial.'
      when 'whatsapp_sem_lead' then 'Registrar a resposta ao contato ou sua vinculação a uma oportunidade.'
      when 'consulta_car_whatsapp' then 'Conferir a entrega na conversa de origem e registrar o resultado ou a resposta enviada.'
      when 'crm_prazo_etapa' then 'Registrar a etapa de destino ou a resolução do atraso no item de CRM.'
      when 'cadastro interrompido' then 'Registrar a retomada, o atendimento autorizado ou o encerramento do acompanhamento.'
      when 'recuperação de assinatura' then 'Identificar a primeira fatura do plano paga, o cancelamento da assinatura ou o desfecho do atendimento.'
      when 'kit_pendente' then 'Aprovar o kit do imóvel ou registrar por que a autorização não permite sua divulgação.'
      when 'reserva_vencendo' then 'Conferir a reserva e registrar o desfecho ou a orientação ao participante.'
      when 'missao_atrasada' then 'Revisar as etapas pendentes e registrar a decisão para a reserva vencida.'
      when 'meta_atrasada' then 'Conferir as publicações validadas da etapa e registrar o encaminhamento para a meta vencida.'
      when 'reavaliar_seguidores' then 'Registrar a contagem verificada, a data e a justificativa no cadastro do divulgador.'
      when 'conferir_publicidade' then 'Conferir a venda, o contrato e os documentos fiscais e registrar o parecer de remuneração.'
      when 'demanda_compativel' then 'Registrar o retorno comercial da correspondência entre a demanda e o imóvel.'
      when 'solicitacao_cartografica' then 'Conferir a decisão e o estado final no protocolo de cartografia.'
      when 'revisao_imovel' then 'Conferir a decisão ou a retirada da versão proposta na ficha do anúncio.'
      else 'Identificar na evidência o registro de origem, a providência tomada e o resultado da verificação de '||coalesce(nullif(trim(new.regra),''),new.titulo)||'.'
    end;
  end if;
  if new.responsavel is null then
    select p.user_id into new.responsavel from public.profiles p
    where p.ativo and (p.role='admin_central' or (p.role='analista_arini' and new.setor<>'diretoria' and new.setor=any(p.setores)))
    order by (p.role='admin_central'),(select count(*) from public.tasks t where t.responsavel=p.user_id and t.status in ('aberta','andamento','aguardando','bloqueada')),p.user_id limit 1;
  end if;
  return new;
end $$;
revoke all on function public.central_preparar_tarefa_automatica() from public,anon,authenticated;
create trigger trg_central_preparar_automatica before insert on public.tasks for each row when(new.origem='automatica') execute function public.central_preparar_tarefa_automatica();

create function public.central_registrar_criacao_automatica() returns trigger language plpgsql security definer set search_path='' as $$
declare dados jsonb;
begin
  dados:=jsonb_build_object('regra',new.regra,'chave',new.chave_evento,'setor',new.setor,'automatico',true,
    'responsavel',new.responsavel,'solicitante',new.criado_por,'criterio_conclusao',new.criterio_conclusao);
  insert into public.task_events(task_id,tipo,para_setor,texto,dados)
  values(new.id,'criada',new.setor,'Tarefa criada pela regra '||coalesce(new.regra,new.titulo)||'.',dados);
  insert into public.audit_log(acao,entidade,entidade_id,property_id,opportunity_id,dados_depois)
  values('tarefa_automatica','tasks',new.id,new.property_id,new.opportunity_id,dados);
  return new;
end $$;
revoke all on function public.central_registrar_criacao_automatica() from public,anon,authenticated;
create trigger trg_central_criacao_automatica after insert on public.tasks for each row when(new.origem='automatica') execute function public.central_registrar_criacao_automatica();

-- O gatilho registra a criação tanto para esta RPC quanto para as inserções das rotas.
create or replace function public.fn_tarefa_automatica(
  p_chave text,p_regra text,p_setor text,p_titulo text,p_descricao text,p_responsavel uuid,p_prazo date,p_prioridade text,
  p_property uuid default null,p_opportunity uuid default null
) returns uuid language plpgsql set search_path='' as $$
declare criada uuid;
begin
  if exists(select from public.tasks where chave_evento=p_chave) then return null; end if;
  insert into public.tasks(titulo,descricao,setor,responsavel,prazo,prioridade,origem,regra,chave_evento,property_id,opportunity_id,aceite_em)
  values(left(p_titulo,200),p_descricao,p_setor,p_responsavel,p_prazo,p_prioridade,'automatica',p_regra,p_chave,p_property,p_opportunity,now())
  on conflict(chave_evento) where chave_evento is not null do nothing returning id into criada;
  return criada;
end $$;
revoke all on function public.fn_tarefa_automatica(text,text,text,text,text,uuid,date,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_tarefa_automatica(text,text,text,text,text,uuid,date,text,uuid,uuid) to service_role;

-- O predicado na escrita resolve repetições, corridas e tarefas já encerradas.
create function public.central_registrar_baixa(p_id uuid,p_status text,p_autor uuid,p_evidencia text,p_entidade text,p_referencia text)
returns boolean language plpgsql security definer set search_path='' as $$
declare t public.tasks%rowtype; dados jsonb;
begin
  if nullif(trim(p_evidencia),'') is null or nullif(trim(p_entidade),'') is null or nullif(trim(p_referencia),'') is null then
    raise exception 'Informe a evidência e a referência do evento.' using errcode='22023';end if;
  if p_status not in ('concluida','cancelada') then raise exception 'Estado final inválido.'; end if;
  update public.tasks set status=p_status,concluida_em=now(),evidencia=left(trim(p_evidencia),1500)||' ['||p_entidade||' '||left(p_referencia,180)||']'
    where id=p_id and status in ('aberta','andamento','aguardando','bloqueada') returning * into t;
  if not found then return false;end if;
  dados:=jsonb_build_object('status',p_status,'origem','automacao','regra',t.regra,'referencia_tipo',p_entidade,'referencia',p_referencia,'responsavel_tarefa',t.responsavel);
  insert into public.task_events(task_id,tipo,autor,para_setor,texto,dados) values(t.id,'status',p_autor,t.setor,t.evidencia,dados);
  insert into public.audit_log(user_id,acao,entidade,entidade_id,property_id,opportunity_id,dados_depois) values(p_autor,'tarefa_'||p_status||'_por_evento','tasks',t.id,t.property_id,t.opportunity_id,dados);
  return true;
end $$;
revoke all on function public.central_registrar_baixa(uuid,text,uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.central_concluir_evento(p_chave text,p_autor uuid,p_evidencia text,p_entidade text,p_referencia text)
returns boolean language sql security definer set search_path='' as $$
  select public.central_registrar_baixa((select id from public.tasks where chave_evento=p_chave and origem='automatica'),'concluida',p_autor,p_evidencia,p_entidade,p_referencia);
$$;
revoke all on function public.central_concluir_evento(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.central_concluir_evento(text,uuid,text,text,text) to service_role;

-- A decisão já foi persistida quando o gatilho fecha a respectiva tarefa.
alter table public.despesas add column pago_por uuid references public.profiles(user_id) on delete set null;
create function public.central_decisao_despesa() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('aprovada','reprovada') then
    perform public.central_concluir_evento('despesa_aprovacao:'||new.id,new.aprovado_por,'Despesa '||new.codigo||' '||new.status||'.','despesas',new.id::text);
  elsif new.status='paga' then
    perform public.central_concluir_evento('despesa_vencida:'||new.id,new.pago_por,'Pagamento registrado na despesa '||new.codigo||'.','despesas',new.id::text);
  end if;
  return new;
end $$;
revoke all on function public.central_decisao_despesa() from public,anon,authenticated;
create trigger trg_central_decisao_despesa after update of status on public.despesas for each row when(old.status is distinct from new.status) execute function public.central_decisao_despesa();

-- A decisão de inclusão e a marcação correspondente são confirmadas na mesma transação.
create function public.central_decisao_ponto() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='aprovado' and new.tipo='incluir' and not exists(select from public.ponto_marcacoes where ajuste_id=new.id) then
    insert into public.ponto_marcacoes(user_id,marcado_em,origem,ajuste_id) values(new.user_id,new.horario,'ajuste',new.id);
  end if;
  perform public.central_concluir_evento('ponto_ajuste:'||new.id,new.decidido_por,'Ajuste de ponto '||new.status||'.','ponto_ajustes',new.id::text);
  return new;
end $$;
revoke all on function public.central_decisao_ponto() from public,anon,authenticated;
create trigger trg_central_decisao_ponto after update of status on public.ponto_ajustes for each row
  when(old.status='pendente' and new.status in ('aprovado','reprovado')) execute function public.central_decisao_ponto();

-- Tarefas anteriores à chave formal são identificadas pela versão ou pelo protocolo
-- originalmente gravados. Apenas a nova decisão encerra a tarefa correspondente.
create function public.central_decisao_revisao() returns trigger language plpgsql security definer set search_path='' as $$
declare tarefa uuid;
begin
  for tarefa in select id from public.tasks where status in ('aberta','andamento','aguardando','bloqueada') and
    (chave_evento='revisao_imovel:'||new.id or (chave_evento is null and setor='operacoes' and property_id=new.property_id
      and titulo like 'Alteração proposta — %' and starts_with(descricao,'Versão '||new.versao||' do anúncio ')))
  loop
    perform public.central_registrar_baixa(tarefa,case when new.status='cancelada' then 'cancelada' else 'concluida' end,new.revisada_por,
      'Revisão '||new.versao||' do anúncio '||new.status||'.','property_revisions',new.id::text);
  end loop;
  return new;
end $$;
revoke all on function public.central_decisao_revisao() from public,anon,authenticated;
create trigger trg_central_decisao_revisao after update of status on public.property_revisions for each row
  when(old.status='pendente' and new.status in ('aprovada','rejeitada','cancelada')) execute function public.central_decisao_revisao();

create function public.central_decisao_cartografia() returns trigger language plpgsql security definer set search_path='' as $$
declare protocolo_atual text; tarefa uuid;
begin
  select protocolo into protocolo_atual from public.cartographic_requests where id=new.request_id and status=new.para_status;
  if not found then return new; end if;
  for tarefa in select id from public.tasks where status in ('aberta','andamento','aguardando','bloqueada') and
    (chave_evento='solicitacao_cartografica:'||new.request_id or (chave_evento is null and setor='cartografia'
      and starts_with(titulo,'Solicitação '||protocolo_atual||' — ')))
  loop
    perform public.central_registrar_baixa(tarefa,'concluida',new.user_id,'Solicitação '||protocolo_atual||' '||new.para_status||'.',
      'cartographic_request_events',new.id::text);
  end loop;
  return new;
end $$;
revoke all on function public.central_decisao_cartografia() from public,anon,authenticated;
create trigger trg_central_decisao_cartografia after insert on public.cartographic_request_events for each row
  when(new.de_status is distinct from new.para_status and new.para_status in ('publicada','rejeitada','cancelada')) execute function public.central_decisao_cartografia();

create or replace function public.assinatura_preparar_contatos() returns integer language plpgsql security definer set search_path='' as $$
declare contato public.assinatura_contatos; resultado integer:=0; perdido record; tarefa record;
begin
  perform public.retomada_comercial();
  -- Uma fatura paga ou uma desistência deixam de figurar na agenda imediatamente.
  update public.assinatura_contatos c set status='cancelado',alterado_em=now() where status='pendente' and not exists
    (select from public.assinatura_agenda_contato a where (a.assinatura,a.tipo,a.referencia,a.passo)=(c.assinatura,c.tipo,c.referencia,c.passo) and a.permitido and a.modelo_id is not null);
  for contato in
    insert into public.assinatura_contatos(assinatura,titular,tipo,referencia,passo,texto,status)
    select a.assinatura,a.titular,a.tipo,a.referencia,a.passo,a.texto,case when a.modelo_id is not null and a.permitido
      and public.assinatura_titular_telefone(a.telefone)=a.titular then 'pendente' else 'painel' end
    from public.assinatura_agenda_contato a where not exists(select from public.assinatura_contatos c
      where (a.assinatura,a.tipo,a.referencia,a.passo)=(c.assinatura,c.tipo,c.referencia,c.passo))
    order by a.referencia,a.assinatura,a.passo limit 100 on conflict do nothing returning *
  loop
    perform public.fn_notificar(contato.titular,'info','Assinatura ARINI',contato.texto,'/planos/solicitacoes','assinatura:'||contato.id);
    if contato.tipo='renovacao' then update public.assinatura_reajustes set avisado_em=now() where assinatura=contato.assinatura and vigencia=contato.referencia and avisado_em is null; end if;
    resultado:=resultado+1;
  end loop;
  -- Depois das tentativas, a equipe pode distribuir a tarefa pela fila normal do Comercial.
  for perdido in
    select a.assinatura,a.nome from public.assinatura_agenda_contato a join public.assinatura_contatos c using(assinatura,tipo,referencia,passo)
    join public.assinatura_regras_contato r using(tipo)
    where a.tipo='recuperacao' and (a.passo=cardinality(r.dias) and c.alterado_em<=now()-interval '1 day'
        or a.passo=1 and c.status in ('conferir','enviando','pendente','cancelado') and c.alterado_em<=now()-interval '5 days')
      and c.status in ('painel','enviado','recusado','conferir','enviando','pendente','cancelado')
      and not exists(select from public.tasks t where t.chave_evento='recuperacao_assinatura:'||a.assinatura)
    limit 80
  loop
    perform public.fn_tarefa_automatica('recuperacao_assinatura:'||perdido.assinatura,'Recuperação de assinatura','comercial',
      'Acompanhar contratação de '||perdido.nome,'Conferir pedido '||perdido.assinatura||' e o histórico em Assinaturas e contatos. Respeitar os canais autorizados.',
      null,(now() at time zone 'America/Sao_Paulo')::date,'normal');
  end loop;
  for tarefa in
    select t.chave_evento,s.id assinatura,s.cancelado,f.id fatura from public.tasks t
      join public.assinaturas_cotadas s on t.chave_evento='recuperacao_assinatura:'||s.id
      left join public.faturas_cotadas f on f.assinatura=s.id and f.componente='plano' and f.numero=0 and f.status='paga'
    where t.status not in ('concluida','cancelada') and (s.cancelado is not null or f.id is not null)
  loop
    if tarefa.cancelado is not null then
      perform public.central_concluir_evento(tarefa.chave_evento,null,'Cancelamento da assinatura confirmado em '||tarefa.cancelado||'.','assinaturas_cotadas',tarefa.assinatura::text);
    else
      perform public.central_concluir_evento(tarefa.chave_evento,null,'Primeira fatura do plano confirmada como paga.','faturas_cotadas',tarefa.fatura::text);
    end if;
  end loop;
  return resultado;
end $$;
