-- Programa de divulgadores. O cadastro no piloto é independente do perfil em uso.
alter table public.profiles drop constraint chk_profiles_nicho;
alter table public.profiles add constraint chk_profiles_nicho check (nicho is null or nicho in (
  'consulta','comprador_investidor','proprietario','produtor_rural','corretor_imobiliaria','leiloeiro',
  'engenheiro','empresa_holding','ente_publico','franqueado','correspondente_bancario','divulgador'
));

create table public.divulgacao_piloto (
  id boolean primary key default true check (id),
  aberto boolean not null default false,
  atribuicao_dias integer not null default 30 check(atribuicao_dias between 1 and 365),
  revisao_dias integer not null default 30 check(revisao_dias between 1 and 365),
  participantes_max integer not null default 0 check (participantes_max between 0 and 100000),
  imoveis_max integer not null default 0 check (imoveis_max between 0 and 100000),
  seguidores_min integer not null default 0 check (seguidores_min >= 0)
);
insert into public.divulgacao_piloto(id) values(true);

create table public.divulgacao_cadastros (
  titular uuid primary key references public.profiles(user_id) on delete cascade,
  estado text not null check (estado in ('espera','analise','ativo','recusado','suspenso')),
  instagram text check (instagram ~ '^[a-z0-9._]{1,30}$'),
  cnpj text check (cnpj ~ '^[0-9]{14}$' or (cnpj like 'enc1:%' and length(cnpj) < 300)),
  regiao text check (length(regiao) between 2 and 100),
  seguidores integer check (seguidores >= 0),
  verificado_em timestamptz,
  motivo text check (length(motivo) <= 500),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index divulgacao_instagram_ativo on public.divulgacao_cadastros(instagram) where estado='ativo';
create index divulgacao_cadastros_fila on public.divulgacao_cadastros(estado,criado_em,titular);

alter table public.divulgacao_piloto enable row level security;
alter table public.divulgacao_cadastros enable row level security;
revoke all on public.divulgacao_piloto, public.divulgacao_cadastros from public,anon,authenticated;
grant select,update on public.divulgacao_piloto to service_role;
grant select on public.divulgacao_cadastros to service_role;

create function public.divulgacao_situacao() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('aberto',p.aberto,'tem_vaga',p.aberto and p.participantes_max >
   (select count(*) from public.divulgacao_cadastros c where c.estado='ativo'))
 from public.divulgacao_piloto p where p.id;
$$;

create function public.divulgacao_inscrever(p_titular uuid,p_instagram text default null,p_cnpj text default null,p_regiao text default null)
returns text language plpgsql security definer set search_path='' as $$
declare piloto public.divulgacao_piloto%rowtype; anterior text; destino text;
begin
  if not exists (select from public.profiles where user_id=p_titular and ativo and role not in ('admin_central','analista_arini','franqueado')) then
    raise exception 'Esta conta não pode participar.' using errcode='P8601';
  end if;
  select * into strict piloto from public.divulgacao_piloto where id for update;
  select estado into anterior from public.divulgacao_cadastros where titular=p_titular for update;
  if anterior in ('ativo','analise','recusado','suspenso') then return anterior; end if;
  if not piloto.aberto or piloto.participantes_max <= (select count(*) from public.divulgacao_cadastros where estado='ativo') then
    destino:='espera';
  else
    if p_instagram is null or p_instagram !~ '^[a-z0-9._]{1,30}$' or p_cnpj is null or (p_cnpj !~ '^[0-9]{14}$' and p_cnpj not like 'enc1:%')
      or coalesce(length(trim(p_regiao)),0) not between 2 and 100 then
      raise exception 'Informe Instagram, CNPJ e região de atuação para análise.' using errcode='P8601';
    end if;
    destino:='analise';
  end if;
  insert into public.divulgacao_cadastros as c(titular,estado,instagram,cnpj,regiao)
  values(p_titular,destino,case when destino='analise' then p_instagram end,
         case when destino='analise' then p_cnpj end,case when destino='analise' then trim(p_regiao) end)
  on conflict(titular) do update set estado=excluded.estado,instagram=excluded.instagram,cnpj=excluded.cnpj,
    regiao=excluded.regiao,atualizado_em=now() where c.estado is distinct from excluded.estado;
  if anterior is distinct from destino then
    insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
    values(p_titular,'divulgacao_inscricao','divulgacao_cadastros',p_titular,jsonb_build_object('estado',destino));
  end if;
  return destino;
end $$;

create function public.divulgacao_equipe(p_ator uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from public.profiles where user_id=p_ator and ativo and
   (role='admin_central' or (role='analista_arini' and 'marketing'=any(setores))));
$$;

create function public.divulgacao_configurar(p_ator uuid,p_aberto boolean,p_participantes integer,p_imoveis integer,p_seguidores integer,p_atribuicao integer default 30,p_revisao integer default 30)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select from public.profiles where user_id=p_ator and ativo and role='admin_central') then
    raise exception 'Apenas a Diretoria configura o piloto.' using errcode='42501'; end if;
  perform from public.divulgacao_piloto where id for update;
  if p_aberto and p_participantes<(select count(*) from public.divulgacao_cadastros where estado='ativo') then
    raise exception 'O limite não comporta os participantes ativos.' using errcode='P8601'; end if;
  if p_aberto and p_imoveis<(select count(*) from public.divulgacao_imoveis where aprovado) then raise exception 'O limite não comporta os imóveis do catálogo.' using errcode='P8601'; end if;
  update public.divulgacao_piloto set aberto=p_aberto,participantes_max=p_participantes,imoveis_max=p_imoveis,seguidores_min=p_seguidores,atribuicao_dias=p_atribuicao,revisao_dias=p_revisao where id;
  insert into public.audit_log(user_id,acao,entidade,dados_depois) values(p_ator,'divulgacao_configurada','divulgacao_piloto',
    jsonb_build_object('aberto',p_aberto,'participantes',p_participantes,'imoveis',p_imoveis,'seguidores',p_seguidores));
