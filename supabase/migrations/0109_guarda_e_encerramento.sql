-- O Jurídico vincula o protocolo ao titular verificado. A conta perde acesso
-- antes de o serviço Auth concluir sua exclusão lógica (retomável).
create table public.lgpd_encerramentos (
  pedido_id uuid primary key references public.lgpd_requests(id),
  titular uuid not null unique,
  responsavel uuid not null,
  iniciado_em timestamptz not null default now(),
  auth_concluido_em timestamptz
);
create table public.lgpd_guardas (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  cofre_id uuid references public.cofre_propriedades(id) on delete set null,
  codigo_imovel text not null,
  fundamento text not null check (length(trim(fundamento)) between 1 and 2000),
  revisar_em date not null,
  criada_por uuid not null,
  criada_em timestamptz not null default now(),
  liberada_por uuid,
  liberada_em timestamptz,
  motivo_liberacao text
);
create index lgpd_guardas_imovel_ativas on public.lgpd_guardas(property_id) where liberada_em is null;
create index lgpd_guardas_cofre_ativas on public.lgpd_guardas(cofre_id) where liberada_em is null;
alter table public.lgpd_encerramentos enable row level security;
alter table public.lgpd_guardas enable row level security;
revoke all on public.lgpd_encerramentos, public.lgpd_guardas from public, anon, authenticated, service_role;
grant select on public.lgpd_encerramentos, public.lgpd_guardas to service_role;

create function public.lgpd_sessao_encerrada() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select from public.lgpd_encerramentos where titular=(select auth.uid()))
$$;
revoke all on function public.lgpd_sessao_encerrada() from public;
grant execute on function public.lgpd_sessao_encerrada() to authenticated, service_role;

