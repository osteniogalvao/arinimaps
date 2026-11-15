-- Balcão digital de cada município e produção das áreas de cada empresa.
-- As organizações são habilitadas em org_modulos_contratados (0097).
create table public.balcao_regras (
  id uuid primary key default gen_random_uuid(),
  org uuid not null references public.organizations(id),
  nome text not null check(length(trim(nome)) between 3 and 100),
  orientacao text not null check(length(trim(orientacao)) between 5 and 2500),
  requisitos text[] not null check(cardinality(requisitos) between 1 and 12),
  versao integer not null check(versao>0), ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  unique(org,id)
);
create unique index balcao_regra_vigente on public.balcao_regras(org,lower(nome)) where ativa;
create table public.balcao_protocolos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  org uuid not null references public.organizations(id),
  regra uuid not null, titular uuid not null references public.profiles(user_id),
  chave uuid not null, dados jsonb not null,
  estado text not null default 'protocolado' check(estado in ('protocolado','em_analise','pendencia','deferido','indeferido')),
  revisao integer not null default 1, criado_em timestamptz not null default now(),
  foreign key(org,regra) references public.balcao_regras(org,id), unique(titular,chave)
);
create index balcao_protocolos_org on public.balcao_protocolos(org,criado_em desc);
create index balcao_protocolos_titular on public.balcao_protocolos(titular,criado_em desc);
create table public.balcao_andamentos (
  id bigint generated always as identity primary key, protocolo uuid not null references public.balcao_protocolos(id),
  ator uuid not null references public.profiles(user_id), acao text not null, texto text not null, criado_em timestamptz not null default now()
);
create index balcao_andamentos_protocolo on public.balcao_andamentos(protocolo,id);

create table public.safra_fornecedores (
  id uuid primary key,org uuid not null references public.organizations(id),
  nome text not null check(length(trim(nome)) between 2 and 140),unique(org,id)
);
create table public.safra_areas (
  id uuid primary key,org uuid not null,fornecedor uuid not null,nome text not null check(length(trim(nome)) between 2 and 140),
  hectares numeric(14,4) not null check(hectares>0 and hectares<'NaN'::numeric), unique(org,id),foreign key(org,fornecedor) references public.safra_fornecedores(org,id)
);
create table public.safra_talhoes (
  id uuid primary key,org uuid not null,area uuid not null,nome text not null check(length(trim(nome)) between 1 and 140),
  hectares numeric(14,4) not null check(hectares>0 and hectares<'NaN'::numeric),unique(org,id), foreign key(org,area) references public.safra_areas(org,id)
);
create table public.safra_resultados (
  id uuid primary key,org uuid not null,talhao uuid not null,ano integer not null check(ano between 1900 and 2200),
  cultura text not null check(length(trim(cultura)) between 2 and 100),toneladas numeric(14,3) not null check(toneladas>=0 and toneladas<'NaN'::numeric),
  custo numeric(16,2) not null check(custo>=0 and custo<'NaN'::numeric),receita numeric(16,2) not null check(receita>=0 and receita<'NaN'::numeric),
  revisao integer not null default 1,unique(talhao,ano,cultura),foreign key(org,talhao) references public.safra_talhoes(org,id)
);

alter table public.balcao_regras enable row level security;
alter table public.balcao_protocolos enable row level security;
alter table public.balcao_andamentos enable row level security;
alter table public.safra_fornecedores enable row level security;
alter table public.safra_areas enable row level security;
alter table public.safra_talhoes enable row level security;
alter table public.safra_resultados enable row level security;
revoke all on public.balcao_regras,public.balcao_protocolos,public.balcao_andamentos,public.safra_fornecedores,public.safra_areas,
  public.safra_talhoes,public.safra_resultados from public,anon,authenticated,service_role;

create function public.fn_balcao_vigente(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organizations o join public.plans pl on pl.id=o.plan_id and pl.ativo and pl.escopo='organizacao'
    join public.org_modulos_contratados c on c.org_id=o.id and c.modulo='balcao' and c.ativo
    where o.id=p_org and o.tipo='ente_publico' and o.ativo and (o.plan_valido_ate is null or o.plan_valido_ate>now()))
