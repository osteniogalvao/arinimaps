-- Os novos termos pertencem à ARINI Imóveis. Comissões antigas mantêm o fluxo anterior.
alter table public.commissions
  add column autorizacao_id uuid references public.property_authorizations(id),
  add column captador_id uuid references public.partners(id),
  add column recebido numeric(14,2) check (recebido between 0 and valor);

create table public.comissao_recebimentos (
  id uuid primary key default gen_random_uuid(),
  comissao_id uuid not null references public.commissions(id),
  referencia text not null check (length(referencia) between 3 and 120),
  recebido_em date not null,
  valor numeric(14,2) not null check (valor>=0),
  repasse numeric(14,2) not null default 0 check (repasse>=0),
  repassado numeric(14,2) not null default 0 check (repassado>=0),
  em_conferencia boolean not null default false,
  motivo_conferencia text,
  evento_gateway_em timestamptz,
  criado_em timestamptz not null default now(),
  unique(comissao_id,referencia)
);
create table public.comissao_movimentos (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references public.comissao_recebimentos(id),
  tipo text not null check (tipo in ('recebimento','repasse')),
  diferenca numeric(14,2) not null,
  data date not null,
  documento text not null,
  autor uuid references public.profiles(user_id),
  criado_em timestamptz not null default now()
);
create index comissao_movimentos_recebimento on public.comissao_movimentos(recebimento_id);
alter table public.comissao_recebimentos enable row level security;
alter table public.comissao_movimentos enable row level security;
revoke all on public.comissao_recebimentos,public.comissao_movimentos from public,anon,authenticated;
grant select on public.comissao_recebimentos,public.comissao_movimentos to service_role;

create or replace function public.fn_registrar_venda(p_opportunity_id uuid,p_valor numeric,p_data date,p_participantes jsonb,p_percentual numeric,p_regra text)
returns uuid language plpgsql security definer set search_path='' as $$
declare op public.opportunities%rowtype; im public.properties%rowtype; a public.property_authorizations%rowtype;
  venda uuid; captador uuid; percentual numeric; versao_nova boolean; regra text;
