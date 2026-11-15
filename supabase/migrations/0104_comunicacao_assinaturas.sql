-- Consentimento específico: os aceites de avisos de imóveis não autorizam cobrança ou recuperação.
alter table public.conta_consentimentos drop constraint conta_consentimentos_finalidade_check;
alter table public.conta_consentimentos add constraint conta_consentimentos_finalidade_check
  check (finalidade in ('rastro','historico_ari','whatsapp','whatsapp_assinatura','whatsapp_recuperacao'));

create table public.assinatura_regras_contato (
  tipo text primary key check (tipo in ('recuperacao','renovacao','vencimento','lembrete','pagamento')),
  ativo boolean not null default true,
  dias integer[] not null,
  mensagem text not null check(length(trim(mensagem)) between 5 and 700),
  modelo_id text check(modelo_id ~ '^[0-9]{1,24}$'),
  check (cardinality(dias) between 1 and 3 and 0 <= all(dias) and 90 >= all(dias) and array_position(dias,null) is null),
  check (tipo <> 'recuperacao' or cardinality(dias) <= 2),
  check (tipo <> 'renovacao' or dias = array[30]),
  check (tipo <> 'vencimento' or (cardinality(dias)=1 and 15 >= all(dias))),
  check (tipo <> 'pagamento' or dias = array[0])
);
insert into public.assinatura_regras_contato(tipo,dias,mensagem) values
 ('recuperacao',array[1,3],'Olá, {nome}. Sua contratação do plano {plano} aguarda conclusão. Acompanhe a proposta e o pagamento em Meus pedidos.'),
 ('renovacao',array[30],'Seu plano {plano} renova em {data}. O valor contratado para o próximo ciclo é {valor}. Consulte as condições em Meus pedidos.'),
 ('vencimento',array[15],'O próximo pagamento do plano {plano} está previsto para {data}, no valor de {valor}.'),
 ('lembrete',array[3],'A fatura do plano {plano}, no valor de {valor}, venceu em {data}. Acesse Meus pedidos para conferir.'),
 ('pagamento',array[0],'Recebemos o pagamento de {valor} referente ao plano {plano}. Consulte o histórico em Meus pedidos.');
create table public.assinatura_contatos (
  id bigint generated always as identity primary key,
  assinatura uuid not null references public.assinaturas_cotadas(id) on delete cascade,
  titular uuid not null references public.profiles(user_id) on delete cascade,
  tipo text not null references public.assinatura_regras_contato,
  referencia date not null, passo integer not null,
  texto text not null, criado_em timestamptz not null default now(),
  status text not null default 'painel' check(status in ('painel','pendente','enviando','enviado','recusado','conferir','cancelado')),
  wa_id text, alterado_em timestamptz not null default now(),
  unique(assinatura,tipo,referencia,passo)
);
create index assinatura_contatos_fila on public.assinatura_contatos(id) where status='pendente';
create index assinatura_contatos_usuario on public.assinatura_contatos(titular,criado_em desc);
alter table public.assinatura_regras_contato enable row level security;
alter table public.assinatura_contatos enable row level security;
revoke all on public.assinatura_regras_contato,public.assinatura_contatos from public,anon,authenticated,service_role;
grant select,update(ativo,dias,mensagem,modelo_id) on public.assinatura_regras_contato to service_role;
grant select,update(status,wa_id,alterado_em) on public.assinatura_contatos to service_role;

-- Pedido expresso pelo titular: no máximo um Pix no WhatsApp por fatura por dia.
create table public.assinatura_pix_whatsapp (
  fatura uuid not null references public.faturas_cotadas(id) on delete cascade,
  dia date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  status text not null default 'enviando' check(status in ('enviando','enviado','recusado','conferir')),
  wa_id text, primary key (fatura,dia)
);
alter table public.assinatura_pix_whatsapp enable row level security;
revoke all on public.assinatura_pix_whatsapp from public,anon,authenticated,service_role;
grant insert(fatura),select,update(status,wa_id) on public.assinatura_pix_whatsapp to service_role;

alter table public.faturas_cotadas add column pagamento_confirmado_em timestamptz;
create function public.assinatura_data_confirmacao() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status = 'paga' and old.status <> 'paga' then new.pagamento_confirmado_em := now(); end if;
  return new;
end $$;
create trigger fatura_data_confirmacao before update of status on public.faturas_cotadas
for each row execute function public.assinatura_data_confirmacao();