$$;
-- Tela pública de abertura: somente regras divulgadas pelo município contratado.
create function public.fn_balcao_servicos(p_gestor uuid default null) returns table(id uuid,nome text,municipio text,territorio text,orientacao text,requisitos text[],versao integer)
language sql stable security definer set search_path='' as $$
  select r.id,r.nome,o.nome,c.territorio,r.orientacao,r.requisitos,r.versao
  from public.balcao_regras r join public.organizations o on o.id=r.org and o.ativo
    join public.org_modulos_contratados c on c.org_id=r.org and c.modulo='balcao' and c.ativo
  where r.ativa and public.fn_balcao_vigente(r.org)
    and (p_gestor is null or r.org=public.org_modulo_atual(p_gestor,'balcao')) order by o.nome,r.nome
$$;
create function public.fn_balcao_regra(p_titular uuid,p_nome text,p_orientacao text,p_requisitos text[],p_anterior uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare org_ativa uuid:=public.org_modulo_atual(p_titular,'balcao'); anterior public.balcao_regras; nova uuid;
begin
  if org_ativa is null or not exists(select 1 from public.organization_members where org_id=org_ativa and user_id=p_titular and status='ativo' and papel_org='admin')
    then raise exception using errcode='42501',message='Administração municipal necessária.'; end if;
  if p_requisitos is null or exists(select from unnest(p_requisitos) r where length(trim(r)) not between 2 and 140 or r is null)
    or cardinality(p_requisitos)<>(select count(distinct r) from unnest(p_requisitos) r) then
    raise exception using errcode='22023',message='Informe requisitos distintos.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(org_ativa::text||lower(trim(p_nome)),98));
  select * into anterior from public.balcao_regras where org=org_ativa and lower(nome)=lower(trim(p_nome)) and ativa for update;
  if p_anterior is distinct from anterior.id then raise exception using errcode='40001',message='O serviço foi alterado. Recarregue.';end if;
  if anterior.id is not null then update public.balcao_regras set ativa=false where id=anterior.id;end if;
  insert into public.balcao_regras(org,nome,orientacao,requisitos,versao)
    values(org_ativa,trim(p_nome),trim(p_orientacao),p_requisitos,coalesce(anterior.versao,0)+1) returning id into nova;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_titular,'regra_municipal_publicada','balcao_regras',nova,jsonb_build_object('org',org_ativa,'revisao',coalesce(anterior.versao,0)+1));
  return nova;
end $$;

create function public.fn_balcao_abrir(p_titular uuid,p_chave uuid,p_regra uuid,p_dados jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare r public.balcao_regras; anterior public.balcao_protocolos; novo public.balcao_protocolos;
begin
  if not exists(select from public.profiles where user_id=p_titular and ativo) then raise exception using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_titular::text||p_chave::text,98));
  select * into anterior from public.balcao_protocolos where titular=p_titular and chave=p_chave;
  if found then
    if anterior.regra<>p_regra or anterior.dados<>p_dados then raise exception using errcode='40001'; end if;
    return anterior.numero;
  end if;
  select regra.* into strict r from public.balcao_regras regra join public.organizations o on o.id=regra.org and o.ativo
    join public.org_modulos_contratados c on c.org_id=regra.org and c.modulo='balcao' and c.ativo
    where regra.id=p_regra and regra.ativa and public.fn_balcao_vigente(regra.org) for share;
  if p_dados is null or jsonb_typeof(p_dados)<>'object' or octet_length(p_dados::text)>120000 then raise exception using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(p_dados))<>cardinality(r.requisitos) or
    exists(select from unnest(r.requisitos) req where not(p_dados ? req) or jsonb_typeof(p_dados->req)<>'string' or length(trim(p_dados->>req)) not between 1 and 2000) then
    raise exception using errcode='22023',message='Preencha todos os requisitos vigentes.';
  end if;
  insert into public.balcao_protocolos(org,regra,titular,chave,dados) values(r.org,r.id,p_titular,p_chave,p_dados) returning * into novo;
  insert into public.balcao_andamentos(protocolo,ator,acao,texto) values(novo.id,p_titular,'protocolado','Pedido recebido.');
  return novo.numero;
