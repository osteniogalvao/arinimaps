-- O regime roteia o atendimento. Ele não modifica a autorização ou o contrato assinado do imóvel.
alter table public.properties add column regime_comercial text
  check (regime_comercial in ('EXCLUSIVO_ARINI','VENDA_PROPRIA_CRM','LEILAO','EXPOSICAO'));
update public.properties set regime_comercial=case when modalidade='leilao' then 'LEILAO' else 'EXCLUSIVO_ARINI' end;
create function public.fn_regime_inicial() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.regime_comercial is null then new.regime_comercial:=case when new.modalidade='leilao' then 'LEILAO' else 'EXCLUSIVO_ARINI' end; end if;
  return new;
end $$;
create trigger trg_regime_inicial before insert on public.properties for each row execute function public.fn_regime_inicial();
alter table public.properties alter column regime_comercial set not null;

alter table public.opportunities add column regime_na_origem text
  check (regime_na_origem in ('EXCLUSIVO_ARINI','VENDA_PROPRIA_CRM','LEILAO','EXPOSICAO')),
  add column protecao_ate timestamptz;
create index idx_interesse_comprador on public.opportunities(comprador_profile_id,property_id,created_at desc) where comprador_profile_id is not null;

create function public.fn_regime_comercial(p_id uuid,p_ator uuid,p_anterior text,p_regime text)
returns void language plpgsql set search_path=public,pg_temp as $$
declare im public.properties%rowtype;
begin
  select * into strict im from public.properties where id=p_id for update;
  if im.regime_comercial is distinct from p_anterior then raise exception 'O regime mudou. Atualize a página.'; end if;
  if p_regime='LEILAO' and im.modalidade<>'leilao' then raise exception 'Selecione um anúncio de leilão.'; end if;
  update public.properties set regime_comercial=p_regime where id=p_id;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,property_id,dados_antes,dados_depois)
    values(p_ator,'regime_comercial_atualizado','properties',p_id,p_id,jsonb_build_object('regime',p_anterior),jsonb_build_object('regime',p_regime));
end $$;

create function public.fn_interesse_no_mapa(p_codigo text,p_cliente uuid,p_regime text,p_nome text,p_telefone text,p_email text,p_mensagem text,p_versao text,p_utm jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare im public.properties%rowtype; op public.opportunities%rowtype; lid uuid; dias integer; responsavel public.responsible_type;
begin
  select * into im from public.properties where codigo=p_codigo and status in ('publicado','em_negociacao') for share;
  if not found then raise exception 'Imóvel indisponível.'; end if;
  if im.regime_comercial is distinct from p_regime then raise exception 'O responsável pelo anúncio mudou. Atualize a ficha para conferir o destinatário.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_cliente::text||im.id::text,8));
  select * into op from public.opportunities where property_id=im.id and comprador_profile_id=p_cliente
    and etapa not in ('fechado','pos_venda','perdido') order by created_at desc limit 1;
  if found then return jsonb_build_object('id',op.id,'codigo',op.codigo,'regime',coalesce(op.regime_na_origem,im.regime_comercial),'novo',false); end if;
  if im.regime_comercial='EXCLUSIVO_ARINI' then
    responsavel:='arini';
    select (valor #>> '{}')::integer into dias from public.settings where chave='protecao_dias' and jsonb_typeof(valor)='number';
  elsif im.partner_id is not null then responsavel:='parceiro';
  elsif im.owner_id is not null then responsavel:='proprietario';
  else raise exception 'Responsável pelo anúncio ainda não configurado.'; end if;
  insert into public.leads(property_id,nome,telefone,email,mensagem,origem,canal,utm,consentimento_lgpd,consentimento_versao,status)
    values(im.id,p_nome,p_telefone,p_email,p_mensagem,'pagina',p_utm->>'utm_source',p_utm,true,p_versao,'em_oportunidade') returning id into lid;
  insert into public.opportunities(lead_id,property_id,comprador_profile_id,regime_na_origem,protecao_ate,responsavel_tipo,responsavel_partner_id)
    values(lid,im.id,p_cliente,im.regime_comercial,case when dias>0 then now()+make_interval(days=>dias) end,
      responsavel,case when responsavel='parceiro' then im.partner_id end) returning * into op;
  insert into public.opportunity_events(opportunity_id,tipo,descricao,autor)
    values(op.id,'contato','Interesse registrado no mapa. Regime: '||im.regime_comercial,p_cliente);
  insert into public.audit_log(user_id,acao,entidade,entidade_id,property_id,opportunity_id,dados_depois)
    values(p_cliente,'lead_criado','leads',lid,im.id,op.id,jsonb_build_object('origem','MAPA_ARINI','regime',im.regime_comercial));
  return jsonb_build_object('id',op.id,'codigo',op.codigo,'regime',im.regime_comercial,'lead_id',lid,'novo',true);
end $$;
revoke all on function public.fn_interesse_no_mapa(text,uuid,text,text,text,text,text,text,jsonb),public.fn_regime_comercial(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fn_interesse_no_mapa(text,uuid,text,text,text,text,text,text,jsonb),public.fn_regime_comercial(uuid,uuid,text,text) to service_role;

-- A mesma RPC da Central continua fechando as vendas e cancelando a mensalidade;
-- uma venda cuja origem foi leilão, exposição ou CRM próprio não gera comissão ARINI.
create or replace function public.fn_registrar_venda(p_opportunity_id uuid,p_valor numeric,p_data date,p_participantes jsonb,p_percentual numeric,p_regra text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare op public.opportunities%rowtype; im public.properties%rowtype; venda uuid;
begin
  select * into strict op from public.opportunities where id=p_opportunity_id for update;
  select * into strict im from public.properties where id=op.property_id for update;
  insert into public.sales(opportunity_id,property_id,valor_final,data_venda,participantes)
    values(op.id,im.id,p_valor,coalesce(p_data,current_date),coalesce(p_participantes,'{}'::jsonb)) returning id into venda;
  if coalesce(op.regime_na_origem,im.regime_comercial)='EXCLUSIVO_ARINI' then
    insert into public.commissions(sale_id,base_calculo,percentual,valor,regra_contratual)
      values(venda,p_valor,p_percentual,round(p_valor*p_percentual/100.0,2),p_regra);
  end if;
  if im.status in ('publicado','em_negociacao') then update public.properties set status='vendido' where id=im.id; end if;
  update public.opportunities set etapa='fechado' where id=op.id;
  update public.subscriptions set status='cancelada' where property_id=im.id;
  return venda;
end $$;