begin
  if p_valor is null or p_valor<=0 or p_valor::text in ('NaN','Infinity') then raise exception 'Valor de venda inválido.'; end if;
  select * into strict op from public.opportunities where id=p_opportunity_id for update;
  select * into strict im from public.properties where id=op.property_id for update;
  select * into a from public.property_authorizations where property_id=im.id and aceite_at is not null
    order by aceite_at desc,created_at desc,id desc limit 1;
  versao_nova := coalesce(a.versao in ('exclusividade@2026.11.15,remuneracao@2026.11.15','parceiros@2026.11.15,remuneracao@2026.11.15'),false);
  if versao_nova and coalesce(p_data,current_date)<(a.aceite_at at time zone 'America/Sao_Paulo')::date then
    raise exception 'Confira a data. A venda informada antecede o aceite deste contrato.'; end if;
  if versao_nova and exists(select from public.sales where property_id=im.id) then raise exception 'Já há venda registrada para este imóvel.'; end if;
  insert into public.sales(opportunity_id,property_id,valor_final,data_venda,participantes)
    values(op.id,im.id,p_valor,coalesce(p_data,current_date),coalesce(p_participantes,'{}'::jsonb)) returning id into venda;
  if coalesce(op.regime_na_origem,im.regime_comercial)='EXCLUSIVO_ARINI' and im.modalidade<>'leilao'
    and a.versao is distinct from 'termos-de-uso@2026.11.15,remuneracao@2026.11.15' then
    if versao_nova then
      if a.tipo='parceiro' and a.versao='parceiros@2026.11.15,remuneracao@2026.11.15' then
        select p.id into captador from public.partners p where p.id=im.partner_id and p.profile_id=a.aceite_por and p.tipo in ('corretor','imobiliaria');
        if captador is null or not exists(select from public.property_documents d where d.property_id=im.id and d.tipo='autorizacao'
          and d.verificado and d.substituido_por is null) then raise exception 'Confira o captador e a autorização do proprietário antes de registrar a venda.'; end if;
      elsif a.tipo<>'exclusividade' or a.versao<>'exclusividade@2026.11.15,remuneracao@2026.11.15' then
        raise exception 'Autorização incompatível com o contrato de venda.';
      end if;
      percentual:=1.9;
      regra:='ARINI Imóveis · Regra de Remuneração de 15/11/2026 · pagamento pelo proprietário.';
      if captador is not null then regra:=regra||' Repasse de 0,5% da mesma base ao captador, incluído nos 1,9%.'; end if;
    else
      select coalesce(p_percentual,(select (s.valor #>> '{}')::numeric from public.settings s where s.chave='comissao_percentual_padrao'),1.9) into percentual;
      regra:=p_regra;
    end if;
    if percentual<0 or percentual>100 or percentual::text='NaN' then raise exception 'Percentual inválido.'; end if;
    insert into public.commissions(sale_id,base_calculo,percentual,valor,regra_contratual,autorizacao_id,captador_id,recebido)
      values(venda,p_valor,percentual,round(p_valor*percentual/100,2),regra,case when versao_nova then a.id end,captador,case when versao_nova then 0 end);
  end if;
  if im.status in ('publicado','em_negociacao') then update public.properties set status='vendido' where id=im.id; end if;
  update public.opportunities set etapa='fechado' where id=op.id;
  update public.subscriptions set status='cancelada' where property_id=im.id;
  return venda;
end $$;

-- Notificações usam o resultado da mesma transação, inclusive quando não há comissão.
create function public.fn_registrar_venda_resumo(p_opportunity_id uuid,p_valor numeric,p_data date,p_participantes jsonb,p_percentual numeric,p_regra text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare venda uuid; comissao public.commissions%rowtype;
begin
  venda:=public.fn_registrar_venda(p_opportunity_id,p_valor,p_data,p_participantes,p_percentual,p_regra);
  select * into comissao from public.commissions where sale_id=venda;
  return jsonb_build_object('sale_id',venda,'percentual',comissao.percentual,'comissao',comissao.valor);
end $$;
revoke all on function public.fn_registrar_venda_resumo(uuid,numeric,date,jsonb,numeric,text) from public,anon,authenticated;
grant execute on function public.fn_registrar_venda_resumo(uuid,numeric,date,jsonb,numeric,text) to service_role;

-- Para esses contratos a contabilidade é por movimento, inclusive estornos e parcelas.
drop trigger trg_commissions_lancamento on public.commissions;
create trigger trg_commissions_lancamento after update of status on public.commissions
  for each row when (new.autorizacao_id is null) execute function public.trg_comissao_lancamento();

create function public.fn_conferir_quitacao() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status in ('paga','conciliada') and (new.recebido<>new.valor or new.recebido is null) then
    raise exception 'Registre primeiro o recebimento integral da comissão.'; end if;
  if new.status='conciliada' and exists(select from public.comissao_recebimentos where comissao_id=new.id
    and (em_conferencia or repassado<>repasse)) then raise exception 'Confira os recebimentos e baixe os repasses antes de conciliar.'; end if;
  return new;
end $$;
create trigger trg_conferir_quitacao before update of status on public.commissions
  for each row when (new.autorizacao_id is not null) execute function public.fn_conferir_quitacao();

-- Valor é o saldo efetivo deste comprovante após o evento, nunca um acréscimo.
-- O lock também serializa parcelas concorrentes e o arredondamento dos centavos.
create function public.fn_recebimento_comissao(p_id uuid,p_referencia text,p_valor numeric,p_data date,p_documento text,p_ator uuid,
  p_gateway_em timestamptz default null,p_conferir boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare c public.commissions%rowtype; r public.comissao_recebimentos%rowtype; total numeric; delta numeric; movimento uuid;
begin
  select * into strict c from public.commissions where id=p_id and autorizacao_id is not null for update;
  if p_ator is not null and not exists(select from public.profiles where user_id=p_ator and ativo and
    (role='admin_central' or role='analista_arini' and 'financeiro'=any(setores))) then raise insufficient_privilege; end if;
  if p_data is null or p_data>(now() at time zone 'America/Sao_Paulo')::date or p_referencia is null or length(trim(p_referencia)) not between 3 and 120
    or length(coalesce(trim(p_documento),'')) not between 3 and 300 or (p_ator is null and p_gateway_em is null)
    or p_valor is null or p_valor<0 or p_valor::text in ('NaN','Infinity') or p_valor<>round(p_valor,2)
    then raise exception 'Dados de recebimento inválidos.'; end if;
  select * into r from public.comissao_recebimentos where comissao_id=c.id and referencia=trim(p_referencia);
  if p_gateway_em is not null and r.evento_gateway_em>p_gateway_em then return; end if;
  if p_gateway_em is not null and r.evento_gateway_em=p_gateway_em and r.valor<>p_valor then p_conferir:=true; end if;
  if p_ator is not null and p_conferir and r.id is null then raise exception 'O recebimento a conferir não existe.'; end if;
  if p_ator is not null and r.id is not null and r.valor<>p_valor and not p_conferir and not r.em_conferencia then
    raise exception 'Referência já registrada com outro valor. Use a ação de conciliação.'; end if;
  -- Evento sem valor identificável: o saldo fica suspenso para conferência humana.
  if p_ator is null and (p_conferir or c.recebido+p_valor-coalesce(r.valor,0)>c.valor) then
    p_valor:=coalesce(r.valor,0); p_conferir:=true; end if;
  delta:=p_valor-coalesce(r.valor,0);
  total:=c.recebido+delta;
  if total<0 or total>c.valor then raise exception 'O recebimento ultrapassa o saldo da comissão.'; end if;
  insert into public.comissao_recebimentos(comissao_id,referencia,recebido_em,valor,evento_gateway_em,em_conferencia,motivo_conferencia)
    values(c.id,trim(p_referencia),p_data,p_valor,p_gateway_em,p_ator is null and p_conferir,case when p_ator is null and p_conferir then p_documento end)
    on conflict(comissao_id,referencia) do update set valor=excluded.valor,
      recebido_em=case when comissao_recebimentos.valor=0 and excluded.valor>0 then excluded.recebido_em else comissao_recebimentos.recebido_em end,
      evento_gateway_em=coalesce(excluded.evento_gateway_em,comissao_recebimentos.evento_gateway_em),
      em_conferencia=excluded.em_conferencia,motivo_conferencia=excluded.motivo_conferencia returning id into r.id;
  if delta<>0 or (p_ator is not null and p_conferir and r.em_conferencia) then
    insert into public.comissao_movimentos(recebimento_id,tipo,diferenca,data,documento,autor)
      values(r.id,'recebimento',delta,p_data,trim(p_documento),p_ator) returning id into movimento;
    if delta<>0 then
      perform public.fn_lancar('recebimento_comissao',movimento,p_data,'Comissão ARINI Imóveis · '||trim(p_referencia),'3.1',null,null,
        case when delta>0 then 'entrada' else 'saida' end,abs(delta));
    end if;
  end if;
  if c.captador_id is not null then
    with parcelas as (
      select id,valor,sum(valor) over(order by recebido_em,criado_em,id) as acumulado from public.comissao_recebimentos where comissao_id=c.id
    ), cotas as (
      select id,round(acumulado*round(c.base_calculo*0.005,2)/nullif(c.valor,0),2) -
        round((acumulado-valor)*round(c.base_calculo*0.005,2)/nullif(c.valor,0),2) as devido from parcelas
    ) update public.comissao_recebimentos r2 set repasse=coalesce(q.devido,0) from cotas q where r2.id=q.id and r2.repasse is distinct from coalesce(q.devido,0);
  end if;
  update public.commissions set recebido=total,
    status=case when total=valor and total>0 then case when status='conciliada' and delta=0 and not p_conferir then status else 'paga'::public.commission_status end
      when total>0 or status<>'registrada' then 'cobrada'::public.commission_status else status end,
    pago_em=case when total=valor and total>0 then coalesce(pago_em,p_data) end where id=c.id;
end $$;

-- O registro do evento e a baixa da parcela pertencem à mesma transação.
create function public.fn_gateway_comissao(p_id uuid,p_evento_id text,p_evento text,p_gateway text,p_valor numeric,p_data date,p_hora timestamptz,p_conferir boolean,p_documento text)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.asaas_webhook_events(id,evento,payment_id,external_reference)
    values(p_evento_id,p_evento,p_gateway,p_id::text) on conflict(id) do nothing;
  if found then perform public.fn_recebimento_comissao(p_id,p_gateway,p_valor,p_data,p_documento,null,p_hora,p_conferir); end if;
end $$;
revoke all on function public.fn_gateway_comissao(uuid,text,text,text,numeric,date,timestamptz,boolean,text) from public,anon,authenticated;
grant execute on function public.fn_gateway_comissao(uuid,text,text,text,numeric,date,timestamptz,boolean,text) to service_role;

-- Registra pagamento efetivo (ou devolução) com documento. Não movimenta dinheiro.
create function public.fn_baixar_repasse(p_id uuid,p_alvo numeric,p_data date,p_documento text,p_ator uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.comissao_recebimentos%rowtype; movimento uuid; delta numeric;
begin
  if not exists(select from public.profiles where user_id=p_ator and ativo and
    (role='admin_central' or role='analista_arini' and 'financeiro'=any(setores))) then raise insufficient_privilege; end if;
  perform c.id from public.commissions c join public.comissao_recebimentos rec on rec.comissao_id=c.id where rec.id=p_id and c.captador_id is not null for update of c;
  if not found then raise exception 'Recebimento sem captador.'; end if;
  select * into strict r from public.comissao_recebimentos where id=p_id for update;
  if p_alvo is null or p_alvo<>r.repasse or r.em_conferencia then raise exception 'O saldo do repasse mudou ou aguarda conferência. Atualize a página.'; end if;
  delta:=p_alvo-r.repassado;
  if delta=0 then return; end if;
  if p_data is null or p_data<r.recebido_em or p_data>(now() at time zone 'America/Sao_Paulo')::date
    or length(coalesce(trim(p_documento),'')) not between 3 and 300 then raise exception 'Informe a data e as referências da NF/RPA e do comprovante.'; end if;
  insert into public.comissao_movimentos(recebimento_id,tipo,diferenca,data,documento,autor)
    values(p_id,'repasse',delta,p_data,trim(p_documento),p_ator) returning id into movimento;
  update public.comissao_recebimentos set repassado=p_alvo where id=p_id;
  perform public.fn_lancar('repasse_captador',movimento,p_data,'Repasse da Rede ARINI · '||r.referencia,'4.9',null,null,
    case when delta>0 then 'saida' else 'entrada' end,abs(delta));
end $$;
revoke all on function public.fn_recebimento_comissao(uuid,text,numeric,date,text,uuid,timestamptz,boolean),
  public.fn_baixar_repasse(uuid,numeric,date,text,uuid) from public,anon,authenticated;
grant execute on function public.fn_recebimento_comissao(uuid,text,numeric,date,text,uuid,timestamptz,boolean),
  public.fn_baixar_repasse(uuid,numeric,date,text,uuid) to service_role;

create or replace function fn_financeiro_mensal(p_meses integer default 12)
returns json language sql stable security definer set search_path = public as $$
  with meses as (
    select date_trunc('month', current_date) - make_interval(months => g) as mes
    from generate_series(0, greatest(p_meses, 1) - 1) g
  )
  select coalesce(json_agg(json_build_object(
    'mes', to_char(m.mes, 'YYYY-MM'),
    'vendas', (select count(*) from sales s where date_trunc('month', s.data_venda) = m.mes),
    'volume_vendido', (select coalesce(sum(s.valor_final), 0) from sales s where date_trunc('month', s.data_venda) = m.mes),
    'comissao_registrada', (select coalesce(sum(c.valor), 0) from commissions c join sales s on s.id = c.sale_id
                            where date_trunc('month', s.data_venda) = m.mes),
    'comissao_recebida', (select coalesce(sum(c.valor), 0) from commissions c
                          where c.autorizacao_id is null and c.pago_em is not null and date_trunc('month', c.pago_em) = m.mes) + (select coalesce(sum(cm.diferenca), 0) from comissao_movimentos cm where cm.tipo = 'recebimento' and date_trunc('month', cm.data) = m.mes),
    'mensalidade_faturada', (select coalesce(sum(i.valor), 0) from invoices i where date_trunc('month', i.competencia) = m.mes),
    'mensalidade_recebida', (select coalesce(sum(i.valor), 0) from invoices i
                             where i.pago_em is not null and date_trunc('month', i.pago_em) = m.mes)
  ) order by m.mes desc), '[]'::json)
  from meses m
$$;