end $$;

create function public.fn_balcao_andar(p_titular uuid,p_id uuid,p_revisao integer,p_acao text,p_texto text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.balcao_protocolos; destino text; org_ativa uuid;
begin
  if not exists(select from public.profiles where user_id=p_titular and ativo) then raise exception using errcode='42501';end if;
  select * into strict p from public.balcao_protocolos where id=p_id for update;
  if p_acao='resposta' then
    if p.titular<>p_titular or not public.fn_balcao_vigente(p.org) then raise exception using errcode='42501';end if;
    if p.estado<>'pendencia' then raise exception using errcode='40001';end if;
    destino:='em_analise';
  else
    org_ativa:=public.org_modulo_atual(p_titular,'balcao');
    if org_ativa is distinct from p.org or p.titular=p_titular then raise exception using errcode='42501';end if;
    if p_acao in ('deferido','indeferido') and not exists(select from public.organization_members
      where org_id=p.org and user_id=p_titular and status='ativo' and papel_org='admin') then raise exception using errcode='42501';end if;
    if p_acao not in ('em_analise','pendencia','deferido','indeferido') or
      p.estado not in ('protocolado','em_analise') or p_acao=p.estado then raise exception using errcode='40001';end if;
    destino:=p_acao;
  end if;
  if p.revisao<>p_revisao then raise exception using errcode='40001';end if;
  if p_texto is null or length(trim(p_texto)) not between 1 and 2000 then raise exception using errcode='22023';end if;
  update public.balcao_protocolos set estado=destino,revisao=revisao+1 where id=p.id;
  insert into public.balcao_andamentos(protocolo,ator,acao,texto) values(p.id,p_titular,p_acao,trim(p_texto));
end $$;

-- Leituras do balcão usam o mesmo limite na seleção de documentos e de andamentos.
create function public.fn_balcao_pedidos(p_titular uuid,p_interno boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'estado',p.estado,'revisao',p.revisao,
    'proprio',p.titular=p_titular,'servico',r.nome,'versao',r.versao,'municipio',o.nome,'data',p.criado_em,'dados',p.dados,
    'andamentos',(select jsonb_agg(jsonb_build_object('acao',a.acao,'texto',a.texto,'data',a.criado_em) order by a.id)
      from public.balcao_andamentos a where a.protocolo=p.id)) order by p.numero desc),'[]'::jsonb)
  from (select b.* from public.balcao_protocolos b where exists(select from public.profiles where user_id=p_titular and ativo)
    and (case when p_interno then b.org=public.org_modulo_atual(p_titular,'balcao') else b.titular=p_titular end)
    order by b.numero desc limit 150) p join public.balcao_regras r on r.id=p.regra join public.organizations o on o.id=p.org
$$;