-- Um JWT já emitido pode continuar válido até expirar. A sessão antiga
-- tampouco pode usar as policies do seu próprio usuário diretamente na API.
do $$
declare t record;
begin
  for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and c.relrowsecurity and
      n.nspname='public' and exists(select from pg_policy p where p.polrelid=c.oid)
      and has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
  loop
    execute format('create policy lgpd_sessao_ativa on %I.%I as restrictive for all to authenticated
      using (not (select public.lgpd_sessao_encerrada())) with check (not (select public.lgpd_sessao_encerrada()))', t.nspname,t.relname);
  end loop;
end $$;

create function public.lgpd_encerrar_conta(p_pedido uuid,p_ator uuid,p_simular boolean,p_resposta text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.lgpd_requests%rowtype;
  caso public.lgpd_encerramentos%rowtype;
  u uuid;
  estimativa jsonb;
begin
  if not exists(select from public.profiles where user_id=p_ator and ativo
    and (role='admin_central' or (role='analista_arini' and 'juridico'=any(setores)))) then
    raise exception 'Acesso restrito ao Jurídico.' using errcode='42501';
  end if;
  select * into strict r from public.lgpd_requests where id=p_pedido for update;
  if r.tipo<>'exclusao' then raise exception 'O protocolo não é de exclusão.'; end if;
  select * into caso from public.lgpd_encerramentos where pedido_id=p_pedido;
  if found then return jsonb_build_object('titular',caso.titular,'concluido',caso.auth_concluido_em is not null); end if;
  if r.status not in ('recebido','em_analise') then raise exception 'Protocolo encerrado.'; end if;
  -- Pedido sem sessão somente após a conferência manual de identidade no
  -- Jurídico. Nunca se troca o titular de um protocolo aberto autenticado.
  select id into u from auth.users where lower(email)=lower(trim(r.email))
    and (r.user_id is null or id=r.user_id) and deleted_at is null;
  if u is null then raise exception 'O e-mail do protocolo não corresponde a uma conta ativa.'; end if;
  if u=p_ator or exists(select from public.profiles where user_id=u and role in ('admin_central','analista_arini'))
    then raise exception 'Contas da equipe são administradas pela Diretoria.'; end if;
  perform 1 from public.profiles where user_id=u for update;
  if not found then raise exception 'Perfil ausente.'; end if;
  if exists(select from public.lgpd_encerramentos where titular=u) then raise exception 'A conta já tem protocolo de encerramento.'; end if;
  perform pg_advisory_xact_lock(109,1);
  select jsonb_build_object('favoritos',(select count(*) from public.favoritos where user_id=u),
    'conversas',(select count(*) from public.ia_conversas where user_id=u),
    'filtros',(select count(*) from public.filtros_interesse where titular=u),
    'monitoramentos',(select count(*) from public.monitor_areas where titular=u),
    'propriedades_cofre',(select count(*) from public.cofre_propriedades c where titular_id=u and not exists
      (select from public.lgpd_guardas g where g.cofre_id=c.id and liberada_em is null))) into estimativa;
  if p_simular then return estimativa||jsonb_build_object('cofres',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nome',c.nome))
    from public.cofre_propriedades c where c.titular_id=u),'[]'::jsonb)); end if;
  if length(trim(coalesce(p_resposta,'')))=0 then raise exception 'Informe a resposta ao titular.'; end if;
  insert into public.lgpd_encerramentos(pedido_id,titular,responsavel) values(r.id,u,p_ator);
  -- Invalida a renovação de sessão e bloqueia novo login mesmo se o Auth
  -- ficar temporariamente indisponível entre o bloqueio e a exclusão lógica.
  update auth.users set banned_until=timestamptz '9999-12-31 00:00:00+00' where id=u;
  delete from auth.sessions where user_id=u;
  update public.profiles set ativo=false,nome='Conta encerrada',telefone=null,avatar_url=null,cpf_cnpj=null,
    cpf_hash=null,cpf_cnpj_cifrado=null,preferencias='{}',tours_vistos='{}',profissao_declarada=null,especialidade=null,avisos_email=false
    where user_id=u;
  delete from public.favoritos where user_id=u;
  delete from public.ia_conversas where user_id=u;
  delete from public.filtros_interesse where titular=u;
  delete from public.monitor_areas where titular=u;
  delete from public.notificacoes where user_id=u;
  delete from public.conta_contextos where titular=u;
  -- Os aceites ficam como prova; a última decisão de cada finalidade
  -- anteriormente habilitada passa a revogada, inclusive para os workers.
  insert into public.conta_consentimentos(titular,finalidade,permitido,versao)
    select u, c.finalidade, false, 'encerramento' from
      (select distinct on (finalidade) finalidade,permitido from public.conta_consentimentos
       where titular=u order by finalidade,id desc) c where c.permitido;
  -- Cópias de trabalho do cofre pessoal; as evidências do imóvel estão em
  -- property_documents e property_authorizations e seguem o descarte por prazo.
  delete from public.cofre_propriedades c where titular_id=u and not exists
    (select from public.lgpd_guardas g where g.cofre_id=c.id and liberada_em is null);
  update public.lgpd_requests set status='em_analise',user_id=u,resposta=p_resposta where id=r.id;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
    values(p_ator,'lgpd_conta_bloqueada','lgpd_requests',r.id,estimativa);
  return jsonb_build_object('titular',u,'concluido',false);
end $$;