create function public.assinatura_telefone(p_texto text) returns text language sql immutable strict set search_path='' as $$
  select case when length(d) in (10,11) then '55'||d when d ~ '^55[0-9]{10,11}$' then d end
  from (select regexp_replace(p_texto,'[^0-9]','','g') d) digits;
$$;
create index profiles_assinatura_telefone on public.profiles(public.assinatura_telefone(telefone)) where ativo;
-- Números compartilhados por duas contas nunca dão acesso a uma ficha financeira por associação.
create function public.assinatura_titular_telefone(p_numero text) returns uuid language sql stable security definer set search_path='' as $$
  select case when count(*)=1 then (array_agg(user_id))[1] end from public.profiles
  where ativo and public.assinatura_telefone(telefone)=public.assinatura_telefone(p_numero);
$$;

create table public.retomadas_cadastro (
  id uuid primary key default gen_random_uuid(), telefone text not null, plano text not null, perfil text not null,
  nome text not null, wa_id text not null unique, autorizado_em timestamptz not null default now(),
  status text not null default 'aberta' check(status in ('aberta','convertida','cancelada','expirada')), encerrado_em timestamptz
);
create unique index retomadas_ativas_telefone on public.retomadas_cadastro(telefone) where status='aberta';
create table public.retomadas_tentativas (
  retomada uuid not null references public.retomadas_cadastro on delete cascade, passo integer not null check(passo in(1,2)),
  criado_em timestamptz not null default now(), status text not null default 'enviando' check(status in('enviando','enviado','recusado','conferir')),
  wa_id text, primary key(retomada,passo)
);
alter table public.retomadas_cadastro enable row level security;
alter table public.retomadas_tentativas enable row level security;
revoke all on public.retomadas_cadastro,public.retomadas_tentativas from public,anon,authenticated,service_role;
grant select on public.retomadas_cadastro to service_role;
grant select,update(status,wa_id) on public.retomadas_tentativas to service_role;
create function public.retomada_registrar(p_tel text,p_plano text,p_perfil text,p_nome text,p_wa text,p_parar boolean) returns void
language plpgsql security definer set search_path='' as $$
declare tel text:=public.assinatura_telefone(p_tel);
begin
  if tel is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(tel,0));
  if p_parar then
    insert into public.conta_consentimentos(titular,finalidade,permitido,versao)
      select p.user_id,'whatsapp_recuperacao',false,'1.0' from public.profiles p where p.user_id=public.assinatura_titular_telefone(tel)
        and coalesce((select c.permitido from public.conta_consentimentos c where c.titular=p.user_id and c.finalidade='whatsapp_recuperacao' order by c.id desc limit 1),false);
    update public.retomadas_cadastro set status='cancelada',encerrado_em=now() where telefone=tel and status='aberta';
    return;
  end if;
  if p_wa is null or length(p_wa)>240 or p_plano is null or p_perfil is null then return; end if;
  if exists(select from public.profiles where ativo and public.assinatura_telefone(telefone)=tel)
    or exists(select from public.retomadas_cadastro where telefone=tel and autorizado_em>=now()-interval '30 days') then return; end if;
  insert into public.retomadas_cadastro(telefone,plano,perfil,nome,wa_id) values(tel,left(p_plano,100),left(p_perfil,100),left(coalesce(p_nome,''),100),p_wa) on conflict do nothing;
end $$;
create function public.retomada_converteu() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.ativo and new.telefone is not null then
    update public.retomadas_cadastro set status='convertida',encerrado_em=now() where status='aberta' and telefone=public.assinatura_telefone(new.telefone);
  end if;
  return new;
end $$;
create trigger retomada_converteu after insert or update of telefone,ativo on public.profiles for each row execute function public.retomada_converteu();
create function public.retomada_reservar(p_modelo text) returns table(id uuid,passo int,telefone text,nome text,plano text,perfil text)
language sql security definer set search_path='' as $$
 with candidato as (
  select r.id,i.passo::int,r.telefone,r.nome,r.plano,r.perfil from public.retomadas_cadastro r
  join public.assinatura_regras_contato cfg on cfg.tipo='recuperacao' and cfg.ativo and cfg.modelo_id=p_modelo
  cross join lateral unnest(cfg.dias) with ordinality i(dia,passo)
  where r.status='aberta' and r.autorizado_em>=now()-interval '30 days' and r.autorizado_em+make_interval(days=>i.dia)<=now()
    and not exists(select from public.profiles u where u.ativo and public.assinatura_telefone(u.telefone)=r.telefone)
    and not exists(select from public.retomadas_tentativas t where t.retomada=r.id and t.passo=i.passo)
    and (i.passo=1 or exists(select from public.retomadas_tentativas anterior where anterior.retomada=r.id and anterior.passo=i.passo-1
       and anterior.criado_em<=now()-interval '1 day' and anterior.status in ('enviado','recusado')))
  order by r.autorizado_em,i.passo limit 1 for update of r skip locked
 ), reserva as (insert into public.retomadas_tentativas(retomada,passo) select c.id,c.passo from candidato c on conflict do nothing returning *)
 select c.* from candidato c join reserva e on e.retomada=c.id and e.passo=c.passo;
