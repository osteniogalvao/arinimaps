-- Cada cobrança de plano tem uma única referência fiscal, independente da conta recebedora.
create table public.nfse_assinaturas (
  fatura uuid primary key references public.faturas_cotadas(id),
  estado text not null default 'pendente' check (estado in ('pendente','consultar','agendada','emitida','recusada','cancelada')),
  emitente text check (emitente in ('61134351000180','68128846000145')),
  gateway_id text, numero text, pdf_url text, xml_url text, mensagem text, unique(emitente,gateway_id),
  proxima timestamptz not null default now()
);
create table public.nfse_tomadores (
  cliente_cobranca text primary key,
  cliente_fiscal text
);
alter table public.nfse_assinaturas enable row level security;
alter table public.nfse_tomadores enable row level security;
revoke all on public.nfse_assinaturas,public.nfse_tomadores from public,anon,authenticated,service_role;
grant select,update on public.nfse_assinaturas to service_role;
grant select,insert,update,delete on public.nfse_tomadores to service_role;
create index nfse_assinaturas_fila on public.nfse_assinaturas(proxima) where estado in ('pendente','consultar','agendada');

create function public.registrar_nfse_assinatura() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.nfse_assinaturas(fatura) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger nfse_assinaturas_fila after insert or update of pagamento on public.faturas_cotadas
for each row when (new.pagamento is not null) execute function public.registrar_nfse_assinatura();
insert into public.nfse_assinaturas(fatura) select id from public.faturas_cotadas where pagamento is not null on conflict do nothing;

create function public.nfse_assinatura_proxima(p_desde date,p_apos_pagamento boolean,p_emitente text)
returns table (fatura uuid, estado text, gateway_id text, pagamento text, cliente text, plano text, componente text, valor int, inicio date)
language sql security definer set search_path='' as $$
  with candidata as (
    select n.fatura from public.nfse_assinaturas n join public.faturas_cotadas f on f.id=n.fatura
    where n.proxima<=now() and (n.emitente is null or n.emitente=p_emitente) and (
      n.estado in ('consultar','agendada') or
      n.estado='pendente' and f.inicio>=p_desde and f.operacao is null and
        (f.status='paga' or not p_apos_pagamento and f.status in ('aberta','vencida')))
    order by n.proxima,n.fatura limit 1 for update of n skip locked
  ), reserva as (
    update public.nfse_assinaturas n set proxima=now()+interval '10 minutes'
    from candidata c where n.fatura=c.fatura returning n.fatura,n.estado,n.gateway_id
  )
  select r.fatura,r.estado,r.gateway_id,f.pagamento,a.cliente,a.plano,f.componente,f.valor,f.inicio
  from reserva r join public.faturas_cotadas f on f.id=r.fatura join public.assinaturas_cotadas a on a.id=f.assinatura;
$$;

-- Só a sessão que fez esta transição pode iniciar o POST. Após queda ou timeout
-- o próximo processamento consulta a referência, inclusive se houve estorno.
create function public.nfse_assinatura_reservar_post(p_fatura uuid,p_desde date,p_apos_pagamento boolean,p_emitente text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.faturas_cotadas f where f.id=p_fatura and f.pagamento is not null and f.inicio>=p_desde
    and f.operacao is null and (f.status='paga' or not p_apos_pagamento and f.status in ('aberta','vencida')) for update;
  if not found then return false; end if;
  update public.nfse_assinaturas set estado='consultar',emitente=p_emitente,mensagem=null,proxima=now()+interval '10 minutes'
    where fatura=p_fatura and estado='pendente' and gateway_id is null and (emitente is null or emitente=p_emitente);
  return found;
end $$;

create function public.nfse_assinatura_confirmar(p_fatura uuid,p_emitente text,p_id text,p_estado text,p_numero text,p_pdf text,p_xml text,p_mensagem text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_estado not in ('agendada','emitida','recusada','cancelada') or nullif(p_id,'') is null then raise invalid_parameter_value; end if;
  update public.nfse_assinaturas set gateway_id=p_id,emitente=p_emitente,estado=p_estado,numero=coalesce(p_numero,numero),
    pdf_url=coalesce(p_pdf,pdf_url),xml_url=coalesce(p_xml,xml_url),mensagem=p_mensagem,
    proxima=now()+interval '6 hours'
  where fatura=p_fatura and (emitente=p_emitente or emitente is null) and (gateway_id=p_id or gateway_id is null and estado in ('consultar','pendente'))
    and (estado<>'cancelada' or p_estado='cancelada') and (estado<>'emitida' or p_estado in ('emitida','cancelada'));
  return found;
end $$;
revoke all on function public.nfse_assinatura_confirmar(uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.nfse_assinatura_confirmar(uuid,text,text,text,text,text,text,text) to service_role;
revoke all on function public.registrar_nfse_assinatura(), public.nfse_assinatura_proxima(date,boolean,text),
  public.nfse_assinatura_reservar_post(uuid,date,boolean,text) from public,anon,authenticated;
grant execute on function public.nfse_assinatura_proxima(date,boolean,text),public.nfse_assinatura_reservar_post(uuid,date,boolean,text) to service_role;