create function public.lgpd_finalizar_encerramento(p_pedido uuid,p_ator uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare caso public.lgpd_encerramentos%rowtype;
begin
  select * into strict caso from public.lgpd_encerramentos where pedido_id=p_pedido for update;
  if caso.auth_concluido_em is not null then return false; end if;
  if exists(select from auth.users where id=caso.titular and deleted_at is null) then
    raise exception 'A autenticação ainda não confirmou o encerramento.' using errcode='P1009';
  end if;
  update public.lgpd_encerramentos set auth_concluido_em=now() where pedido_id=p_pedido;
  update public.lgpd_requests set status='atendido', atendido_em=now(), atendido_por=p_ator where id=p_pedido;
  insert into public.audit_log(user_id,acao,entidade,entidade_id) values(p_ator,'lgpd_conta_encerrada','lgpd_requests',p_pedido);
  return true;
end $$;
revoke all on function public.lgpd_encerrar_conta(uuid,uuid,boolean,text), public.lgpd_finalizar_encerramento(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lgpd_encerrar_conta(uuid,uuid,boolean,text), public.lgpd_finalizar_encerramento(uuid,uuid) to service_role;

create function public.lgpd_validar_estado_pedido() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.lgpd_encerramentos%rowtype;
begin
  select * into c from public.lgpd_encerramentos where pedido_id=new.id;
  if found and (new.status<>case when c.auth_concluido_em is null then 'em_analise' else 'atendido' end
    or new.user_id is distinct from c.titular) then raise exception 'Encerramento da conta em andamento ou concluído.'; end if;
  return new;
end $$;
create trigger lgpd_validar_estado_pedido before update of status,user_id on public.lgpd_requests
  for each row execute function public.lgpd_validar_estado_pedido();

create function public.lgpd_impedir_reativacao() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.ativo and not old.ativo and exists(select from public.lgpd_encerramentos where titular=old.user_id) then
    raise exception 'Conta encerrada pelo Jurídico.';
  end if;
  return new;
end $$;
create trigger lgpd_impedir_reativacao before update of ativo on public.profiles
  for each row execute function public.lgpd_impedir_reativacao();

-- A data dispara revisão humana. Somente uma liberação motivada termina a
-- preservação. O mesmo lock serializa decisões com a remoção física no worker.
create function public.lgpd_decidir_guarda(p_imovel text,p_guarda uuid,p_motivo text,p_revisar date,p_ator uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare g public.lgpd_guardas%rowtype; imovel uuid; cofre uuid;
begin
  if not exists(select from public.profiles where user_id=p_ator and ativo
    and (role='admin_central' or (role='analista_arini' and 'juridico'=any(setores)))) then raise insufficient_privilege; end if;
  if coalesce(length(trim(p_motivo)),0) not between 1 and 2000 then raise exception 'Informe o fundamento da decisão.'; end if;
  perform pg_advisory_xact_lock(109,1);
  if p_guarda is null then
    if left(upper(trim(p_imovel)),6)='COFRE-' then
      select id into strict cofre from public.cofre_propriedades where id=substring(trim(p_imovel) from 7)::uuid;
    else
      select id into strict imovel from public.properties where codigo=upper(trim(p_imovel));
    end if;
    if p_revisar is null or p_revisar<current_date then raise exception 'Informe uma data de revisão válida.'; end if;
    insert into public.lgpd_guardas(property_id,cofre_id,codigo_imovel,fundamento,revisar_em,criada_por)
      values(imovel,cofre,upper(trim(p_imovel)),trim(p_motivo),p_revisar,p_ator) returning * into g;
  else
    update public.lgpd_guardas set liberada_por=p_ator,liberada_em=now(),motivo_liberacao=trim(p_motivo)
      where id=p_guarda and liberada_em is null returning * into strict g;
    delete from public.cofre_propriedades c where c.id=g.cofre_id
      and exists(select from public.lgpd_encerramentos e where e.titular=c.titular_id)
      and not exists(select from public.lgpd_guardas outra where outra.cofre_id=c.id and outra.liberada_em is null);
  end if;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,property_id)
    values(p_ator,case when p_guarda is null then 'guarda_aberta' else 'guarda_liberada' end,'lgpd_guardas',g.id,g.property_id);
  return g.id;
end $$;
revoke all on function public.lgpd_decidir_guarda(text,uuid,text,date,uuid) from public,anon,authenticated;
grant execute on function public.lgpd_decidir_guarda(text,uuid,text,date,uuid) to service_role;

create or replace function public.fn_descarte_candidatos(p_selfie_dias int,p_docs_dias int,p_logs_dias int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare selfies jsonb:='[]'; docs jsonb:='[]'; logs jsonb:='{}'; t text; n bigint;
begin
  if p_selfie_dias>0 then
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'property_id',a.property_id,'path',a.selfie_path)),'[]') into selfies
      from property_authorizations a where selfie_path is not null and coalesce(a.validade::timestamptz,a.created_at)+make_interval(days=>p_selfie_dias)<now()
      and not exists(select from lgpd_guardas g where g.property_id=a.property_id and g.liberada_em is null);
  end if;
  if p_docs_dias>0 then
    select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'property_id',d.property_id,'path',d.storage_path,'tipo',d.tipo,'nome',d.nome_arquivo)),'[]') into docs
      from property_documents d join properties p on p.id=d.property_id where p.status='reprovado'
      and p.updated_at+make_interval(days=>p_docs_dias)<now()
      and not exists(select from lgpd_guardas g where g.property_id=d.property_id and g.liberada_em is null);
  end if;
  if p_logs_dias>0 then
    foreach t in array array['auth_events','document_access_log','access_attempts','consultas_area_log','alertas_seguranca'] loop
      if to_regclass('public.'||t) is not null then
        execute format('select count(*) from %I l where created_at<now()-make_interval(days=>$1)',t)
          ||case when t='document_access_log' then ' and not exists(select from lgpd_guardas g where g.liberada_em is null and (g.property_id=l.property_id or (g.cofre_id is not null and split_part(l.storage_path,''/'',1)=''cofre'' and split_part(l.storage_path,''/'',3)=g.cofre_id::text)))' else '' end
          into n using p_logs_dias;
        logs:=logs||jsonb_build_object(t,n);
      end if;
    end loop;
  end if;
  return jsonb_build_object('selfies',selfies,'documentos',docs,'logs',logs,
    'prazos',jsonb_build_object('selfie',p_selfie_dias,'documentos',p_docs_dias,'logs',p_logs_dias));