create function public.fn_safra_lancar(p_titular uuid,p_tipo text,p_id uuid,p_campos jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare org_ativa uuid:=public.org_modulo_atual(p_titular,'safras'); nome text:=trim(p_campos->>'nome'); area public.safra_areas;
  antes jsonb; depois jsonb; h numeric; revisao int:=coalesce((p_campos->>'revisao')::integer,0);
begin
  if org_ativa is null then raise exception using errcode='42501';end if;
  case p_tipo
    when 'fornecedor' then
      insert into public.safra_fornecedores(id,org,nome) values(p_id,org_ativa,nome) returning to_jsonb(safra_fornecedores) into depois;
    when 'area' then
      insert into public.safra_areas(id,org,fornecedor,nome,hectares) values(p_id,org_ativa,(p_campos->>'fornecedor')::uuid,nome,(p_campos->>'hectares')::numeric)
        returning to_jsonb(safra_areas) into depois;
    when 'talhao' then
      select * into strict area from public.safra_areas where org=org_ativa and id=(p_campos->>'area')::uuid for update;
      h:=round((p_campos->>'hectares')::numeric,4);
      if h+(select coalesce(sum(hectares),0) from public.safra_talhoes where org=org_ativa and safra_talhoes.area=area.id)>area.hectares then
        raise exception using errcode='P9801',message='Os talhões ultrapassam a área cadastrada.';
      end if;
      insert into public.safra_talhoes(id,org,area,nome,hectares) values(p_id,org_ativa,area.id,nome,h) returning to_jsonb(safra_talhoes) into depois;
    when 'safra' then
      if revisao=0 then
        insert into public.safra_resultados(id,org,talhao,ano,cultura,toneladas,custo,receita) values(
          p_id,org_ativa,(p_campos->>'talhao')::uuid,(p_campos->>'ano')::integer,trim(p_campos->>'cultura'),(p_campos->>'toneladas')::numeric,
          (p_campos->>'custo')::numeric,(p_campos->>'receita')::numeric) returning to_jsonb(safra_resultados) into depois;
      else
        select to_jsonb(r) into strict antes from public.safra_resultados r where org=org_ativa and id=p_id for update;
        update public.safra_resultados set toneladas=(p_campos->>'toneladas')::numeric,custo=(p_campos->>'custo')::numeric,
          receita=(p_campos->>'receita')::numeric,revisao=safra_resultados.revisao+1 where org=org_ativa and id=p_id
          and safra_resultados.revisao=(p_campos->>'revisao')::integer returning to_jsonb(safra_resultados) into depois;
        if not found then raise exception using errcode='40001';end if;
      end if;
    else raise exception using errcode='22023';
  end case;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois)
    values(p_titular,'registro_safra',p_tipo,p_id,antes,depois);
  return p_id;
end $$;

create function public.fn_safra_painel(p_titular uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org_ativa uuid:=public.org_modulo_atual(p_titular,'safras');
begin
  if org_ativa is null then raise exception using errcode='42501';end if;
  return jsonb_build_object(
    'fornecedores',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'nome',f.nome) order by f.nome) from public.safra_fornecedores f where f.org=org_ativa),'[]'::jsonb),
    'areas',coalesce((select jsonb_agg(to_jsonb(a) order by a.nome) from (
      select ar.id,ar.nome,ar.hectares,ar.fornecedor,count(distinct s.ano) safras,
        case when count(distinct s.ano)>=2 then sum(s.receita-s.custo) end resultado
      from public.safra_areas ar left join public.safra_talhoes t on t.area=ar.id and t.org=org_ativa
        left join public.safra_resultados s on s.talhao=t.id and s.org=org_ativa
      where ar.org=org_ativa group by ar.id) a),'[]'::jsonb),
    'talhoes',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'nome',t.nome,'area',t.area,'hectares',t.hectares) order by t.nome)
      from public.safra_talhoes t where t.org=org_ativa),'[]'::jsonb),
    'safras',coalesce((select jsonb_agg((to_jsonb(s)-'org')||jsonb_build_object('produtividade',round(s.toneladas/t.hectares,3)) order by s.ano desc,s.cultura)
      from public.safra_resultados s join public.safra_talhoes t on t.org=s.org and t.id=s.talhao where s.org=org_ativa),'[]'::jsonb));
end $$;

revoke all on function public.fn_balcao_vigente(uuid),public.fn_balcao_servicos(uuid),public.fn_balcao_regra(uuid,text,text,text[],uuid),
  public.fn_balcao_abrir(uuid,uuid,uuid,jsonb),public.fn_balcao_andar(uuid,uuid,integer,text,text),public.fn_balcao_pedidos(uuid,boolean),
  public.fn_safra_lancar(uuid,text,uuid,jsonb),public.fn_safra_painel(uuid) from public,anon,authenticated;
grant execute on function public.fn_balcao_servicos(uuid),public.fn_balcao_regra(uuid,text,text,text[],uuid),
  public.fn_balcao_abrir(uuid,uuid,uuid,jsonb),public.fn_balcao_andar(uuid,uuid,integer,text,text),public.fn_balcao_pedidos(uuid,boolean),
  public.fn_safra_lancar(uuid,text,uuid,jsonb),public.fn_safra_painel(uuid) to service_role;