$$;
create function public.retomada_comercial() returns void language plpgsql security definer set search_path='' as $$
declare r record; tarefa record;
begin
  for r in select c.* from public.retomadas_cadastro c join public.assinatura_regras_contato regra on regra.tipo='recuperacao' and regra.ativo
    where c.status='aberta' and c.autorizado_em+make_interval(days=>1+(select max(x) from unnest(regra.dias) x)) < now()
      and not exists(select from public.tasks t where t.chave_evento='retomada_cadastro:'||c.id)
      and not exists(select from public.retomadas_tentativas t where t.retomada=c.id and t.criado_em>now()-interval '1 day')
    order by c.autorizado_em limit 80
  loop
    perform public.fn_tarefa_automatica('retomada_cadastro:'||r.id,'Cadastro interrompido','comercial','Acompanhar cadastro de '||r.nome,
      'Consultar o histórico do cadastro '||r.id||' em Assinaturas e contatos. Respeitar as autorizações e o limite de tentativas.',
      null,(now() at time zone 'America/Sao_Paulo')::date,'normal');
  end loop;
  update public.retomadas_cadastro set status='expirada',encerrado_em=now() where status='aberta' and autorizado_em<now()-interval '30 days';
  for tarefa in update public.tasks t set status=case c.status when 'convertida' then 'concluida' else 'cancelada' end,concluida_em=now()
    from public.retomadas_cadastro c where t.chave_evento='retomada_cadastro:'||c.id and c.status<>'aberta' and t.status not in ('concluida','cancelada') returning t.id
  loop insert into public.task_events(task_id,tipo,texto) values(tarefa.id,'status','A recuperação do cadastro foi encerrada.'); end loop;
  delete from public.retomadas_cadastro where encerrado_em<now()-interval '30 days';
end $$;
revoke all on function public.retomada_registrar(text,text,text,text,text,boolean),public.retomada_converteu(),public.retomada_comercial(),public.retomada_reservar(text) from public,anon,authenticated;
grant execute on function public.retomada_registrar(text,text,text,text,text,boolean),public.retomada_comercial(),public.retomada_reservar(text) to service_role;

