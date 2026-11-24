-- Lacunas do documento CRM por setor: publicação incompleta, validade da
-- autorização e fila LGPD. Não altera anúncio, contrato, fatura nem responde ao titular.
-- Usa prazo do registro (LGPD/autorização) e prazo setorial configurado (material).
create or replace function public.fn_matriz_pendencias_origem() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record; t record; criada uuid; n integer:=0; fechadas integer:=0;
  hoje date:=(now() at time zone 'America/Sao_Paulo')::date; chave text;
begin
  -- Worker e botão Rodar agora podem coincidir: uma rodada por transação.
  perform pg_advisory_xact_lock(hashtext('matriz_pendencias_origem'));
  for t in select * from public.tasks where regra in ('matriz_material_incompleto','matriz_autorizacao_vencendo','matriz_pedido_lgpd')
    and status in ('aberta','andamento','aguardando','bloqueada')
  loop
    if (t.regra='matriz_material_incompleto' and not exists(
      select 1 from public.properties p where p.id=t.property_id and p.status in ('publicado','em_negociacao')
        and (nullif(trim(p.descricao),'') is null or not exists(select 1 from public.property_media m where m.property_id=p.id and m.capa))
    )) or (t.regra='matriz_autorizacao_vencendo' and not exists(
      select 1 from public.property_authorizations a join public.properties p on p.id=a.property_id
      where a.id::text=split_part(t.chave_evento,':',2) and a.validade::text=split_part(t.chave_evento,':',3)
        and a.validade<=hoje+30 and p.status in ('pendente','em_analise','correcao','aprovado','publicado','em_negociacao')
        and not exists(select 1 from public.exclusividade_eventos e where e.autorizacao=a.id and e.evento in ('desistencia','encerramento'))
    )) or (t.regra='matriz_pedido_lgpd' and not exists(
      select 1 from public.lgpd_requests l where l.id::text=split_part(t.chave_evento,':',2)
        and l.status in ('recebido','em_analise') and l.prazo::text=split_part(t.chave_evento,':',3)
    )) then
      if public.central_registrar_baixa(t.id,'concluida',null,
        'A condição que gerou a pendência deixou de existir; registro de origem conferido pelo motor.',
        t.regra,t.chave_evento) then fechadas:=fechadas+1; end if;
    end if;
  end loop;

  for r in select p.id,p.codigo,p.descricao,
    not exists(select 1 from public.property_media m where m.property_id=p.id and m.capa) sem_capa
    from public.properties p where p.status in ('publicado','em_negociacao')
      and (nullif(trim(p.descricao),'') is null or not exists(select 1 from public.property_media m where m.property_id=p.id and m.capa))
      and not exists(select 1 from public.tasks existente where existente.property_id=p.id and existente.regra='matriz_material_incompleto'
        and existente.status in ('aberta','andamento','aguardando','bloqueada'))
    order by p.id limit 500
  loop
    -- Nova ocorrência depois de uma correção também recebe tarefa; não revive
    -- tarefa antiga concluída nem perde a evidência da primeira ocorrência.
    select 'matriz_material:'||r.id||':'||count(*) into chave from public.tasks where property_id=r.id and regra='matriz_material_incompleto';
    criada:=public.fn_tarefa_automatica(chave,'matriz_material_incompleto','marketing','Completar material de '||r.codigo,
      'Imóvel publicado com pendência: '||concat_ws(' e ',case when r.sem_capa then 'foto de capa' end,
        case when nullif(trim(r.descricao),'') is null then 'descrição' end)||'. Corrigir na ficha do imóvel; a rotina confere a origem antes de concluir.',
      null,null,'normal',r.id,null);
    if criada is not null then n:=n+1;end if;
  end loop;

  for r in select a.id,a.property_id,a.validade,p.codigo from public.property_authorizations a join public.properties p on p.id=a.property_id
    where a.validade<=hoje+30 and p.status in ('pendente','em_analise','correcao','aprovado','publicado','em_negociacao')
      and not exists(select 1 from public.exclusividade_eventos e where e.autorizacao=a.id and e.evento in ('desistencia','encerramento'))
      and not exists(select 1 from public.tasks existente where existente.chave_evento='matriz_autorizacao:'||a.id||':'||a.validade)
    order by a.validade,a.id limit 500
  loop
    criada:=public.fn_tarefa_automatica('matriz_autorizacao:'||r.id||':'||r.validade,'matriz_autorizacao_vencendo','juridico','Conferir autorização de '||r.codigo,
      'A autorização vence em '||to_char(r.validade,'DD/MM/YYYY')||'. Conferir renovação ou encerramento com Operações; o motor não renova nem altera o contrato.',
      null,r.validade,case when r.validade<hoje then 'alta' else 'normal' end,r.property_id,null);
    if criada is not null then n:=n+1;end if;
  end loop;
  for r in select l.id,l.codigo,l.prazo from public.lgpd_requests l where l.status in ('recebido','em_analise')
    and not exists(select 1 from public.tasks existente where existente.chave_evento='matriz_lgpd:'||l.id||':'||l.prazo)
    order by l.prazo,l.id limit 500
  loop
    criada:=public.fn_tarefa_automatica('matriz_lgpd:'||r.id||':'||r.prazo,'matriz_pedido_lgpd','juridico','Analisar pedido '||r.codigo,
      'Pedido de titular aguardando análise humana. Prazo registrado: '||to_char(r.prazo,'DD/MM/YYYY')||'. Consulte a fila Jurídico / Pedidos LGPD; a Ari não responde nem decide o pedido.',
      null,r.prazo,case when r.prazo<hoje then 'alta' else 'normal' end,null,null);
    if criada is not null then n:=n+1;end if;
  end loop;
  return jsonb_build_object('pendencias_origem_criadas',n,'pendencias_origem_resolvidas',fechadas);
end $$;
revoke all on function public.fn_matriz_pendencias_origem() from public,anon,authenticated;
grant execute on function public.fn_matriz_pendencias_origem() to service_role;
