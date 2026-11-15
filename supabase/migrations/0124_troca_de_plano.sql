-- A troca usa uma segunda proposta já cotada e liberada pelo Financeiro.
-- A assinatura original continua sendo a única responsável por renovar o ciclo.
alter table public.faturas_cotadas drop constraint faturas_cotadas_componente_check;
alter table public.faturas_cotadas add check (componente in ('plano','adicionais','troca'));
create table public.assinatura_trocas (
 oferta uuid primary key references public.assinaturas_cotadas(id),
 assinatura uuid not null references public.assinaturas_cotadas(id),
 ordem bigint generated always as identity unique,
 tipo text not null check(tipo in ('upgrade','downgrade')),
 status text not null check(status in ('pendente','aplicada','encerrada')),
 anterior text not null, valor_anterior int not null, escopo_anterior text not null,
 novo text not null, valor_novo int not null, escopo_novo text not null,
 pedido_em date not null, inicio_ciclo date not null, fim_ciclo date not null,
 proporcional int not null check(proporcional>=0),
 fatura uuid unique references public.faturas_cotadas(id)
);
create unique index assinatura_troca_pendente on public.assinatura_trocas(assinatura) where status='pendente';
alter table public.assinatura_trocas enable row level security;
revoke all on public.assinatura_trocas from public, anon, authenticated, service_role;
grant select on public.assinatura_trocas to service_role;