end $$;

create function public.divulgacao_revisar(p_ator uuid,p_titular uuid,p_estado text,p_seguidores integer,p_motivo text)
returns void language plpgsql security definer set search_path='' as $$
declare piloto public.divulgacao_piloto%rowtype; atual public.divulgacao_cadastros%rowtype;
begin
  if not public.divulgacao_equipe(p_ator) then raise exception 'Acesso restrito à Matriz.' using errcode='42501'; end if;
  select * into strict piloto from public.divulgacao_piloto where id for update;
  select * into strict atual from public.divulgacao_cadastros where titular=p_titular for update;
  if atual.estado=p_estado then
    if p_estado='ativo' and coalesce(length(trim(p_motivo)),0)>=3 and p_seguidores>=0 then
      update public.divulgacao_cadastros set seguidores=p_seguidores,verificado_em=now(),atualizado_em=now(),motivo=trim(p_motivo),
        estado=case when p_seguidores<piloto.seguidores_min then 'suspenso' else 'ativo' end where titular=p_titular;
      insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois) values(p_ator,'divulgacao_requalificada','divulgacao_cadastros',p_titular,
        jsonb_build_object('seguidores',atual.seguidores),jsonb_build_object('seguidores',p_seguidores,'motivo',trim(p_motivo)));
    end if;
    return;
  end if;
  if p_estado='ativo' and atual.estado='analise' then
    if not exists(select from public.profiles where user_id=p_titular and ativo) then raise exception 'Conta inativa.' using errcode='P8601'; end if;
    if not piloto.aberto or piloto.participantes_max <= (select count(*) from public.divulgacao_cadastros where estado='ativo') then
      raise exception 'Piloto fechado ou lotado.' using errcode='P8601'; end if;
    if atual.instagram is null or atual.cnpj is null or p_seguidores is null or p_seguidores<piloto.seguidores_min then
      raise exception 'Confira a conta pública, a documentação fiscal e o mínimo de seguidores.' using errcode='P8601'; end if;
  elsif (p_estado='recusado' and atual.estado='analise') or (p_estado='suspenso' and atual.estado='ativo')
    or (p_estado='espera' and atual.estado in ('suspenso','recusado')) then
    if coalesce(length(trim(p_motivo)),0) not between 3 and 500 then raise exception 'Registre a justificativa.' using errcode='P8601'; end if;
  else raise exception 'Transição indisponível para este cadastro.' using errcode='P8601'; end if;
  update public.divulgacao_cadastros set estado=p_estado,seguidores=case when p_estado='ativo' then p_seguidores else seguidores end,
    verificado_em=case when p_estado='ativo' then now() else verificado_em end,motivo=nullif(trim(p_motivo),''),atualizado_em=now() where titular=p_titular;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois)
  values(p_ator,'divulgacao_revisada','divulgacao_cadastros',p_titular,jsonb_build_object('estado',atual.estado),jsonb_build_object('estado',p_estado,'motivo',p_motivo));
end $$;

create function public.divulgacao_entrar(p_titular uuid) returns void language plpgsql security definer set search_path='' as $$
declare atual public.profiles%rowtype;
begin
  select * into strict atual from public.profiles where user_id=p_titular for update;
  if not atual.ativo or atual.role in ('admin_central','analista_arini','franqueado') or not exists (
    select from public.divulgacao_cadastros c join public.divulgacao_piloto p on p.id where c.titular=p_titular and c.estado='ativo' and p.aberto
  ) then raise exception 'O piloto precisa estar aberto e o cadastro aprovado pela Matriz.' using errcode='P8601'; end if;
  if atual.nicho='divulgador' then return; end if;
  if atual.nicho is not null then
    insert into public.conta_contextos(titular,nicho,papel,plano,origem,validade)
      values(p_titular,atual.nicho,atual.role,atual.plan_id,atual.plan_origem,atual.plan_valido_ate)
      on conflict(titular,nicho) do update set papel=excluded.papel,plano=excluded.plano,origem=excluded.origem,validade=excluded.validade;
  end if;
  update public.profiles set role='consulta',nicho='divulgador',entrada_ativa='divulgador',plan_origem='padrao',plan_id=null,plan_valido_ate=null where user_id=p_titular;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois) values(p_titular,'contexto_selecionado','profiles',p_titular,
    jsonb_build_object('nicho',atual.nicho),jsonb_build_object('nicho','divulgador'));
