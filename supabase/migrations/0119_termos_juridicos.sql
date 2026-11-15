-- Eventos de contratos novos. A íntegra e o instante originais permanecem no aceite.
create table public.exclusividade_eventos (
  id uuid primary key default gen_random_uuid(),
  autorizacao uuid not null references public.property_authorizations(id) on delete cascade,
  evento text not null check (evento in ('aviso','nao_renovar','desistencia','renovacao','encerramento')),
  vencimento date not null,
  titular uuid references public.profiles(user_id),
  criado_em timestamptz not null default now(),
  unique (autorizacao, evento, vencimento)
);
alter table public.exclusividade_eventos enable row level security;
revoke all on public.exclusividade_eventos from public, anon, authenticated;
grant select,insert on public.exclusividade_eventos to service_role;

create function public.fn_opcao_exclusividade(p_autorizacao uuid, p_titular uuid, p_evento text, p_vencimento date)
returns void language plpgsql security definer set search_path='' as $$
declare
  a public.property_authorizations%rowtype;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into a from public.property_authorizations where id=p_autorizacao and aceite_por=p_titular
    and tipo='exclusividade' and termo_aceito->>'versao'='2026.11.15' for update;
  if not found or p_evento is null or p_evento not in ('desistencia','nao_renovar') or p_vencimento is distinct from a.validade then
    raise exception 'Contrato ou período inválido.' using errcode='P1190';
  end if;
  if exists(select from public.exclusividade_eventos where autorizacao=a.id and evento=p_evento and vencimento=a.validade) then return; end if;
  if hoje>a.validade or (p_evento='desistencia' and now()>a.aceite_at+interval '7 days') or exists (
    select from public.exclusividade_eventos where autorizacao=a.id and evento in ('desistencia','encerramento')) then
    raise exception 'O prazo desta opção terminou. Consulte a Central de Atendimento.' using errcode='P1190';
  end if;
  insert into public.exclusividade_eventos(autorizacao,evento,vencimento,titular) values(a.id,p_evento,a.validade,p_titular);
  if p_evento='desistencia' then
    update public.properties set status='inativo' where id=a.property_id and status in
      ('rascunho','pendente','em_analise','correcao','aprovado','publicado','em_negociacao','suspenso');
  end if;
end $$;

create function public.fn_vigencia_exclusividades()
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
      update public.properties set status='inativo' where id=a.property_id and status in
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
revoke all on function public.fn_opcao_exclusividade(uuid,uuid,text,date),public.fn_vigencia_exclusividades() from public,anon,authenticated;
grant execute on function public.fn_opcao_exclusividade(uuid,uuid,text,date),public.fn_vigencia_exclusividades() to service_role;
create index idx_exclusividade_vigencia on public.property_authorizations(validade)
  where tipo='exclusividade' and termo_aceito->>'versao'='2026.11.15';

create function public.fn_publicacao_exclusiva() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='publicado' and old.status is distinct from new.status and exists (
    select from public.property_authorizations a where a.property_id=new.id and a.tipo='exclusividade'
      and a.termo_aceito->>'versao'='2026.11.15'
      and (a.validade < (now() at time zone 'America/Sao_Paulo')::date or
        (a.termo_aceito->>'publicacao_antecipada' is distinct from 'true' and now()<a.aceite_at+interval '7 days') or exists (
          select from public.exclusividade_eventos e where e.autorizacao=a.id and e.evento in ('desistencia','encerramento')))
  ) then raise exception 'Verifique a vigência da exclusividade e o prazo de desistência de sete dias antes de publicar.' using errcode='P1190';
  end if;
  return new;
end $$;
create trigger tr_publicacao_exclusiva before update of status on public.properties
  for each row execute function public.fn_publicacao_exclusiva();

-- Duas testemunhas distintas assinam a mesma cópia, depois do titular.
create table public.exclusividade_testemunhas (
  autorizacao uuid not null references public.property_authorizations(id) on delete cascade,
  posicao smallint not null check(posicao in (1,2)),
  perfil uuid not null references public.profiles(user_id),
  codigo text not null check(codigo ~ '^[0-9a-f]{64}$'),
  indicado_por uuid not null references public.profiles(user_id),
  assinado_em timestamptz, ip inet,
  primary key(autorizacao,posicao), unique(autorizacao,perfil)
);
alter table public.exclusividade_testemunhas enable row level security;
revoke all on public.exclusividade_testemunhas from public,anon,authenticated;
grant select,insert,update on public.exclusividade_testemunhas to service_role;

create function public.fn_indicar_testemunha(p_id uuid,p_posicao smallint,p_email text,p_ator uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.property_authorizations%rowtype; pessoa uuid; anterior uuid;
begin
  select * into a from public.property_authorizations where id=p_id and tipo='exclusividade'
    and termo_aceito->>'versao'='2026.11.15' for update;
  if not found or p_posicao is null or p_posicao not in(1,2) then raise exception 'Contrato ou posição inválida.' using errcode='P1190'; end if;
  select u.id into pessoa from auth.users u join public.profiles p on p.user_id=u.id and p.ativo
    where lower(u.email)=lower(trim(p_email)) and u.email_confirmed_at is not null and (p.cpf_cnpj is not null or p.cpf_cnpj_cifrado is not null);
  if pessoa is null or pessoa=a.aceite_por then raise exception 'Escolha uma conta ativa com e-mail confirmado e documento, distinta do titular.' using errcode='P1190'; end if;
  if exists(select from public.exclusividade_testemunhas where autorizacao=a.id and posicao=p_posicao and assinado_em is not null)
    or exists(select from public.exclusividade_testemunhas where autorizacao=a.id and posicao<>p_posicao and perfil=pessoa)
    then raise exception 'Use duas testemunhas distintas. Uma assinatura concluída é imutável.' using errcode='P1190'; end if;
  select perfil into anterior from public.exclusividade_testemunhas where autorizacao=a.id and posicao=p_posicao;
  insert into public.exclusividade_testemunhas(autorizacao,posicao,perfil,codigo,indicado_por)
    values(a.id,p_posicao,pessoa,a.termo_aceito->>'codigo_verificacao',p_ator)
    on conflict(autorizacao,posicao) do update set perfil=excluded.perfil, indicado_por=excluded.indicado_por;
  if anterior is distinct from pessoa then perform public.fn_notificar(pessoa,'info','Contrato para testemunhar',
    'Você foi indicado para conferir e assinar um Termo de Exclusividade.','/conta/termos','testemunha:'||a.id||':'||pessoa); end if;
end $$;
create function public.fn_assinar_testemunha(p_id uuid,p_titular uuid,p_codigo text,p_ip inet)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.exclusividade_testemunhas t set assinado_em=now(),ip=p_ip
  from public.property_authorizations a
  where t.autorizacao=a.id and a.id=p_id and t.perfil=p_titular and t.codigo=p_codigo
    and t.codigo=a.termo_aceito->>'codigo_verificacao' and t.assinado_em is null;
  if not found and not exists(select from public.exclusividade_testemunhas where autorizacao=p_id and perfil=p_titular and codigo=p_codigo and assinado_em is not null)
    then raise exception 'Esta assinatura não está disponível.' using errcode='P1190'; end if;
end $$;
revoke all on function public.fn_indicar_testemunha(uuid,smallint,text,uuid), public.fn_assinar_testemunha(uuid,uuid,text,inet) from public,anon,authenticated;
grant execute on function public.fn_indicar_testemunha(uuid,smallint,text,uuid), public.fn_assinar_testemunha(uuid,uuid,text,inet) to service_role;
