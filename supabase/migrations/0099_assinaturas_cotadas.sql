-- A cotação é imutável. Liberar a proposta não emite fatura nem concede acesso.
create table public.clientes_asaas_emissao (
 titular uuid primary key references public.profiles(user_id), reservado_em timestamptz not null default now()
);
alter table public.clientes_asaas_emissao enable row level security;
revoke all on public.clientes_asaas_emissao from public,anon,authenticated,service_role;
grant select,insert,delete on public.clientes_asaas_emissao to service_role;
create table public.assinaturas_cotadas (
 id uuid primary key references public.solicitacoes_planos(id),
 titular uuid not null references public.profiles(user_id), nicho text not null, plano text not null references public.plans(id),
 org uuid references public.organizations(id), ciclo text not null check(ciclo in ('mensal','anual')),
 primeira int not null check(primeira>0), recorrente int not null check(recorrente>0), adicionais int not null check(adicionais>=0),
 vagas int not null check(vagas>=0), escopo_confirmado text not null,
 liberado_por uuid not null references public.profiles(user_id), liberado_em timestamptz not null default now(),
 aceite timestamptz, inicio date, cancelado timestamptz, arrependimento boolean not null default false,
 cliente text, anterior text, origem_anterior text, validade_anterior timestamptz, concedido_ate timestamptz,
 proxima date
);
create unique index assinatura_cotada_aceita on public.assinaturas_cotadas(titular,nicho) where aceite is not null and cancelado is null;
create unique index assinatura_org_aceita on public.assinaturas_cotadas(org) where org is not null and aceite is not null and cancelado is null;
create index assinaturas_renovar on public.assinaturas_cotadas(proxima) where cancelado is null;
create table public.faturas_cotadas (
 id uuid primary key default gen_random_uuid(), assinatura uuid not null references public.assinaturas_cotadas(id),
 componente text not null check(componente in ('plano','adicionais')), numero int not null, inicio date not null, fim date not null,
 valor int not null check(valor>0), status text not null default 'nova' check(status in ('nova','emitindo','aberta','vencida','paga','cancelada','estornada','parcial')),
 pagamento text unique, link text, operacao text check(operacao in ('excluir','excluindo','estornar','estornando','conferir')),
 link_estorno text, revisao_em timestamptz not null default now(), unique(assinatura,componente,numero)
);
create index fatura_cotada_fila on public.faturas_cotadas(revisao_em) where status in ('nova','emitindo','aberta','vencida') or operacao is not null;
alter table public.assinaturas_cotadas enable row level security;
alter table public.faturas_cotadas enable row level security;
revoke all on public.assinaturas_cotadas,public.faturas_cotadas from public,anon,authenticated,service_role;
grant select on public.assinaturas_cotadas,public.faturas_cotadas to service_role;
grant update(link,link_estorno,revisao_em,operacao) on public.faturas_cotadas to service_role;