-- Novas condições entram na competência escolhida somente com aviso prévio e aceite.
create table public.assinatura_reajustes (
 id uuid primary key default gen_random_uuid(), assinatura uuid not null references public.assinaturas_cotadas(id) on delete cascade,
 vigencia date not null, anterior int not null, valor int not null check(valor between 1 and 100000000),
 condicoes text not null check(length(trim(condicoes)) between 10 and 1500),
 proposto_por uuid not null references public.profiles(user_id), criado_em timestamptz not null default now(),
 avisado_em timestamptz, aceito_em timestamptz, aplicado_em timestamptz, unique(assinatura,vigencia)
);
alter table public.assinatura_reajustes enable row level security;
revoke all on public.assinatura_reajustes from public,anon,authenticated,service_role;
grant select on public.assinatura_reajustes to service_role;
create function public.assinatura_propor_reajuste(p_ator uuid,p_assinatura uuid,p_data date,p_valor int,p_condicoes text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas; meses int;
begin
 if not exists(select from public.profiles where user_id=p_ator and ativo and (role='admin_central' or role='analista_arini' and 'financeiro'=any(setores))) then raise insufficient_privilege; end if;
 select * into strict s from public.assinaturas_cotadas where id=p_assinatura and aceite is not null and cancelado is null for update;
 meses := (extract(year from p_data)-extract(year from s.inicio))*12+extract(month from p_data)-extract(month from s.inicio);
 if p_data<=(now() at time zone 'America/Sao_Paulo')::date+30 or meses<1 or meses>120 or (s.ciclo='anual' and meses%12<>0)
   or (s.inicio+make_interval(months=>meses))::date<>p_data then raise exception using errcode='22023',message='Escolha início de ciclo com mais de 30 dias de antecedência.'; end if;
 insert into public.assinatura_reajustes(assinatura,vigencia,anterior,valor,condicoes,proposto_por)
 values(s.id,p_data,s.recorrente,p_valor,trim(p_condicoes),p_ator);
end $$;
create function public.assinatura_aceitar_reajuste(p_titular uuid,p_id uuid,p_valor int) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.assinatura_reajustes a set aceito_em=coalesce(a.aceito_em,now()) from public.assinaturas_cotadas s
 where a.id=p_id and a.assinatura=s.id and s.titular=p_titular and s.cancelado is null and a.avisado_em is not null
   and a.vigencia>(now() at time zone 'America/Sao_Paulo')::date and a.valor=p_valor;
 if not found then raise exception using errcode='22023',message='Proposta indisponível.'; end if;
end $$;
create function public.assinatura_aplicar_reajuste() returns trigger language plpgsql security definer set search_path='' as $$
declare proposta public.assinatura_reajustes; s public.assinaturas_cotadas;
begin
 if new.componente<>'plano' or new.numero=0 then return new; end if;
 select * into proposta from public.assinatura_reajustes where assinatura=new.assinatura and vigencia=new.inicio
   and aceito_em is not null and (avisado_em at time zone 'America/Sao_Paulo')::date<=vigencia-30 for update;
 if not found then return new; end if;
 select * into strict s from public.assinaturas_cotadas where id=new.assinatura;
 new.valor:=proposta.valor+case when s.ciclo='mensal' then s.adicionais else 0 end;
 update public.assinaturas_cotadas set recorrente=proposta.valor,escopo_confirmado=proposta.condicoes where id=s.id;
 update public.assinatura_reajustes set aplicado_em=coalesce(aplicado_em,now()) where id=proposta.id;
 return new;
end $$;
create trigger assinatura_aplicar_reajuste before insert on public.faturas_cotadas for each row execute function public.assinatura_aplicar_reajuste();
revoke all on function public.assinatura_propor_reajuste(uuid,uuid,date,int,text),public.assinatura_aceitar_reajuste(uuid,uuid,int),public.assinatura_aplicar_reajuste() from public,anon,authenticated;
grant execute on function public.assinatura_propor_reajuste(uuid,uuid,date,int,text),public.assinatura_aceitar_reajuste(uuid,uuid,int) to service_role;

-- Cada linha é uma oportunidade de aviso que permanece elegível agora. Nenhum telefone é retido na fila.
create view public.assinatura_agenda_contato with (security_invoker=true) as
with dados as (
  select s.id, s.titular, (select count(*) from public.retomadas_cadastro g join public.retomadas_tentativas t on t.retomada=g.id
    where g.telefone=public.assinatura_telefone(p.telefone) and g.plano=s.plano and g.status='convertida' and g.encerrado_em>=s.liberado_em-interval '30 days') tentativas_cadastro, p.nome, pl.nome plano, p.telefone, s.aceite, s.liberado_em, s.inicio, s.ciclo, s.recorrente,
    s.adicionais, s.primeira, (now() at time zone 'America/Sao_Paulo')::date hoje
  from public.assinaturas_cotadas s join public.profiles p on p.user_id=s.titular and p.ativo
  join public.solicitacoes_planos ped on ped.id=s.id and ped.status <> 'cancelado'
  join public.plans pl on pl.id=s.plano where s.cancelado is null
), eventos as (
  select d.*, 'recuperacao' tipo, (d.liberado_em at time zone 'America/Sao_Paulo')::date referencia, d.primeira valor
  from dados d where not exists (select from public.faturas_cotadas f where f.assinatura=d.id and f.componente='plano' and f.numero=0 and f.status in ('paga','estornada','parcial','cancelada'))
  union all
  select d.*, e.tipo, f.fim, d.recorrente + case when d.ciclo='mensal' then d.adicionais else 0 end
  from dados d join public.faturas_cotadas f on f.assinatura=d.id and f.componente='plano' and f.status='paga'
  cross join (values('renovacao'),('vencimento')) e(tipo)
  where f.fim>d.hoje and f.inicio<=d.hoje and (e.tipo <> 'vencimento' or d.ciclo='mensal')
    and not exists(select from public.faturas_cotadas n where n.assinatura=d.id and n.componente='plano' and n.inicio=f.fim and n.status='paga')
    and (e.tipo<>'renovacao' or not exists(select from public.assinatura_reajustes a where a.assinatura=d.id and a.vigencia=f.fim))
  union all
  select d.*, 'renovacao', a.vigencia, a.valor+case when d.ciclo='mensal' then d.adicionais else 0 end
    from dados d join public.assinatura_reajustes a on a.assinatura=d.id where a.vigencia=d.hoje+30
  union all
  select d.*, 'lembrete', f.inicio, f.valor from dados d join public.faturas_cotadas f
    on f.assinatura=d.id and f.componente='plano' and f.numero>0 and f.status in ('aberta','vencida') and f.operacao is null
  union all
  select d.*, 'pagamento', f.inicio, f.valor from dados d join public.faturas_cotadas f
    on f.assinatura=d.id and f.componente='plano' and f.status='paga' and f.pagamento_confirmado_em>=now()-interval '2 days'
)
select e.id assinatura,e.titular,e.nome,e.telefone,e.plano,e.tipo,e.referencia,i.passo::int,
  replace(replace(replace(replace(r.mensagem,'{plano}',e.plano),'{data}',to_char(e.referencia,'DD/MM/YYYY')),
    '{valor}','R$ '||replace(to_char(e.valor::numeric /100,'FM999999990.00'),'.',',')),'{nome}',split_part(trim(e.nome),' ',1)) ||
    coalesce((select ' Proposta sujeita ao seu aceite em Meus pedidos: '||a.condicoes from public.assinatura_reajustes a where e.tipo='renovacao' and a.assinatura=e.id and a.vigencia=e.referencia),'') texto,
  r.modelo_id, coalesce(cons.permitido,false) and (e.tipo<>'recuperacao' or e.tentativas_cadastro+i.passo<=2) permitido
from eventos e join public.assinatura_regras_contato r on r.tipo=e.tipo and r.ativo
cross join lateral unnest(r.dias) with ordinality as i(dia,passo)
left join lateral (select c.permitido from public.conta_consentimentos c where c.titular=e.titular
   and c.finalidade=case e.tipo when 'recuperacao' then 'whatsapp_recuperacao' else 'whatsapp_assinatura' end
   order by c.id desc limit 1) cons on true
where case e.tipo
  when 'recuperacao' then e.hoje between e.referencia+i.dia and e.referencia+30
       and (i.passo=1 or exists(select from public.assinatura_contatos anterior where anterior.assinatura=e.id
        and anterior.tipo='recuperacao' and anterior.passo=i.passo-1 and anterior.status in ('enviado','recusado','painel')
        and anterior.alterado_em<=now()-interval '1 day'))
  when 'pagamento' then true
  when 'lembrete' then e.hoje between e.referencia+i.dia and e.referencia+i.dia+1
  else e.hoje=e.referencia-i.dia end;
revoke all on public.assinatura_agenda_contato from public,anon,authenticated,service_role;

create function public.assinatura_preparar_contatos() returns integer language plpgsql security definer set search_path='' as $$
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
    update public.tasks t set status='concluida',concluida_em=now() from public.assinaturas_cotadas s
    where t.chave_evento='recuperacao_assinatura:'||s.id and t.status not in ('concluida','cancelada')
      and (s.cancelado is not null or exists(select from public.faturas_cotadas f where f.assinatura=s.id and f.componente='plano' and f.numero=0 and f.status='paga'))
    returning t.id
  loop
    insert into public.task_events(task_id,tipo,texto) values (tarefa.id,'status','A contratação foi paga ou encerrada.');
  end loop;
  return resultado;
end $$;

create function public.assinatura_reservar_contato(p_id bigint,p_modelo text) returns table(telefone text,nome text,modelo_id text)
language sql security definer set search_path='' as $$
  update public.assinatura_contatos c set status='enviando',alterado_em=now()
  from public.assinatura_agenda_contato a where c.id=p_id and c.status='pendente'
    and (c.assinatura,c.tipo,c.referencia,c.passo)=(a.assinatura,a.tipo,a.referencia,a.passo)
    and a.permitido and a.modelo_id=p_modelo and public.assinatura_titular_telefone(a.telefone)=a.titular
    returning public.assinatura_telefone(a.telefone),split_part(trim(a.nome),' ',1),a.modelo_id;
$$;
revoke all on function public.assinatura_titular_telefone(text), public.assinatura_telefone(text), public.assinatura_preparar_contatos(),
  public.assinatura_reservar_contato(bigint,text),public.assinatura_data_confirmacao() from public,anon,authenticated;
grant execute on function public.assinatura_titular_telefone(text),public.assinatura_preparar_contatos(),public.assinatura_reservar_contato(bigint,text) to service_role;
