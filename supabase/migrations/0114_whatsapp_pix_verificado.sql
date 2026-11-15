-- A versão acompanha o número normalizado. Um desafio antigo não serve depois de trocar e voltar ao telefone anterior.
alter table public.profiles add column telefone_confirmacao_versao uuid not null default gen_random_uuid();
alter table public.whatsapp_mensagens add column recebida_em timestamptz;
create index whatsapp_janela_recebida on public.whatsapp_mensagens(telefone,recebida_em desc) where direcao='entrada' and recebida_em is not null;
create table public.assinatura_whatsapp_verificado (
 titular uuid primary key references public.profiles(user_id) on delete cascade, telefone text unique not null,
 versao uuid not null, recebido_em timestamptz not null
);
alter table public.assinatura_whatsapp_verificado enable row level security;
revoke all on public.assinatura_whatsapp_verificado from public,anon,authenticated,service_role;

create or replace function public.retomada_converteu() returns trigger language plpgsql security definer set search_path='' as $$
declare tel text:=public.assinatura_telefone(new.telefone);
begin
 if new.ativo and tel is not null then
   perform pg_advisory_xact_lock(hashtextextended(tel,0));
   update public.retomadas_cadastro set status='convertida',encerrado_em=now() where status='aberta' and telefone=tel;
 end if;
 return new;
end $$;

create function public.assinatura_whatsapp_troca() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if public.assinatura_telefone(old.telefone) is distinct from public.assinatura_telefone(new.telefone) then
   new.telefone_confirmacao_versao:=gen_random_uuid();
   delete from public.assinatura_whatsapp_verificado where titular=new.user_id;
   insert into public.conta_consentimentos(titular,finalidade,permitido,versao)
     select new.user_id,ultima.finalidade,false,'troca_numero_1'
       from (select distinct on (finalidade) finalidade,permitido from public.conta_consentimentos
         where titular=new.user_id and finalidade in ('whatsapp_assinatura','whatsapp_recuperacao')
         order by finalidade,id desc) ultima where ultima.permitido;
 else new.telefone_confirmacao_versao:=old.telefone_confirmacao_versao; end if;
 return new;
end $$;
create trigger assinatura_whatsapp_troca before update of telefone,telefone_confirmacao_versao on public.profiles
  for each row execute function public.assinatura_whatsapp_troca();

create function public.assinatura_whatsapp_confirmar(p_titular uuid,p_tel text,p_versao uuid,p_recebido timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 if p_recebido is null or p_recebido>now()+interval '1 minute' or p_recebido<now()-interval '24 hours' then return false; end if;
 select * into p from public.profiles where user_id=p_titular and ativo for update;
 if not found or p.telefone_confirmacao_versao<>p_versao or public.assinatura_telefone(p.telefone) is distinct from p_tel
   or public.assinatura_titular_telefone(p_tel) is distinct from p_titular then return false; end if;
 delete from public.assinatura_whatsapp_verificado where telefone=p_tel and titular<>p_titular;
 insert into public.assinatura_whatsapp_verificado(titular,telefone,versao,recebido_em)
 values(p_titular,p_tel,p_versao,least(now(),p_recebido))
 on conflict(titular) do update set recebido_em=greatest(assinatura_whatsapp_verificado.recebido_em,excluded.recebido_em)
   where assinatura_whatsapp_verificado.versao=excluded.versao;
 return found;
end $$;
create function public.assinatura_whatsapp_canal(p_titular uuid)
returns table(telefone text,versao uuid,verificado boolean,janela_ate timestamptz) language sql stable security definer set search_path='' as $$
  select public.assinatura_telefone(p.telefone),p.telefone_confirmacao_versao,v.titular is not null,
   case when v.titular is not null then greatest(v.recebido_em,(select max(m.recebida_em) from public.whatsapp_mensagens m
     where m.direcao='entrada' and m.telefone=v.telefone and m.recebida_em>=v.recebido_em and m.recebida_em<=now()))+interval '24 hours' end
  from public.profiles p left join public.assinatura_whatsapp_verificado v on v.titular=p.user_id and v.versao=p.telefone_confirmacao_versao
  where p.user_id=p_titular and p.ativo and public.assinatura_titular_telefone(p.telefone)=p.user_id;
$$;

alter table public.assinatura_pix_whatsapp add column canal text not null default 'pix' check(canal in ('pix','link'));
alter table public.assinatura_pix_whatsapp drop constraint assinatura_pix_whatsapp_pkey;
alter table public.assinatura_pix_whatsapp add primary key(fatura,dia,canal);
revoke insert(fatura) on public.assinatura_pix_whatsapp from service_role;
create function public.assinatura_pix_reservar(p_titular uuid,p_fatura uuid,p_modo text,p_telefone text)
returns date language plpgsql security definer set search_path='' as $$
declare c record; dia_reservado date;
begin
 if p_modo not in ('livre','modelo','link') then raise invalid_parameter_value; end if;
 perform 1 from public.profiles where user_id=p_titular and ativo for share;
 select * into c from public.assinatura_whatsapp_canal(p_titular);
 if not found or not c.verificado or c.telefone is distinct from p_telefone
   or (p_modo='livre' and not (c.janela_ate>now()))
   or not coalesce((select permitido from public.conta_consentimentos where titular=p_titular and finalidade='whatsapp_assinatura' order by id desc limit 1),false)
   then raise insufficient_privilege; end if;
 perform 1 from public.faturas_cotadas f join public.assinaturas_cotadas s on s.id=f.assinatura where f.id=p_fatura and s.titular=p_titular
   and s.cancelado is null and f.status in('aberta','vencida') and f.operacao is null for share of f,s;
 if not found then raise invalid_parameter_value; end if;
 insert into public.assinatura_pix_whatsapp(fatura,canal) values(p_fatura,case p_modo when 'link' then 'link' else 'pix' end)
 on conflict do nothing returning dia into dia_reservado;
 return dia_reservado;
end $$;
revoke all on function public.assinatura_whatsapp_troca(),public.assinatura_whatsapp_confirmar(uuid,text,uuid,timestamptz),public.assinatura_whatsapp_canal(uuid),
  public.assinatura_pix_reservar(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.assinatura_whatsapp_confirmar(uuid,text,uuid,timestamptz),public.assinatura_whatsapp_canal(uuid),
  public.assinatura_pix_reservar(uuid,uuid,text,text) to service_role;