create function public.assinatura_liberar(p_ator uuid,p_pedido uuid,p_escopo text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.solicitacoes_planos; q jsonb; n text; v public.plans; extra int; vagas int; primeira int; normal int;
begin
 if not exists(select 1 from public.profiles where user_id=p_ator and ativo and (role='admin_central' or role='analista_arini' and 'financeiro'=any(setores))) then raise insufficient_privilege; end if;
 select * into strict p from public.solicitacoes_planos where id=p_pedido for update;
 if p.status not in ('em_analise','concluido') or length(trim(p_escopo)) not between 15 and 2000 or p_escopo is null then
   raise exception using errcode='22023',message='Confirme o escopo entregue e os termos da proposta em análise.';
 end if;
 q:=p.cotacao;
 n:=case q->>'personaId' when 'proprietario' then 'proprietario' when 'produtor_rural' then 'produtor_rural' when 'profissional_tecnico' then 'engenheiro' end;
 select * into strict v from public.plans where id=q->>'planoId' and ativo and preco_mensal>0;
 if n is null or split_part(v.id,'_',1)<>(case n when 'proprietario' then 'proprietario' when 'produtor_rural' then 'produtor' else 'tecnico' end)
    or q->>'ciclo' not in ('mensal','anual') or (q->>'sobOrcamento')::boolean is distinct from false then raise invalid_parameter_value; end if;
 if exists(select 1 from jsonb_array_elements(q->'itens') i where i->>'id'<>'propriedade_adicional' or n<>'proprietario')
    or exists(select 1 from public.cofre_concessoes where pedido_id=p.id) then
    raise exception using errcode='22023',message='Esta configuração exige atendimento individual. Somente vagas de propriedade têm provisionamento mensal automático.';
 end if;
 extra:=(q->>'adicionaisMensaisCentavos')::int; primeira:=(q->>'baseCicloCentavos')::int;
 normal:=case q->>'ciclo' when 'anual' then primeira else (q->>'mensalRecorrenteCentavos')::int-extra end;
 select coalesce(sum((i->>'quantidade')::int),0) into vagas from jsonb_array_elements(q->'itens') i;
 if primeira<=0 or normal<=0 or extra<0 or (extra=0)<>(vagas=0) then raise invalid_parameter_value; end if;
 insert into public.assinaturas_cotadas(id,titular,nicho,plano,ciclo,primeira,recorrente,adicionais,vagas,liberado_por,escopo_confirmado)
 values(p.id,p.user_id,n,v.id,q->>'ciclo',primeira,normal,extra,vagas,p_ator,trim(p_escopo)) on conflict(id) do nothing;
 if found then insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
   values(p_ator,'assinatura.ofertada','solicitacoes_planos',p.id,jsonb_build_object('escopo',p_escopo)); end if;
end $$;

-- Revalida o titular, o plano e o vínculo vigentes antes de cada emissão.
create function public.assinatura_pode_faturar(s public.assinaturas_cotadas) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.plans pl on pl.id=s.plano and pl.ativo
 left join public.conta_contextos c on c.titular=p.user_id and c.nicho=s.nicho
 where p.user_id=s.titular and p.ativo and (s.org is null and (
   case when p.nicho=s.nicho then p.plan_id else c.plano end is not distinct from case when s.concedido_ate is null then s.anterior else s.plano end
   and case when p.nicho=s.nicho then p.plan_origem else c.origem end is not distinct from case when s.concedido_ate is null then s.origem_anterior else 'assinatura' end
   and case when p.nicho=s.nicho then p.plan_valido_ate else c.validade end is not distinct from coalesce(s.concedido_ate,s.validade_anterior))
 or s.org is not null and exists(select from public.organization_members m join public.organizations o on o.id=m.org_id and o.ativo
   where m.org_id=s.org and m.user_id=s.titular and m.status='ativo' and m.papel_org='admin' and m.nicho_vinculo=s.nicho
   and o.plan_id is not distinct from case when s.concedido_ate is null then s.anterior else s.plano end
   and o.plan_valido_ate is not distinct from coalesce(s.concedido_ate,s.validade_anterior)
   and exists(select from public.partners where profile_id=s.titular and tipo='engenheiro' and status in ('ativo','aprovado')))));
$$;
revoke all on function public.assinatura_pode_faturar(public.assinaturas_cotadas) from public,anon,authenticated;
-- Meses calculados sobre a data original, preservando 31 de março após 28 de fevereiro.
create function public.assinatura_gerar(p_id uuid,p_hoje date) returns void
language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas; anterior public.faturas_cotadas; comp text; passo int; numero int; ini date; fim date; prox date;
begin
 select * into strict s from public.assinaturas_cotadas where id=p_id for update;
 if s.aceite is null or s.cancelado is not null then return; end if;
 if not public.assinatura_pode_faturar(s) then perform public.assinatura_cancelar(s.titular,s.id,false); return; end if;
 foreach comp in array array['plano','adicionais'] loop
   if comp='adicionais' and (s.ciclo='mensal' or s.adicionais=0) then continue; end if;
   if comp='adicionais' and exists(select from public.faturas_cotadas b where b.assinatura=p_id and b.componente='plano' and b.numero>0 and b.inicio<=p_hoje and b.fim>p_hoje and b.status<>'paga') then continue; end if;
   passo:=case when comp='plano' and s.ciclo='anual' then 12 else 1 end;
   select * into anterior from public.faturas_cotadas where assinatura=p_id and componente=comp order by numero desc limit 1;
   if found and anterior.status<>'paga' then continue; end if;
   numero:=coalesce(anterior.numero,-1)+1;
   ini:=(s.inicio+make_interval(months=>numero*passo))::date; fim:=(s.inicio+make_interval(months=>(numero+1)*passo))::date;
   if ini<=p_hoje and p_hoje<fim then
     insert into public.faturas_cotadas(assinatura,componente,numero,inicio,fim,valor)
     values(p_id,comp,numero,ini,fim,case when comp='adicionais' then s.adicionais
       else (case when numero=0 then s.primeira else s.recorrente end)+case when s.ciclo='mensal' then s.adicionais else 0 end end)
     on conflict do nothing;
   elsif ini>p_hoje then prox:=least(prox,ini); end if;
 end loop;
 update public.assinaturas_cotadas set proxima=prox where id=p_id;