end $$;

revoke all on function public.divulgacao_situacao(), public.divulgacao_equipe(uuid), public.divulgacao_configurar(uuid,boolean,integer,integer,integer,integer,integer),
 public.divulgacao_inscrever(uuid,text,text,text),public.divulgacao_revisar(uuid,uuid,text,integer,text),public.divulgacao_entrar(uuid) from public,anon,authenticated;
grant execute on function public.divulgacao_situacao(), public.divulgacao_equipe(uuid), public.divulgacao_configurar(uuid,boolean,integer,integer,integer,integer,integer),
 public.divulgacao_inscrever(uuid,text,text,text),public.divulgacao_revisar(uuid,uuid,text,integer,text),public.divulgacao_entrar(uuid) to service_role;

create table public.divulgacao_imoveis (
  imovel uuid primary key references public.properties(id) on delete cascade,
  autorizante uuid not null references public.profiles(user_id) on delete cascade,
  autorizado boolean not null default false,
  autorizacao_em timestamptz not null default now(),
  aprovado boolean not null default false,
  titulo_publico text check (length(titulo_publico) between 3 and 120),
  legenda text check (length(legenda) between 3 and 1500),
  kit_url text check (length(kit_url)<=2000 and kit_url ~ '^https://[^[:space:]]+$'),
  etapas text[] not null default '{}' check (cardinality(etapas)<=12),
  aprovado_por uuid references public.profiles(user_id),
  atualizado_em timestamptz not null default now()
);
create table public.divulgacao_faixas (
  id uuid primary key default gen_random_uuid(),
  seguidores_min integer not null unique check (seguidores_min>=0),
  teto_valor numeric(16,2) not null check(teto_valor>0),
  simultaneos integer not null check(simultaneos between 1 and 100),
  dias integer not null check(dias between 1 and 365)
);
create table public.divulgacao_termos (
  id uuid primary key default gen_random_uuid(), versao text not null unique check(length(versao) between 1 and 100),
  texto text not null check(length(texto) between 20 and 120000), autor uuid not null references public.profiles(user_id),
  vigente boolean not null default true, publicado_em timestamptz not null default now()
);
create unique index divulgacao_termo_vigente on public.divulgacao_termos(vigente) where vigente;
create table public.divulgacao_aceites (
  titular uuid not null references public.divulgacao_cadastros(titular) on delete cascade,
  termo uuid not null references public.divulgacao_termos(id), aceito_em timestamptz not null default now(), primary key(titular,termo)
);
alter table public.divulgacao_termos enable row level security;
alter table public.divulgacao_aceites enable row level security;
revoke all on public.divulgacao_termos,public.divulgacao_aceites from public,anon,authenticated;
grant select on public.divulgacao_termos,public.divulgacao_aceites to service_role;

create function public.divulgacao_termo_publicar(p_ator uuid,p_versao text,p_texto text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select from public.profiles where user_id=p_ator and ativo and role='admin_central') then raise exception 'Somente Diretoria.' using errcode='42501'; end if;
  perform from public.divulgacao_piloto where id for update;
  update public.divulgacao_termos set vigente=false where vigente;
  insert into public.divulgacao_termos(versao,texto,autor) values(trim(p_versao),trim(p_texto),p_ator);
  insert into public.audit_log(user_id,acao,entidade,dados_depois) values(p_ator,'divulgacao_termo_publicado','divulgacao_termos',jsonb_build_object('versao',trim(p_versao)));