create function public.assinatura_prever_troca(p_titular uuid,p_oferta uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 destino public.assinaturas_cotadas; atual public.assinaturas_cotadas; base public.faturas_cotadas;
 ultima public.assinatura_trocas; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
 valor_base int; valor int := 0; tipo text;
begin
 select * into strict destino from public.assinaturas_cotadas where id=p_oferta and titular=p_titular;
 select * into atual from public.assinaturas_cotadas where titular=p_titular and nicho=destino.nicho
   and aceite is not null and cancelado is null and id<>p_oferta;
 if not found or destino.aceite is not null or destino.cancelado is not null then return null; end if;
 if not exists(select from public.profiles where user_id=p_titular and ativo and nicho=destino.nicho)
    or not public.assinatura_pode_faturar(atual) then raise insufficient_privilege; end if;
 if not exists(select from public.solicitacoes_planos where id=p_oferta and status in ('em_analise','concluido'))
    or not exists(select from public.plans p join public.plans q on q.id=destino.plano and q.ativo
        where p.id=atual.plano and p.escopo=q.escopo)
    or atual.ciclo<>destino.ciclo or atual.adicionais<>destino.adicionais or atual.vagas<>destino.vagas then
    raise exception using errcode='55000',message='Para trocar o plano, solicite uma proposta do mesmo perfil, escopo, ciclo e quantidade de adicionais.'; end if;
 if atual.plano=destino.plano or destino.recorrente=atual.recorrente then
    raise exception using errcode='55000',message='Escolha um plano com outra faixa de preço para fazer a troca.'; end if;
 if exists(select from public.assinatura_trocas where assinatura=atual.id and status='pendente') then
    raise exception using errcode='55000',message='A assinatura já tem uma troca em andamento.'; end if;
 if exists(select from public.assinatura_reajustes where assinatura=atual.id and aplicado_em is null and vigencia>=hoje) then
    raise exception using errcode='55000',message='O Financeiro precisa conciliar a proposta de reajuste vigente antes da troca.'; end if;
 select * into base from public.faturas_cotadas where assinatura=atual.id and componente='plano' and status='paga'
    and operacao is null and inicio<=hoje and fim>hoje and atual.concedido_ate=fim::timestamp at time zone 'America/Sao_Paulo';
 if not found then raise exception using errcode='55000',message='A troca requer a confirmação da fatura do período atual.'; end if;
 tipo := case when destino.recorrente>atual.recorrente then 'upgrade' else 'downgrade' end;
 if tipo='upgrade' then
   select * into ultima from public.assinatura_trocas t where assinatura=atual.id and status='aplicada'
     and t.tipo='upgrade' and inicio_ciclo=base.inicio order by ordem desc limit 1;
   valor_base := coalesce(ultima.valor_novo,base.valor-case when atual.ciclo='mensal' then atual.adicionais else 0 end);
   valor := greatest(0,round((destino.recorrente-valor_base)::numeric*(base.fim-hoje)/(base.fim-base.inicio))::int);
 end if;
 return jsonb_build_object('assinatura',atual.id,'oferta',destino.id,'tipo',tipo,'atual',atual.plano,'novo',destino.plano,
   'hoje',hoje,'inicio',base.inicio,'fim',base.fim,'valor',valor,'recorrente',destino.recorrente,'adicionais',destino.adicionais,'ciclo',destino.ciclo);
end $$;

-- Verifica a titularidade do benefício a cada aplicação ou reversão, inclusive
-- quando o titular mudou de persona desde o pedido.
create function public.assinatura_mudar_concessao(p_id uuid,p_de text,p_para text,p_valor int,p_escopo text) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas; pessoa public.profiles;
begin
 select * into strict s from public.assinaturas_cotadas where id=p_id for update;
 select * into strict pessoa from public.profiles where user_id=s.titular for update;
 if s.plano<>p_de or not public.assinatura_pode_faturar(s) then return false; end if;
 if s.org is not null then
   update public.organizations set plan_id=p_para where id=s.org and plan_id=p_de and plan_valido_ate=s.concedido_ate;
 elsif pessoa.nicho=s.nicho then
   update public.profiles set plan_id=p_para where user_id=s.titular and plan_id=p_de and plan_origem='assinatura' and plan_valido_ate=s.concedido_ate;
 else
   update public.conta_contextos set plano=p_para where titular=s.titular and nicho=s.nicho and plano=p_de and origem='assinatura' and validade=s.concedido_ate;
 end if;
 if not found then return false; end if;
 update public.assinaturas_cotadas set plano=p_para,recorrente=p_valor,escopo_confirmado=p_escopo where id=s.id;
 return true;
end $$;

create function public.assinatura_confirmar_troca(p_titular uuid,p_oferta uuid,p_previa jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare destino public.assinaturas_cotadas; s public.assinaturas_cotadas; previa jsonb; id_fatura uuid; seq int;
begin
 select * into strict destino from public.assinaturas_cotadas where id=p_oferta and titular=p_titular for update;
 select * into strict s from public.assinaturas_cotadas where id=(p_previa->>'assinatura')::uuid and titular=p_titular
   and nicho=destino.nicho and id<>p_oferta for update;
 if exists(select from public.assinatura_trocas where oferta=p_oferta and assinatura=s.id) then return; end if;
 previa:=public.assinatura_prever_troca(p_titular,p_oferta);
 if previa is null or previa is distinct from p_previa then raise exception using errcode='55000',message='O período ou os valores mudaram. Confira a nova prévia da troca.'; end if;
 if previa->>'tipo'='upgrade' and (previa->>'valor')::int>0 then
   select coalesce(max(numero),-1)+1 into seq from public.faturas_cotadas where assinatura=s.id and componente='troca';
   insert into public.faturas_cotadas(assinatura,componente,numero,inicio,fim,valor)
     values(s.id,'troca',seq,(previa->>'hoje')::date,(previa->>'fim')::date,(previa->>'valor')::int) returning id into id_fatura;
 end if;
 insert into public.assinatura_trocas(oferta,assinatura,tipo,status,anterior,valor_anterior,escopo_anterior,novo,valor_novo,escopo_novo,
   pedido_em,inicio_ciclo,fim_ciclo,proporcional,fatura)
 values(p_oferta,s.id,previa->>'tipo','pendente',s.plano,s.recorrente,s.escopo_confirmado,destino.plano,destino.recorrente,destino.escopo_confirmado,
   (previa->>'hoje')::date,(previa->>'inicio')::date,(previa->>'fim')::date,(previa->>'valor')::int,id_fatura);
 if previa->>'tipo'='upgrade' and id_fatura is null then
   if not public.assinatura_mudar_concessao(s.id,s.plano,destino.plano,destino.recorrente,destino.escopo_confirmado) then raise insufficient_privilege; end if;
   update public.assinatura_trocas set status='aplicada' where oferta=p_oferta;
 end if;
 update public.assinaturas_cotadas set cancelado=now() where id=p_oferta;
 update public.solicitacoes_planos set status='concluido',updated_at=now() where id=p_oferta;
 insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
 values(p_titular,'assinatura.troca','assinaturas_cotadas',s.id,previa);
end $$;

-- No início da nova competência, a renovação já usa o plano menor. Se o
-- upgrade ainda estiver aberto, expira apenas a diferença daquele período.
alter function public.assinatura_gerar(uuid,date) rename to assinatura_gerar_ciclo;
revoke all on function public.assinatura_gerar_ciclo(uuid,date) from service_role,public,anon,authenticated;
create function public.assinatura_gerar(p_id uuid,p_hoje date) returns void
language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas; t public.assinatura_trocas;
begin
 select * into strict s from public.assinaturas_cotadas where id=p_id for update;
 select * into t from public.assinatura_trocas where assinatura=p_id and status='pendente' and fim_ciclo<=p_hoje for update;
 if found then
   if t.tipo='downgrade' and s.cancelado is null and public.assinatura_mudar_concessao(s.id,t.anterior,t.novo,t.valor_novo,t.escopo_novo) then
     update public.assinatura_trocas set status='aplicada' where oferta=t.oferta;
   else
     update public.assinatura_trocas set status='encerrada' where oferta=t.oferta;
     update public.faturas_cotadas set status='cancelada' where id=t.fatura and status='nova';
     update public.faturas_cotadas set operacao='excluir',revisao_em=now() where id=t.fatura and status in ('aberta','vencida','emitindo') and operacao is null;
   end if;
 end if;
 perform public.assinatura_gerar_ciclo(p_id,p_hoje);
end $$;

alter function public.assinatura_reservar_emissao(uuid) rename to assinatura_reservar_ciclo;
revoke all on function public.assinatura_reservar_ciclo(uuid) from service_role,public,anon,authenticated;
create function public.assinatura_reservar_emissao(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare f public.faturas_cotadas; s public.assinaturas_cotadas; hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 select a.* into strict s from public.assinaturas_cotadas a join public.faturas_cotadas origem on origem.assinatura=a.id where origem.id=p_id for update of a;
 select * into strict f from public.faturas_cotadas where id=p_id;
 if f.componente='troca' then
   if f.fim<=hoje then perform public.assinatura_gerar(s.id,hoje); return false; end if;
   if f.status<>'nova' then return false; end if;
   if not exists(select from public.assinatura_trocas where fatura=p_id and status='pendente') then
     update public.faturas_cotadas set status='cancelada' where id=p_id;
     return false;
   end if;
 end if;
 return public.assinatura_reservar_ciclo(p_id);
end $$;

create function public.assinatura_conciliar_troca() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.assinatura_trocas; seguinte public.assinatura_trocas; hoje date:=(now() at time zone 'America/Sao_Paulo')::date; aplicou boolean;
begin
 if old.status=new.status or new.componente<>'troca' then return new; end if;
 select * into strict t from public.assinatura_trocas where fatura=new.id for update;
 if t.status='pendente' and new.status='paga' and new.operacao is null then
   aplicou := hoje<t.fim_ciclo and public.assinatura_mudar_concessao(t.assinatura,t.anterior,t.novo,t.valor_novo,t.escopo_novo);
   update public.assinatura_trocas set status=case when aplicou then 'aplicada' else 'encerrada' end where oferta=t.oferta;
   if not aplicou then update public.faturas_cotadas set operacao='estornar',revisao_em=now() where id=new.id; end if;
 elsif new.status='paga' and t.status='encerrada' then
   update public.faturas_cotadas set operacao='estornar',revisao_em=now() where id=new.id;
 elsif new.status in ('cancelada','estornada','parcial') or new.operacao='estornar' then
   if t.status='aplicada' and hoje<t.fim_ciclo then
     -- Um estorno na primeira de várias trocas invalida as diferenças que dependeram dela.
     for seguinte in select * from public.assinatura_trocas where assinatura=t.assinatura and inicio_ciclo=t.inicio_ciclo
       and ordem>=t.ordem and status<>'encerrada' order by ordem desc for update loop
       if seguinte.status='aplicada' then
         perform public.assinatura_mudar_concessao(t.assinatura,seguinte.novo,seguinte.anterior,seguinte.valor_anterior,seguinte.escopo_anterior);
       end if;
       update public.assinatura_trocas set status='encerrada' where oferta=seguinte.oferta;
       if seguinte.oferta<>t.oferta then
         update public.faturas_cotadas set status='cancelada' where id=seguinte.fatura and status='nova';
         update public.faturas_cotadas set operacao=case when status='paga' then 'estornar' else 'excluir' end,revisao_em=now()
           where id=seguinte.fatura and status in ('paga','emitindo','aberta','vencida') and operacao is null;
       end if;
     end loop;
   elsif t.status='pendente' then update public.assinatura_trocas set status='encerrada' where oferta=t.oferta;
   end if;
 end if;
 return new;
end $$;
create trigger fatura_conciliar_troca after update of status on public.faturas_cotadas
 for each row when (old.status is distinct from new.status and new.componente='troca') execute function public.assinatura_conciliar_troca();

-- Se a fatura-base perder o pagamento, as diferenças dependentes também
-- perdem o efeito. Uma competência antiga não desfaz uma renovação posterior.
create function public.assinatura_estornar_trocas_do_ciclo() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.assinatura_trocas; hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 for t in select * from public.assinatura_trocas where assinatura=new.assinatura and inicio_ciclo=new.inicio
   and status<>'encerrada' and (tipo='upgrade' or status='pendente') order by ordem desc for update loop
   if t.status='aplicada' and hoje<t.fim_ciclo then
     perform public.assinatura_mudar_concessao(t.assinatura,t.novo,t.anterior,t.valor_anterior,t.escopo_anterior);
   end if;
   update public.assinatura_trocas set status='encerrada' where oferta=t.oferta;
   update public.faturas_cotadas set status='cancelada' where id=t.fatura and status='nova';
   update public.faturas_cotadas set operacao=case when status='paga' then 'estornar' else 'excluir' end,revisao_em=now()
    where id=t.fatura and status in ('paga','emitindo','aberta','vencida') and operacao is null;
 end loop;
 return new;
end $$;
create trigger fatura_estornar_trocas after update of status on public.faturas_cotadas
 for each row when (new.componente='plano' and old.status is distinct from new.status and new.status in ('parcial','estornada'))
 execute function public.assinatura_estornar_trocas_do_ciclo();

create function public.assinatura_encerrar_troca_pendente() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.assinatura_trocas set status='encerrada' where assinatura=new.id and status='pendente';
 return new;
end $$;
create trigger assinatura_encerrar_troca_pendente after update of cancelado on public.assinaturas_cotadas
 for each row when (old.aceite is not null and old.cancelado is null and new.cancelado is not null)
 execute function public.assinatura_encerrar_troca_pendente();

create function public.assinatura_conferir_reajuste_troca() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select from public.assinatura_trocas where assinatura=new.assinatura and status='pendente') then
   raise exception using errcode='55000',message='Conclua a troca de plano em andamento antes de propor um reajuste.';
 end if;
 return new;
end $$;
create trigger assinatura_conferir_reajuste_troca before insert on public.assinatura_reajustes
 for each row execute function public.assinatura_conferir_reajuste_troca();

revoke all on function public.assinatura_prever_troca(uuid,uuid),public.assinatura_mudar_concessao(uuid,text,text,int,text),
 public.assinatura_confirmar_troca(uuid,uuid,jsonb),public.assinatura_gerar(uuid,date),public.assinatura_reservar_emissao(uuid),
 public.assinatura_conciliar_troca(),public.assinatura_estornar_trocas_do_ciclo(),public.assinatura_encerrar_troca_pendente(),
 public.assinatura_conferir_reajuste_troca() from public,anon,authenticated,service_role;
grant execute on function public.assinatura_prever_troca(uuid,uuid),public.assinatura_confirmar_troca(uuid,uuid,jsonb),
 public.assinatura_gerar(uuid,date),public.assinatura_reservar_emissao(uuid) to service_role;