end $$;

create function public.assinatura_aceitar(p_titular uuid,p_id uuid,p_cliente text,p_primeira int,p_recorrente int,p_adicionais int,p_ciclo text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas; p public.profiles; o public.organizations; orgs uuid[]; plano public.plans; hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 select * into strict s from public.assinaturas_cotadas where id=p_id and titular=p_titular for update;
 select * into strict p from public.profiles where user_id=p_titular and ativo for update;
 if row(s.primeira,s.recorrente,s.adicionais,s.ciclo) is distinct from row(p_primeira,p_recorrente,p_adicionais,p_ciclo)
    or s.cancelado is not null or p.nicho is distinct from s.nicho then raise object_not_in_prerequisite_state; end if;
 if s.aceite is not null then return; end if;
 perform 1 from public.solicitacoes_planos where id=p_id and status in ('em_analise','concluido') for update;
 if not found then raise object_not_in_prerequisite_state; end if;
 select * into strict plano from public.plans where id=s.plano and ativo;
 if p.asaas_customer_id is distinct from p_cliente or coalesce(length(p_cliente),0)<3 then raise invalid_parameter_value; end if;
 if coalesce(p.plan_origem,'padrao')<>'padrao' and coalesce(p.plan_valido_ate,'infinity')>now() then
   raise exception using errcode='55000',message='A conta já tem uma atribuição vigente. A Central deve conciliá-la antes da contratação.';
 end if;
 select array_agg(m.org_id) into orgs from public.organization_members m join public.organizations o1 on o1.id=m.org_id and o1.ativo
    where m.user_id=p_titular and m.status='ativo' and m.nicho_vinculo=s.nicho and m.papel_org='admin';
 if plano.escopo='organizacao' and s.nicho='engenheiro' and not exists(select from public.partners where profile_id=p_titular and tipo='engenheiro' and status in ('ativo','aprovado')) then
   raise exception using errcode='55000',message='O escritório requer cadastro profissional aprovado pela Central.'; end if;
 if plano.escopo='organizacao' then
   if coalesce(cardinality(orgs),0)<>1 then raise exception using errcode='55000',message='O plano requer um escritório ativo administrado pelo titular.'; end if;
   select * into strict o from public.organizations where id=orgs[1] for update;
   if exists(select 1 from public.plans where id=o.plan_id and preco_mensal>0) and coalesce(o.plan_valido_ate,'infinity')>now() then
      raise exception using errcode='55000',message='O escritório já tem um plano pago vigente.'; end if;
 elsif exists(select 1 from public.organization_members m join public.organizations o1 on o1.id=m.org_id and o1.ativo join public.plans pp on pp.id=o1.plan_id and pp.ativo
    where m.user_id=p_titular and m.status='ativo' and m.nicho_vinculo=s.nicho and coalesce(o1.plan_valido_ate,'infinity')>now()) then
   raise exception using errcode='55000',message='O acesso deste perfil já é fornecido por uma organização.'; end if;
 if exists(select 1 from public.plan_subscriptions ps where ps.user_id=p_titular and ps.nicho_vinculo=s.nicho and ps.status in ('ativa','pendente')) then raise object_not_in_prerequisite_state; end if;
 update public.assinaturas_cotadas set org=o.id,cliente=p_cliente,aceite=now(),inicio=hoje,proxima=hoje,
   anterior=case when o.id is null then p.plan_id else o.plan_id end,origem_anterior=p.plan_origem,
   validade_anterior=case when o.id is null then p.plan_valido_ate else o.plan_valido_ate end where id=p_id;
 update public.solicitacoes_planos set status='concluido',updated_at=now() where id=p_id;
 insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_titular,'assinatura.aceita','solicitacoes_planos',p_id,
   jsonb_build_object('ciclo',p_ciclo,'primeira',p_primeira,'recorrente',p_recorrente,'adicionais',p_adicionais,'org',o.id,'termos','2026-11-15'));
 perform public.assinatura_gerar(p_id,hoje);