end $$;

create function public.lgpd_proteger_registro_imovel() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='document_access_log' and current_setting('arini.descarte_autorizado',true)='on' then
    if exists(select from public.lgpd_guardas g where liberada_em is null and (
      g.property_id=old.property_id or (g.cofre_id is not null and split_part(old.storage_path,'/',1)='cofre' and split_part(old.storage_path,'/',3)=g.cofre_id::text))) then return null; end if;
    return old;
  end if;
  if exists(select from public.lgpd_guardas where property_id=old.property_id and liberada_em is null) then
    raise exception 'Registro preservado pelo Jurídico.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger lgpd_preservar_documento before delete or update of storage_path on public.property_documents
  for each row execute function public.lgpd_proteger_registro_imovel();
create trigger lgpd_preservar_autorizacao before delete or update of selfie_path on public.property_authorizations
  for each row execute function public.lgpd_proteger_registro_imovel();
create trigger lgpd_preservar_acesso before delete on public.document_access_log
  for each row execute function public.lgpd_proteger_registro_imovel();

create function public.lgpd_impedir_remocao_imovel() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select from public.lgpd_guardas where property_id=old.id and liberada_em is null) then
    raise exception 'Imóvel com preservação de evidências em andamento.';
  end if;
  return old;
end $$;
create trigger lgpd_impedir_remocao_imovel before delete on public.properties
  for each row execute function public.lgpd_impedir_remocao_imovel();

create function public.lgpd_proteger_cofre() returns trigger language plpgsql security definer set search_path='' as $$
declare cofre uuid;
begin
  if tg_table_name='cofre_documentos' then cofre:=old.propriedade_id; else cofre:=old.id; end if;
  if exists(select from public.lgpd_guardas where cofre_id=cofre and liberada_em is null) then
    raise exception 'Cofre sob preservação do Jurídico.';
  end if;
  return old;
end $$;
create trigger lgpd_preservar_cofre before delete on public.cofre_propriedades
  for each row execute function public.lgpd_proteger_cofre();
create trigger lgpd_preservar_anexo before delete on public.cofre_documentos
  for each row execute function public.lgpd_proteger_cofre();

-- O painel do anunciante já exibe contagens agregadas pelo servidor.
-- A leitura direta de IP, identidade e detalhes dos eventos é da Matriz.
drop policy if exists p_property_events_read on public.property_events;
create policy p_property_events_read on public.property_events for select to authenticated using(public.fn_is_arini());