end $$;
create function public.divulgacao_aceitar(p_titular uuid,p_termo uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform from public.divulgacao_piloto where id for update;
  if not exists(select from public.divulgacao_termos where id=p_termo and vigente) or not exists(
    select from public.divulgacao_cadastros c join public.profiles u on u.user_id=c.titular
    where c.titular=p_titular and c.estado='ativo' and u.ativo and u.nicho='divulgador'
  ) then raise exception 'Termo ou participante indisponível.' using errcode='P8601'; end if;
  insert into public.divulgacao_aceites(titular,termo) values(p_titular,p_termo) on conflict do nothing;
end $$;
revoke all on function public.divulgacao_termo_publicar(uuid,text,text),public.divulgacao_aceitar(uuid,uuid) from public,anon,authenticated;
grant execute on function public.divulgacao_termo_publicar(uuid,text,text),public.divulgacao_aceitar(uuid,uuid) to service_role;
create table public.divulgacao_reservas (
  id uuid primary key default gen_random_uuid(),
  imovel uuid not null references public.divulgacao_imoveis(imovel) on delete cascade,
  titular uuid not null references public.divulgacao_cadastros(titular) on delete cascade,
  faixa uuid not null references public.divulgacao_faixas(id),
  preco_reserva numeric(16,2) not null, teto_reserva numeric(16,2) not null,
  criada timestamptz not null default now(), vence timestamptz not null,
  encerrada timestamptz, etapas text[] not null
);
create unique index divulgacao_reserva_em_aberto on public.divulgacao_reservas(imovel) where encerrada is null;
create index divulgacao_reserva_titular on public.divulgacao_reservas(titular,vence);
create table public.divulgacao_links (
  id uuid primary key default gen_random_uuid(), reserva uuid not null references public.divulgacao_reservas(id) on delete cascade,
  etapa integer not null check(etapa between 1 and 12), unique(reserva,etapa)
);
create table public.divulgacao_cliques (
  link uuid not null references public.divulgacao_links(id) on delete cascade, visitante uuid not null, criado timestamptz not null default now(),
  vence timestamptz not null, primary key(link,visitante)
);
create table public.divulgacao_atribuicoes (
  oportunidade uuid primary key references public.opportunities(id) on delete cascade,
  link uuid not null references public.divulgacao_links(id) on delete cascade, cliente uuid not null references public.profiles(user_id) on delete cascade,
  imovel uuid not null references public.properties(id) on delete cascade, criado timestamptz not null default now(), unique(imovel,cliente)
);
alter table public.divulgacao_links enable row level security;
alter table public.divulgacao_cliques enable row level security;
alter table public.divulgacao_atribuicoes enable row level security;
revoke all on public.divulgacao_links,public.divulgacao_cliques,public.divulgacao_atribuicoes from public,anon,authenticated;
grant select on public.divulgacao_links to service_role;

create function public.divulgacao_abrir_link(p_link uuid,p_visitante uuid,p_usuario uuid) returns table(codigo text,dias integer,rastreado boolean)
language plpgsql security definer set search_path='' as $$
declare resp record;
begin
  select i.codigo,p.atribuicao_dias,r.titular,r.encerrada is null and r.vence>now() and p.aberto and c.estado='ativo' as atribuir into resp
    from public.divulgacao_links l join public.divulgacao_reservas r on r.id=l.reserva join public.divulgacao_cadastros c on c.titular=r.titular
    join public.divulgacao_imoveis d on d.imovel=r.imovel and d.autorizado and d.aprovado
    join public.properties i on i.id=d.imovel and i.status in ('publicado','em_negociacao') join public.owners o on o.id=i.owner_id and o.profile_id=d.autorizante
    join public.divulgacao_piloto p on p.id where l.id=p_link;
  if not found then return; end if;
  codigo:=resp.codigo;dias:=resp.atribuicao_dias;rastreado:=false;
  if resp.atribuir and p_visitante is not null and p_usuario is distinct from resp.titular then
    insert into public.divulgacao_cliques(link,visitante,vence) values(p_link,p_visitante,now()+make_interval(days=>dias)) on conflict do nothing;
    rastreado:=true;
  end if;
  return next;
end $$;

create function public.divulgacao_atribuir(p_link uuid,p_visitante uuid,p_cliente uuid,p_opp uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into public.divulgacao_atribuicoes(oportunidade,link,cliente,imovel)
    select op.id,l.id,p_cliente,r.imovel from public.opportunities op join public.divulgacao_links l on l.id=p_link
      join public.divulgacao_reservas r on r.id=l.reserva and r.imovel=op.property_id and r.titular<>p_cliente
      join public.divulgacao_cliques cl on cl.link=l.id and cl.visitante=p_visitante and cl.vence>now()
      join auth.users u on u.id=p_cliente and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
     where op.id=p_opp and op.comprador_profile_id=p_cliente and op.created_at>=cl.criado
    on conflict do nothing;
end $$;

create function public.divulgacao_resultados(p_ator uuid) returns table(titular uuid,instagram text,cliques bigint,cadastros bigint,visitas bigint,vendas bigint)
language sql stable security definer set search_path='' as $$
 select c.titular,c.instagram,
 (select count(*) from public.divulgacao_cliques x join public.divulgacao_links l on l.id=x.link join public.divulgacao_reservas r on r.id=l.reserva where r.titular=c.titular),
 count(a.oportunidade),coalesce(sum((select count(*) from public.visits v where v.opportunity_id=a.oportunidade and v.status='realizada')),0)::bigint,
 count(a.oportunidade) filter(where exists(select from public.sales s where s.opportunity_id=a.oportunidade))
 from public.divulgacao_cadastros c left join public.divulgacao_reservas r on r.titular=c.titular left join public.divulgacao_links l on l.reserva=r.id
 left join public.divulgacao_atribuicoes a on a.link=l.id
 where public.divulgacao_equipe(p_ator) or (c.titular=p_ator and c.estado='ativo')
 group by c.titular,c.instagram order by 6 desc,5 desc,4 desc,3 desc,c.titular;
$$;
revoke all on function public.divulgacao_abrir_link(uuid,uuid,uuid),public.divulgacao_atribuir(uuid,uuid,uuid,uuid),public.divulgacao_resultados(uuid) from public,anon,authenticated;
grant execute on function public.divulgacao_abrir_link(uuid,uuid,uuid),public.divulgacao_atribuir(uuid,uuid,uuid,uuid),public.divulgacao_resultados(uuid) to service_role;
create table public.divulgacao_missoes (
  id uuid primary key default gen_random_uuid(),
  reserva uuid not null references public.divulgacao_reservas(id) on delete cascade,
  etapa smallint not null check(etapa between 1 and 12),
  link text not null check(length(link)<=1800 and link ~ '^https://[^[:space:]]+$'),
  estado text not null default 'enviada' check(estado in ('enviada','validada','rejeitada')),
  enviada timestamptz not null default now(), decisao timestamptz, motivo text,
  unique(reserva,etapa)
);
create table public.divulgacao_comprovantes (
  missao uuid primary key references public.divulgacao_missoes(id) on delete cascade,
  imagem bytea not null check(octet_length(imagem) between 1 and 819200),
  mime text not null check(mime in ('image/jpeg','image/png','image/webp'))
);
alter table public.divulgacao_comprovantes enable row level security;
revoke all on public.divulgacao_comprovantes from public,anon,authenticated;
alter table public.divulgacao_imoveis enable row level security;
alter table public.divulgacao_faixas enable row level security;
alter table public.divulgacao_reservas enable row level security;
alter table public.divulgacao_missoes enable row level security;
revoke all on public.divulgacao_imoveis,public.divulgacao_faixas,public.divulgacao_reservas,public.divulgacao_missoes from public,anon,authenticated;
grant select on public.divulgacao_imoveis,public.divulgacao_faixas,public.divulgacao_reservas,public.divulgacao_missoes to service_role;

create function public.divulgacao_autorizar(p_ator uuid,p_imovel uuid,p_autoriza boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select from public.properties p join public.owners o on o.id=p.owner_id join public.profiles u on u.user_id=o.profile_id
    where p.id=p_imovel and u.user_id=p_ator and u.ativo and u.nicho='proprietario') then
    raise exception 'Apenas o proprietário do anúncio pode autorizar.' using errcode='42501'; end if;
  perform from public.divulgacao_piloto where id for update;
  insert into public.divulgacao_imoveis as d(imovel,autorizante,autorizado) values(p_imovel,p_ator,p_autoriza)
   on conflict(imovel) do update set autorizado=excluded.autorizado,autorizante=excluded.autorizante,autorizacao_em=now(),
   aprovado=false,aprovado_por=null,atualizado_em=now() where d.autorizado is distinct from excluded.autorizado or d.autorizante<>excluded.autorizante;
  if not found then return; end if;
  update public.divulgacao_reservas set encerrada=now() where imovel=p_imovel and encerrada is null;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
    values(p_ator,'divulgacao_autorizacao','properties',p_imovel,jsonb_build_object('autoriza',p_autoriza,'versao','piloto-v1'));
end $$;

create function public.divulgacao_faixa(p_ator uuid,p_min integer,p_teto numeric,p_simultaneos integer,p_dias integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select from public.profiles where user_id=p_ator and ativo and role='admin_central') then raise exception 'Acesso restrito à Diretoria.' using errcode='42501'; end if;
  perform from public.divulgacao_piloto where id for update;
  insert into public.divulgacao_faixas(seguidores_min,teto_valor,simultaneos,dias) values(p_min,p_teto,p_simultaneos,p_dias)
   on conflict(seguidores_min) do update set teto_valor=excluded.teto_valor,simultaneos=excluded.simultaneos,dias=excluded.dias;
  insert into public.audit_log(user_id,acao,entidade,dados_depois) values(p_ator,'divulgacao_faixa','divulgacao_faixas',
    jsonb_build_object('seguidores',p_min,'teto',p_teto,'simultaneos',p_simultaneos,'dias',p_dias));
end $$;

create function public.divulgacao_kit(p_ator uuid,p_imovel uuid,p_aprova boolean,p_titulo text,p_legenda text,p_url text,p_etapas text[])
returns void language plpgsql security definer set search_path='' as $$
declare piloto public.divulgacao_piloto%rowtype;
begin
  if not public.divulgacao_equipe(p_ator) then raise exception 'Acesso restrito à Matriz.' using errcode='42501'; end if;
  select * into strict piloto from public.divulgacao_piloto where id for update;
  if p_aprova then
    if not exists(select from public.divulgacao_imoveis d join public.properties i on i.id=d.imovel join public.owners o on o.id=i.owner_id
      where d.imovel=p_imovel and d.autorizado and o.profile_id=d.autorizante and i.status='publicado' and i.valor>0)
      then raise exception 'Confirme publicação, valor e autorização vigente do proprietário.' using errcode='P8601'; end if;
    if piloto.imoveis_max <= (select count(*) from public.divulgacao_imoveis where aprovado and imovel<>p_imovel)
      then raise exception 'O catálogo atingiu o limite do piloto.' using errcode='P8601'; end if;
    if coalesce(cardinality(p_etapas),0) not between 1 and 12 or exists(select from unnest(p_etapas) e where e is null or length(trim(e)) not between 3 and 120)
      or p_titulo is null or p_legenda is null or p_url is null then raise exception 'Informe o material aprovado e as etapas.' using errcode='P8601'; end if;
    update public.divulgacao_imoveis set aprovado=true,titulo_publico=p_titulo,legenda=p_legenda,kit_url=p_url,etapas=p_etapas,
      aprovado_por=p_ator,atualizado_em=now() where imovel=p_imovel;
  else
    update public.divulgacao_imoveis set aprovado=false,aprovado_por=null,atualizado_em=now() where imovel=p_imovel;
    update public.divulgacao_reservas set encerrada=now() where imovel=p_imovel and encerrada is null;
  end if;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
    values(p_ator,'divulgacao_kit','properties',p_imovel,jsonb_build_object('aprovado',p_aprova));
end $$;

create function public.divulgacao_catalogo(p_titular uuid) returns table(imovel uuid,chamada text,valor numeric,codigo text)
language sql stable security definer set search_path='' as $$
 select d.imovel,d.titulo_publico,i.valor,i.codigo from public.divulgacao_cadastros c
 join public.profiles u on u.user_id=c.titular and u.nicho='divulgador' and u.ativo
 join public.divulgacao_piloto p on p.id and p.aberto
 join lateral(select f.teto_valor from public.divulgacao_faixas f where f.seguidores_min<=c.seguidores order by f.seguidores_min desc limit 1) faixa on true
 join public.divulgacao_imoveis d on d.autorizado and d.aprovado
 join public.properties i on i.id=d.imovel and i.status='publicado' and i.valor>0 and i.valor<=faixa.teto_valor
 join public.owners o on o.id=i.owner_id and o.profile_id=d.autorizante
 where c.titular=p_titular and c.estado='ativo'
 and not exists(select from public.divulgacao_reservas r where r.imovel=i.id and r.encerrada is null and r.vence>now() and r.titular<>p_titular)
 and (exists(select from public.divulgacao_reservas r where r.titular=p_titular and r.imovel=i.id and r.encerrada is null and r.vence>now()) or
 not exists(select from public.opportunities op where op.property_id=i.id and op.etapa not in ('perdido','fechado','pos_venda') and
   (exists(select from public.visits v where v.opportunity_id=op.id and v.status in ('agendada','remarcada')) or
    exists(select from public.proposals prop where prop.opportunity_id=op.id and prop.status in ('enviada','aceita','contraproposta')))))
 order by d.atualizado_em desc,d.imovel;
$$;

create function public.divulgacao_reservar(p_titular uuid,p_imovel uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare f public.divulgacao_faixas%rowtype; ja uuid; preco numeric;
begin
  perform from public.divulgacao_piloto where id for update;
  if not exists(select from public.divulgacao_aceites a join public.divulgacao_termos t on t.id=a.termo and t.vigente where a.titular=p_titular)
    then raise exception 'Aceite o termo vigente de participação antes de reservar.' using errcode='P8601'; end if;
  select c.valor into preco from public.divulgacao_catalogo(p_titular) c where c.imovel=p_imovel;
  if not found then raise exception 'Imóvel indisponível para este participante.' using errcode='P8601'; end if;
  update public.divulgacao_reservas set encerrada=vence where imovel=p_imovel and encerrada is null and vence<=now();
  select id into ja from public.divulgacao_reservas where titular=p_titular and imovel=p_imovel and encerrada is null and vence>now();
  if found then return ja; end if;
  select fx.* into strict f from public.divulgacao_faixas fx join public.divulgacao_cadastros c on c.titular=p_titular
    where fx.seguidores_min<=c.seguidores order by fx.seguidores_min desc limit 1;
  if f.simultaneos<=(select count(*) from public.divulgacao_reservas where titular=p_titular and encerrada is null and vence>now())
    then raise exception 'Você atingiu o limite simultâneo da sua faixa.' using errcode='P8601'; end if;
  insert into public.divulgacao_reservas(imovel,titular,faixa,preco_reserva,teto_reserva,vence,etapas)
    select p_imovel,p_titular,f.id,preco,f.teto_valor,now()+make_interval(days=>f.dias),d.etapas from public.divulgacao_imoveis d where d.imovel=p_imovel returning id into ja;
  insert into public.divulgacao_links(reserva,etapa) select ja,generate_subscripts(r.etapas,1) from public.divulgacao_reservas r where r.id=ja;
  insert into public.audit_log(user_id,acao,entidade,entidade_id) values(p_titular,'divulgacao_reservada','divulgacao_reservas',ja);
  return ja;
end $$;

create function public.divulgacao_entregar(p_titular uuid,p_reserva uuid,p_etapa smallint,p_link text,p_captura text,p_mime text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.divulgacao_reservas%rowtype; missao uuid;
begin
  perform from public.divulgacao_piloto where id for update;
  select * into r from public.divulgacao_reservas where id=p_reserva and titular=p_titular and encerrada is null and vence>now() for update;
  if not found or not exists(select from public.divulgacao_catalogo(p_titular) c where c.imovel=r.imovel)
   then raise exception 'Reserva indisponível.' using errcode='P8601'; end if;
  if p_etapa is null or p_etapa not between 1 and cardinality(r.etapas) or
    (p_etapa>1 and not exists(select from public.divulgacao_missoes where reserva=r.id and etapa=p_etapa-1 and estado='validada'))
    then raise exception 'A etapa anterior ainda não foi validada.' using errcode='P8601'; end if;
  insert into public.divulgacao_missoes as m(reserva,etapa,link) values(r.id,p_etapa,p_link)
  on conflict(reserva,etapa) do update set link=excluded.link,enviada=now(),estado='enviada',motivo=null,decisao=null where m.estado='rejeitada' returning m.id into missao;
  if found then
    insert into public.divulgacao_comprovantes as c(missao,imagem,mime) values(missao,decode(p_captura,'base64'),p_mime)
      on conflict on constraint divulgacao_comprovantes_pkey do update set imagem=excluded.imagem,mime=excluded.mime;
    insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_titular,'divulgacao_missao_enviada','divulgacao_reservas',r.id,jsonb_build_object('etapa',p_etapa));
  end if;
end $$;

create function public.divulgacao_comprovante(p_ator uuid,p_missao uuid) returns table(imagem text,mime text) language plpgsql security definer set search_path='' as $$
begin
  if not public.divulgacao_equipe(p_ator) then return; end if;
  insert into public.audit_log(user_id,acao,entidade,entidade_id)
    select p_ator,'divulgacao_comprovante_aberto','divulgacao_missoes',p_missao from public.divulgacao_comprovantes c where c.missao=p_missao;
  return query select encode(c.imagem,'base64'),c.mime from public.divulgacao_comprovantes c where c.missao=p_missao;
end $$;
revoke all on function public.divulgacao_comprovante(uuid,uuid) from public,anon,authenticated;
grant execute on function public.divulgacao_comprovante(uuid,uuid) to service_role;

create function public.divulgacao_validar(p_ator uuid,p_missao uuid,p_valida boolean,p_motivo text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.divulgacao_equipe(p_ator) then raise exception 'Acesso restrito à Matriz.' using errcode='42501'; end if;
  if not p_valida and coalesce(length(trim(p_motivo)),0) not between 3 and 500 then raise exception 'Informe o motivo da rejeição.' using errcode='P8601'; end if;
  update public.divulgacao_missoes set estado=case when p_valida then 'validada' else 'rejeitada' end,decisao=now(),motivo=left(trim(p_motivo),500)
    where id=p_missao and estado='enviada';
  if not found then raise exception 'Missão já analisada ou inexistente.' using errcode='P8601'; end if;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois)
    values(p_ator,'divulgacao_missao_revisada','divulgacao_missoes',p_missao,jsonb_build_object('validada',p_valida,'motivo',p_motivo));
end $$;

revoke all on function public.divulgacao_autorizar(uuid,uuid,boolean),public.divulgacao_faixa(uuid,integer,numeric,integer,integer),
 public.divulgacao_kit(uuid,uuid,boolean,text,text,text,text[]),public.divulgacao_catalogo(uuid),public.divulgacao_reservar(uuid,uuid),
 public.divulgacao_entregar(uuid,uuid,smallint,text,text,text),public.divulgacao_validar(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.divulgacao_autorizar(uuid,uuid,boolean),public.divulgacao_faixa(uuid,integer,numeric,integer,integer),
 public.divulgacao_kit(uuid,uuid,boolean,text,text,text,text[]),public.divulgacao_catalogo(uuid),public.divulgacao_reservar(uuid,uuid),
 public.divulgacao_entregar(uuid,uuid,smallint,text,text,text),public.divulgacao_validar(uuid,uuid,boolean,text) to service_role;
-- Avisar quem pediu a abertura, inclusive quando uma suspensão libera a última vaga.
create function public.divulgacao_avisar_fila() returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce((public.divulgacao_situacao()->>'tem_vaga')::boolean,false) then
    insert into public.notificacoes(user_id,nivel,titulo,texto,link,chave)
    select c.titular,'info','Inscrições abertas para divulgadores','Envie o seu perfil público e os dados da empresa ou MEI para análise.',
      '/divulgador','divulgacao_abertura_'||c.criado_em::text from public.divulgacao_cadastros c where c.estado='espera'
    on conflict(user_id,chave) where chave is not null do nothing;
  end if;
end $$;
create function public.divulgacao_avisos_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='divulgacao_piloto' then
    if new.aberto and (not old.aberto or new.participantes_max>old.participantes_max) then perform public.divulgacao_avisar_fila(); end if;
  else
    if new.estado<>old.estado and new.estado in ('ativo','recusado','suspenso') and exists(select from public.profiles where user_id=new.titular and ativo) then
      insert into public.notificacoes(user_id,nivel,titulo,texto,link)
      values(new.titular,'info','Atualização no programa de divulgadores','Consulte a decisão da Matriz no seu painel.','/divulgador');
    end if;
    if old.estado='ativo' and new.estado<>'ativo' then
      update public.divulgacao_reservas set encerrada=now() where titular=new.titular and encerrada is null;
      perform public.divulgacao_avisar_fila();
    end if;
  end if;
  return new;
end $$;
revoke all on function public.divulgacao_avisar_fila(),public.divulgacao_avisos_trigger() from public,anon,authenticated;
create trigger trg_divulgacao_abertura after update on public.divulgacao_piloto for each row execute function public.divulgacao_avisos_trigger();
create trigger trg_divulgacao_decisao after update of estado on public.divulgacao_cadastros for each row execute function public.divulgacao_avisos_trigger();

create function public.divulgacao_preco_trigger() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.divulgacao_reservas%rowtype;
begin
  for r in update public.divulgacao_reservas set encerrada=now() where imovel=new.id and encerrada is null
    and (new.valor is null or new.valor<=0 or new.valor>teto_reserva) returning * loop
    insert into public.audit_log(acao,entidade,entidade_id,dados_antes,dados_depois) values('divulgacao_preco_fora_da_faixa','divulgacao_reservas',r.id,
      jsonb_build_object('preco',old.valor,'teto',r.teto_reserva),jsonb_build_object('preco',new.valor));
    insert into public.notificacoes(user_id,nivel,titulo,texto,link)
      values(r.titular,'info','Reserva encerrada','O novo valor do imóvel saiu da faixa de divulgação.','/divulgador');
    insert into public.notificacoes(user_id,nivel,titulo,texto,link)
      select u.user_id,'info','Revisar faixa de divulgação',new.codigo||' ultrapassou o teto da reserva.','/admin/marketing/divulgadores'
      from public.profiles u where u.ativo and (u.role='admin_central' or (u.role='analista_arini' and 'marketing'=any(u.setores)));
  end loop;
  return new;
end $$;
revoke all on function public.divulgacao_preco_trigger() from public,anon,authenticated;
create trigger trg_divulgacao_preco after update of valor on public.properties for each row when(old.valor is distinct from new.valor) execute function public.divulgacao_preco_trigger();

create function public.divulgacao_desativar_conta() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.divulgacao_cadastros set estado='suspenso',instagram=null,cnpj=null,regiao=null,seguidores=null,verificado_em=null,motivo=null,atualizado_em=now()
    where titular=new.user_id;
  return new;
end $$;
revoke all on function public.divulgacao_desativar_conta() from public,anon,authenticated;
create trigger trg_divulgacao_conta_encerrada after update of ativo on public.profiles for each row when(old.ativo and not new.ativo) execute function public.divulgacao_desativar_conta();

create function public.divulgacao_rotinas() returns integer language plpgsql security definer set search_path='' as $$
declare total integer; cfg public.divulgacao_piloto%rowtype;
begin
  select * into strict cfg from public.divulgacao_piloto where id;
  if not cfg.aberto then return 0; end if;
  with eventos(chave,regra,setor,titulo,descricao,imovel,oportunidade) as (
    select 'kit:'||d.imovel||':'||d.autorizacao_em,'kit_pendente','marketing','Preparar kit de divulgação','Conferir autorização e materiais antes de liberar o imóvel.',d.imovel,null::uuid
    from public.divulgacao_imoveis d where d.autorizado and not d.aprovado
    union all
    select 'vencendo:'||r.id,'reserva_vencendo','marketing','Reserva de divulgação próxima do fim','Conferir entregas e orientar o divulgador antes do vencimento.',r.imovel,null::uuid
    from public.divulgacao_reservas r where r.encerrada is null and r.vence>now() and r.vence<=now()+interval '1 day'
    union all
    select 'atrasada:'||r.id,'missao_atrasada','marketing','Revisar missões vencidas','Verificar o que ficou pendente na reserva e registrar o encaminhamento.',r.imovel,null::uuid
    from public.divulgacao_reservas r where (r.encerrada is null or r.encerrada=r.vence) and r.vence<=now() and cardinality(r.etapas)>
      (select count(*) from public.divulgacao_missoes m where m.reserva=r.id and m.estado='validada')
    union all
    select 'qualificacao:'||c.titular||':'||c.verificado_em,'reavaliar_seguidores','marketing','Reavaliar perfil de divulgação','Conferir novamente o perfil @'||c.instagram||' e atualizar os seguidores e a justificativa.',null::uuid,null::uuid
    from public.divulgacao_cadastros c where c.estado='ativo' and c.verificado_em<now()-make_interval(days=>cfg.revisao_dias)
    union all
    select 'venda:'||a.oportunidade,'conferir_publicidade','financeiro','Conferir publicidade na venda atribuída','Verificar contrato, entregas, participação e documentos fiscais antes de aprovar qualquer pagamento.',a.imovel,a.oportunidade
    from public.divulgacao_atribuicoes a join public.sales s on s.opportunity_id=a.oportunidade
  ) select count(*) into total from eventos e where public.fn_tarefa_automatica('divulgacao:'||e.chave,e.regra,e.setor,e.titulo,e.descricao,null,current_date,'normal',e.imovel,e.oportunidade) is not null;
  update public.divulgacao_reservas set encerrada=vence where encerrada is null and vence<=now();
  return total;
end $$;
revoke all on function public.divulgacao_rotinas() from public,anon,authenticated;
grant execute on function public.divulgacao_rotinas() to service_role;