end $$;

-- O perfil pode ter trocado de nicho entre o aceite e o evento do gateway.
-- Só renovamos a concessão que esta assinatura ainda possui.
create function public.assinatura_atualizar_acesso(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas; p public.profiles; vigente timestamptz; novo_plano text; nova_origem text; nova_validade timestamptz; atualizado boolean;
begin
 select * into strict s from public.assinaturas_cotadas where id=p_id for update;
 select max(fim::timestamp at time zone 'America/Sao_Paulo') into vigente from public.faturas_cotadas
   where assinatura=p_id and componente='plano' and status='paga' and operacao is null and inicio<=(now() at time zone 'America/Sao_Paulo')::date;
 if vigente is not distinct from s.concedido_ate then return; end if;
 novo_plano:=case when vigente>now() then s.plano else s.anterior end;
 nova_origem:=case when vigente>now() then 'assinatura' else s.origem_anterior end;
 nova_validade:=case when vigente>now() then vigente else s.validade_anterior end;
 select * into strict p from public.profiles where user_id=s.titular for update;
 if s.org is not null then
   update public.organizations set plan_id=novo_plano,plan_valido_ate=nova_validade where id=s.org
     and (s.concedido_ate is null and plan_id is not distinct from s.anterior and plan_valido_ate is not distinct from s.validade_anterior
       or s.concedido_ate is not null and plan_id=s.plano and plan_valido_ate=s.concedido_ate);
 elsif s.nicho=p.nicho then
   update public.profiles set plan_id=novo_plano,plan_origem=nova_origem,plan_valido_ate=nova_validade where user_id=s.titular
     and (s.concedido_ate is null and plan_id is not distinct from s.anterior and plan_origem is not distinct from s.origem_anterior and plan_valido_ate is not distinct from s.validade_anterior
       or s.concedido_ate is not null and plan_id=s.plano and plan_origem='assinatura' and plan_valido_ate=s.concedido_ate);
 else
   update public.conta_contextos c set plano=novo_plano,origem=nova_origem,validade=nova_validade
     where titular=s.titular and nicho=s.nicho and (s.concedido_ate is null and c.plano is not distinct from s.anterior and c.origem is not distinct from s.origem_anterior and c.validade is not distinct from s.validade_anterior
       or s.concedido_ate is not null and c.plano=s.plano and c.origem='assinatura' and c.validade=s.concedido_ate);
 end if;
 atualizado:=found;
 if atualizado then update public.assinaturas_cotadas set concedido_ate=case when vigente>now() then vigente end where id=p_id;
 else insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(s.titular,'assinatura.conciliar_acesso','solicitacoes_planos',p_id,jsonb_build_object('plano',s.plano,'ate',vigente)); end if;
end $$;

create function public.assinatura_cancelar(p_titular uuid,p_id uuid,p_estorno boolean) returns void language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas;
begin
 select * into strict s from public.assinaturas_cotadas where id=p_id and titular=p_titular for update;
 if s.aceite is null or p_estorno and now()>s.aceite+interval '7 days' then raise object_not_in_prerequisite_state; end if;
 update public.assinaturas_cotadas set cancelado=coalesce(cancelado,now()),arrependimento=arrependimento or p_estorno,proxima=null where id=p_id;
 update public.faturas_cotadas set status='cancelada' where assinatura=p_id and status='nova';
 update public.faturas_cotadas set operacao='excluir',revisao_em=now() where assinatura=p_id and status in ('aberta','emitindo','vencida') and operacao is null;
 if p_estorno then update public.faturas_cotadas set operacao='estornar',revisao_em=now() where assinatura=p_id and status='paga' and operacao is null; end if;
 if s.cancelado is null or p_estorno and not s.arrependimento then
   insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_titular,'assinatura.cancelada','solicitacoes_planos',p_id,jsonb_build_object('arrependimento',p_estorno)); end if;
