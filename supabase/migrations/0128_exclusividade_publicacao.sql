-- Conferência documental de uma venda comum. As autorizações antigas não
-- viram exclusivas por migração. Operações/Jurídico precisa conferir a cópia.
alter table public.property_documents
  add column exclusividade_assinada_em date,
  add column exclusividade_meses smallint,
  add constraint exclusividade_documento_check check (
    (exclusividade_assinada_em is null and exclusividade_meses is null) or
    (tipo='autorizacao' and verificado is true and exclusividade_assinada_em is not null
     and exclusividade_meses is not null and exclusividade_meses in (6,12)));
create function public.fn_exigir_exclusividade_venda() returns trigger
language plpgsql security definer set search_path='' as $$
declare hoje date := (statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  if new.modalidade='leilao' or new.status not in ('aprovado','publicado','em_negociacao') then return new; end if;
  if tg_op='UPDATE' and old.status=new.status and old.modalidade is not distinct from new.modalidade then return new; end if;
  if exists (select from public.property_authorizations a
    where a.property_id=new.id and a.tipo='exclusividade' and a.aceite_por is not null
      and a.aceite_at is not null and a.aceite_at<=statement_timestamp() and a.validade>=hoje
      and a.termo_aceito->>'versao'='2026.11.15'
      and not exists(select from public.exclusividade_eventos e where e.autorizacao=a.id and e.evento in ('desistencia','encerramento'))
      and (new.status='aprovado' or a.termo_aceito->>'publicacao_antecipada'='true'
           or statement_timestamp()>=a.aceite_at+interval '7 days')) then return new; end if;
  if exists (select from public.property_documents d where d.property_id=new.id
    and d.tipo='autorizacao' and d.verificado and d.substituido_por is null
    and d.exclusividade_assinada_em<=hoje
    and (new.status='aprovado' or hoje>=d.exclusividade_assinada_em+7)
    and hoje<=case d.exclusividade_meses when 6 then d.exclusividade_assinada_em+180
                 when 12 then (d.exclusividade_assinada_em+interval '1 year')::date end) then return new; end if;
  raise exception 'Confira o Termo de Exclusividade vigente do imóvel, a data da assinatura e o prazo de publicação em Documentos.' using errcode='P1280';
end $$;
revoke all on function public.fn_exigir_exclusividade_venda() from public,anon,authenticated;
create trigger tr_exigir_exclusividade_venda before insert or update of status,modalidade on public.properties
for each row execute function public.fn_exigir_exclusividade_venda();
