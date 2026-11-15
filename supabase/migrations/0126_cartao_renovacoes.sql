-- A autorização identifica a fatura que o titular ainda vai pagar na página do Asaas.
-- Os números do cartão, o código de segurança e o token ficam no provedor.
create table public.assinatura_cartao (
 assinatura uuid primary key references public.assinaturas_cotadas(id),
 origem uuid not null unique references public.faturas_cotadas(id),
 final text not null check (final ~ '^[0-9]{4}$'),
 plano text not null, ciclo text not null, recorrente int not null, adicionais int not null,
 autorizado_em timestamptz not null default now(),
 situacao text not null default 'aguardando' check (situacao in ('aguardando','ativo','indisponivel'))
);
alter table public.assinatura_cartao enable row level security;
revoke all on public.assinatura_cartao from public,anon,authenticated,service_role;
grant select,update(situacao) on public.assinatura_cartao to service_role;

alter table public.faturas_cotadas add column tentativa_cartao timestamptz;

create function public.cartao_retira_autorizacao() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from public.assinatura_cartao where assinatura=new.id;
 return new;
end $$;
revoke all on function public.cartao_retira_autorizacao() from public,anon,authenticated,service_role;
create trigger cartao_novas_condicoes after update of plano,ciclo,recorrente,adicionais,cancelado on public.assinaturas_cotadas
for each row when (row(old.plano,old.ciclo,old.recorrente,old.adicionais,old.cancelado) is distinct from
  row(new.plano,new.ciclo,new.recorrente,new.adicionais,new.cancelado))
execute function public.cartao_retira_autorizacao();

create function public.assinatura_autorizar_cartao(p_titular uuid,p_id uuid,p_origem uuid,p_final text,
 p_plano text,p_ciclo text,p_recorrente int,p_adicionais int) returns void
language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas;
begin
 select * into strict s from public.assinaturas_cotadas where titular=p_titular and id=p_id for update;
 if p_origem is null then
   delete from public.assinatura_cartao where assinatura=s.id;
   if not found then return; end if;
   insert into public.audit_log(user_id,acao,entidade,entidade_id) values(p_titular,'cartao.revogado','assinaturas_cotadas',s.id);
   return;
 end if;
 if s.aceite is null or s.cancelado is not null or s.nicho not in ('proprietario','produtor_rural','engenheiro')
    or not public.assinatura_pode_faturar(s)
    or not exists(select from public.profiles where user_id=p_titular and ativo and nicho=s.nicho)
    or row(s.plano,s.ciclo,s.recorrente,s.adicionais) is distinct from row(p_plano,p_ciclo,p_recorrente,p_adicionais)
    or p_final is null or p_final !~ '^[0-9]{4}$' then raise object_not_in_prerequisite_state; end if;
 perform 1 from public.faturas_cotadas where id=p_origem and assinatura=s.id and componente='plano'
    and status='aberta' and operacao is null and pagamento is not null for update;
 if not found then raise object_not_in_prerequisite_state; end if;
 insert into public.assinatura_cartao(assinatura,origem,final,plano,ciclo,recorrente,adicionais)
 values(s.id,p_origem,p_final,s.plano,s.ciclo,s.recorrente,s.adicionais)
 on conflict(assinatura) do update set origem=excluded.origem,final=excluded.final,plano=excluded.plano,
   ciclo=excluded.ciclo,recorrente=excluded.recorrente,adicionais=excluded.adicionais,situacao='aguardando',autorizado_em=now();
 insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
 values(p_titular,'cartao.autorizado','assinaturas_cotadas',s.id,jsonb_build_object('origem',p_origem,'final',p_final,
   'plano',s.plano,'ciclo',s.ciclo,'recorrente',s.recorrente,'adicionais',s.adicionais,'versao',1));
end $$;

-- Somente uma tentativa por fatura, ainda que o primeiro processo perca a resposta do gateway.
create function public.assinatura_reservar_cartao(p_id uuid,p_origem uuid,p_autorizado timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.assinaturas_cotadas; a public.assinatura_cartao; hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 select * into s from public.assinaturas_cotadas where id=(select assinatura from public.faturas_cotadas where id=p_id) for update;
 if not found or s.cancelado is not null or not public.assinatura_pode_faturar(s) then return false; end if;
 select * into a from public.assinatura_cartao where assinatura=s.id and situacao='ativo' and origem=p_origem and autorizado_em=p_autorizado;
 if not found or row(s.plano,s.ciclo,s.recorrente,s.adicionais) is distinct from row(a.plano,a.ciclo,a.recorrente,a.adicionais) then return false; end if;
 if not exists(select from public.faturas_cotadas where id=a.origem and assinatura=s.id and status='paga' and operacao is null) then return false; end if;
 update public.faturas_cotadas set tentativa_cartao=now()
 where id=p_id and assinatura=s.id and componente in ('plano','adicionais') and numero>0 and status='aberta'
   and operacao is null and tentativa_cartao is null and pagamento is not null and inicio=hoje
   and inicio>(a.autorizado_em at time zone 'America/Sao_Paulo')::date
   and valor=case when componente='plano' then a.recorrente+case when a.ciclo='mensal' then a.adicionais else 0 end
                  when a.ciclo='anual' then a.adicionais end;
 return found;
end $$;
revoke all on function public.assinatura_autorizar_cartao(uuid,uuid,uuid,text,text,text,int,int),public.assinatura_reservar_cartao(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.assinatura_autorizar_cartao(uuid,uuid,uuid,text,text,text,int,int),public.assinatura_reservar_cartao(uuid,uuid,timestamptz) to service_role;