end $$;

create function public.assinatura_pagamento(p_id uuid,p_pagamento text,p_cliente text,p_valor int,p_evento text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas; f public.faturas_cotadas; st text; op text; hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 select a.* into strict s from public.assinaturas_cotadas a join public.faturas_cotadas ff on ff.assinatura=a.id where ff.id=p_id for update of a;
 select * into strict f from public.faturas_cotadas where id=p_id for update;
 if s.cliente is distinct from p_cliente or nullif(p_pagamento,'') is null or f.valor is distinct from p_valor
   or f.pagamento is not null and f.pagamento<>p_pagamento or f.status='nova' then raise invalid_parameter_value; end if;
 st:=f.status; op:=f.operacao;
 if p_evento in ('PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_RECEIVED_IN_CASH_UNDONE') then st:='estornada';op:=null;
 elsif p_evento='PAYMENT_PARTIALLY_REFUNDED' and st<>'estornada' then st:='parcial';op:='conferir';
 elsif p_evento='PAYMENT_REFUND_DENIED' and op='estornando' then op:='conferir';
 elsif p_evento in ('PAYMENT_CONFIRMED','PAYMENT_RECEIVED') and st not in ('paga','estornada','parcial') then
   st:='paga';
   op:=case when not public.assinatura_pode_faturar(s) or s.arrependimento or s.cancelado is not null and f.status in ('cancelada','emitindo','aberta','vencida') or f.fim<=hoje then 'estornar' end;
 elsif p_evento='PAYMENT_DELETED' and st not in ('paga','estornada','parcial') then st:='cancelada';op:=null;
 elsif p_evento='PAYMENT_OVERDUE' and st in ('emitindo','aberta') then st:='vencida';
 elsif p_evento='PAYMENT_CREATED' and st='emitindo' then st:='aberta'; end if;
 update public.faturas_cotadas set status=st,pagamento=p_pagamento,operacao=op where id=p_id;
 if st<>f.status then
   insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(s.titular,'assinatura.fatura','faturas_cotadas',p_id,jsonb_build_object('evento',p_evento,'status',st,'valor',p_valor));
   if f.componente='plano' and (st<>'paga' or op is null) then perform public.assinatura_atualizar_acesso(s.id); end if;
   if f.componente='plano' and st='paga' and op is null and not exists(select from public.assinaturas_cotadas where id=s.id and concedido_ate>=f.fim::timestamp at time zone 'America/Sao_Paulo') then
      perform public.assinatura_cancelar(s.titular,s.id,false);
      update public.faturas_cotadas set operacao='estornar' where id=f.id;
   end if;
   if st='paga' and op is null then perform public.assinatura_gerar(s.id,hoje); end if;
 end if;
end $$;

-- Uma única reserva durável para POST externo. Depois de falha de transporte o worker
-- só consulta pela referência, inclusive quando o titular cancela simultaneamente.
create function public.assinatura_reservar_emissao(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas;
begin
 select a.* into strict s from public.assinaturas_cotadas a join public.faturas_cotadas f on f.assinatura=a.id where f.id=p_id for update of a;
 if s.cancelado is not null then return false; end if;
 if not public.assinatura_pode_faturar(s) or exists(select from public.faturas_cotadas where id=p_id and status in ('nova','emitindo','aberta','vencida') and fim<=(now() at time zone 'America/Sao_Paulo')::date) then
   perform public.assinatura_cancelar(s.titular,s.id,false);return false;
 end if;
 update public.faturas_cotadas set status='emitindo',revisao_em=now() where id=p_id and status='nova';
 return found;
end $$;
create function public.assinatura_rejeicao_emissao(p_id uuid) returns void language sql security definer set search_path='' as $$
 update public.faturas_cotadas f set status=case when a.cancelado is null then 'nova' else 'cancelada' end,operacao=null,revisao_em=now()+interval '10 minutes'
 from public.assinaturas_cotadas a where f.id=p_id and a.id=f.assinatura and f.status='emitindo' and f.pagamento is null;
$$;

create function public.assinatura_vagas_pagas(p_titular uuid,p_nicho text) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(a.vagas),0) from public.assinaturas_cotadas a join public.profiles p on p.user_id=a.titular and p.ativo
 left join public.conta_contextos c on c.titular=a.titular and c.nicho=a.nicho
 where a.titular=p_titular and a.nicho=p_nicho and a.concedido_ate>now() and a.vagas>0
   and case when p.nicho=a.nicho then p.plan_id else c.plano end=a.plano
   and case when p.nicho=a.nicho then p.plan_origem else c.origem end='assinatura'
   and not exists(select 1 from public.cofre_concessoes where pedido_id=a.id)
   and exists(select 1 from public.faturas_cotadas f where f.assinatura=a.id and f.componente=case a.ciclo when 'mensal' then 'plano' else 'adicionais' end
     and f.status='paga' and f.operacao is null and (now() at time zone 'America/Sao_Paulo')::date>=f.inicio and (now() at time zone 'America/Sao_Paulo')::date<f.fim);
$$;
alter function public.cofre_limite(uuid) rename to cofre_limite_sem_assinatura;
create function public.cofre_limite(p_titular uuid) returns bigint language sql stable security definer set search_path='' as $$
 select public.cofre_limite_sem_assinatura(p_titular)+public.assinatura_vagas_pagas(p_titular,(select nicho from public.profiles where user_id=p_titular));
$$;
create or replace function public.monitor_area_habilitada(a public.monitor_areas) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select a.ativo and monitor_autorizado(a.titular,a.nicho)
   and ST_Area(a.geom::geography)/10000 <= coalesce(monitor_cota(a.titular,a.nicho,'monitoramento_hectares'),51010000000)
   and (select count(*) from monitor_areas m where m.titular=a.titular and m.nicho=a.nicho and m.ativo
       and (m.aceite_em,m.id)<=(a.aceite_em,a.id)) <= coalesce(monitor_cota(a.titular,a.nicho,'propriedades_cofre'),3)
       + coalesce((select sum(quantidade) from cofre_concessoes where titular_id=a.titular),0)
       + public.assinatura_vagas_pagas(a.titular,a.nicho)
   and (a.cofre_id is null or coalesce(ST_Equals(a.geom,monitor_geom_cofre(a.titular,a.cofre_id)),false))
$$;

create function public.cofre_validar_pedido_manual() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.solicitacoes_planos where id=new.pedido_id for update;
 if exists(select 1 from public.assinaturas_cotadas where id=new.pedido_id) then raise object_not_in_prerequisite_state using message='As vagas desta proposta são controladas pelas faturas.'; end if;
 return new;
end $$;
create trigger cofre_pedido_manual before insert on public.cofre_concessoes for each row execute function public.cofre_validar_pedido_manual();
revoke all on function public.assinatura_liberar(uuid,uuid,text),public.assinatura_gerar(uuid,date),public.assinatura_aceitar(uuid,uuid,text,int,int,int,text),public.assinatura_atualizar_acesso(uuid),
 public.assinatura_cancelar(uuid,uuid,boolean),public.assinatura_pagamento(uuid,text,text,int,text),public.assinatura_reservar_emissao(uuid),public.assinatura_rejeicao_emissao(uuid),
 public.cofre_limite(uuid),public.cofre_validar_pedido_manual() from public,anon,authenticated;
grant execute on function public.assinatura_liberar(uuid,uuid,text),public.assinatura_gerar(uuid,date),public.assinatura_aceitar(uuid,uuid,text,int,int,int,text),
 public.assinatura_cancelar(uuid,uuid,boolean),public.assinatura_pagamento(uuid,text,text,int,text),public.assinatura_reservar_emissao(uuid),public.assinatura_rejeicao_emissao(uuid),public.cofre_limite(uuid) to service_role;
revoke all on function public.assinatura_vagas_pagas(uuid,text) from public,anon,authenticated;
grant execute on function public.assinatura_vagas_pagas(uuid,text) to service_role;
