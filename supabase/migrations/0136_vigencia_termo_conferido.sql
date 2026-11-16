-- O prazo configurável não reduz o prazo dos instrumentos já celebrados.
create function public.fn_termo_venda_vigente(imovel uuid,publicar boolean) returns boolean
language sql stable security definer set search_path='' as $$
with cfg as (select (statement_timestamp() at time zone 'America/Sao_Paulo')::date hoje,
  greatest(7,least(30,coalesce((select (valor #>> '{}')::int from public.settings where chave='juridico_carencia_publicacao_dias' and (valor #>> '{}') ~ '^[0-9]{1,2}$'),7))) carencia)
select exists (select from public.property_authorizations a
    where a.property_id=imovel and a.tipo='exclusividade' and a.aceite_por is not null
      and a.aceite_at is not null and a.aceite_at<=statement_timestamp() and a.validade>=hoje
      and a.termo_aceito->>'versao'='2026.11.15'
      and not exists(select from public.exclusividade_eventos e where e.autorizacao=a.id and e.evento in ('desistencia','encerramento'))
      and (not publicar or a.termo_aceito->>'publicacao_antecipada'='true'
           or statement_timestamp()>=a.aceite_at+make_interval(days=>carencia))) or exists (select from public.property_documents d where d.property_id=imovel
    and d.tipo='autorizacao' and d.verificado and d.substituido_por is null
    and d.exclusividade_assinada_em<=hoje
    and (not publicar or hoje>=d.exclusividade_assinada_em+carencia)
    and hoje<=case d.exclusividade_meses when 6 then d.exclusividade_assinada_em+180
                 when 12 then (d.exclusividade_assinada_em+interval '1 year')::date end) from cfg
$$;
revoke all on function public.fn_termo_venda_vigente(uuid,boolean) from public,anon,authenticated;
create or replace function public.fn_exigir_exclusividade_venda() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.modalidade='leilao' or new.status not in ('aprovado','publicado','em_negociacao') then return new; end if;
  if tg_op='UPDATE' and old.status=new.status and old.modalidade is not distinct from new.modalidade then return new; end if;
  if public.fn_termo_venda_vigente(new.id,new.status<>'aprovado') then return new; end if;
  raise exception 'Confira o Termo de Exclusividade vigente do imóvel, a data da assinatura e o prazo de publicação em Documentos.' using errcode='P1280';
end $$;

-- Só aplicar às vendas já documentadas por este fluxo. O cadastro legado não
-- é reclassificado nem despublicado em massa na implantação.
create function public.fn_conferir_vigencia_documental() returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  update public.properties p set status='suspenso'
    where p.modalidade is distinct from 'leilao' and p.status in ('aprovado','publicado','em_negociacao')
      and exists(select from public.property_documents d where d.property_id=p.id and d.exclusividade_assinada_em is not null)
      and not public.fn_termo_venda_vigente(p.id,p.status<>'aprovado');
  get diagnostics n=row_count; return n;
end $$;
revoke all on function public.fn_conferir_vigencia_documental() from public,anon,authenticated;
grant execute on function public.fn_conferir_vigencia_documental() to service_role;
create function public.fn_retirar_termo_conferido() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.properties p set status='suspenso' where p.id=old.property_id and p.modalidade is distinct from 'leilao'
    and p.status in ('aprovado','publicado','em_negociacao') and not public.fn_termo_venda_vigente(p.id,p.status<>'aprovado');
  return null;
end $$;
revoke all on function public.fn_retirar_termo_conferido() from public,anon,authenticated;
create trigger tr_retirar_termo_conferido after update of verificado,substituido_por,exclusividade_assinada_em,exclusividade_meses or delete on public.property_documents
for each row when (old.exclusividade_assinada_em is not null) execute function public.fn_retirar_termo_conferido();

-- Desde 0128 a regra unificada considera também o título físico conferido.
drop trigger if exists tr_publicacao_exclusiva on public.properties;
create or replace function public.fn_vigencia_exclusividades()
returns integer language plpgsql security definer set search_path='' as $$
declare a record; hoje date := (now() at time zone 'America/Sao_Paulo')::date; feitos integer:=0;
begin
  for a in
    select pa.id, pa.property_id,pa.aceite_por,pa.prazo_meses,pa.validade,p.codigo
    from public.property_authorizations pa join public.properties p on p.id=pa.property_id
    where pa.termo_aceito->>'versao'='2026.11.15' and pa.tipo='exclusividade'
      and p.status not in ('vendido','historico','inativo','reprovado')
      and pa.validade<=hoje+31 and not exists (
        select from public.exclusividade_eventos e where e.autorizacao=pa.id
          and (e.evento in ('desistencia','encerramento') or
               (e.evento='aviso' and e.vencimento=pa.validade and pa.validade>=hoje)))
    order by pa.validade limit 500 for update of pa skip locked
  loop
    if a.validade>=hoje then
      perform public.fn_notificar(a.aceite_por,'atencao','Prazo de exclusividade',
        'O prazo do imóvel '||a.codigo||' termina em '||to_char(a.validade,'DD/MM/YYYY')||
        '. Consulte o contrato e registre sua opção de não renovar até essa data.',
        '/conta/termos','exclusividade:'||a.id||':'||a.validade);
      insert into public.exclusividade_eventos(autorizacao,evento,vencimento) values(a.id,'aviso',a.validade)
        on conflict do nothing;
    elsif exists (select from public.exclusividade_eventos where autorizacao=a.id and evento='nao_renovar' and vencimento=a.validade)
       or not exists (select from public.exclusividade_eventos where autorizacao=a.id and evento='aviso' and vencimento=a.validade
         and (criado_em at time zone 'America/Sao_Paulo')::date<=a.validade-30) then
      insert into public.exclusividade_eventos(autorizacao,evento,vencimento) values(a.id,'encerramento',a.validade);
      update public.properties set status='inativo' where id=a.property_id and not public.fn_termo_venda_vigente(a.property_id,status<>'aprovado') and status in
        ('rascunho','pendente','em_analise','correcao','aprovado','publicado','em_negociacao','suspenso');
    else
      insert into public.exclusividade_eventos(autorizacao,evento,vencimento) values(a.id,'renovacao',a.validade);
      update public.property_authorizations set validade=case when a.prazo_meses=6 then a.validade+180
        else (a.validade+interval '1 year')::date end where id=a.id;
    end if;
    feitos:=feitos+1;
  end loop;
  return feitos;
end $$;
