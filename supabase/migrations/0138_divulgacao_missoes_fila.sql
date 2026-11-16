-- Regras opcionais do piloto. A reserva guarda a meta e o prazo vigentes ao entrar.
alter table public.divulgacao_piloto add column fila_max integer not null default 0 check(fila_max between 0 and 1000),
  add column chamada_horas integer check(chamada_horas between 1 and 168);
alter table public.divulgacao_imoveis add column min_faixa uuid references public.divulgacao_faixas(id),
  add column regiao_exigida text check(length(regiao_exigida) between 2 and 100),
  add column campanha uuid unique references public.campanhas(id) on delete set null;
alter table public.divulgacao_faixas add column progressao boolean not null default false,
  add column min_missoes integer not null default 0 check(min_missoes>=0),
  add column min_cliques integer not null default 0 check(min_cliques>=0),
  add column min_cadastros integer not null default 0 check(min_cadastros>=0),
  add column min_visitas integer not null default 0 check(min_visitas>=0),
  add constraint divulgacao_progressao_com_criterio check(not progressao or greatest(min_missoes,min_cliques,min_cadastros,min_visitas)>0);
alter table public.divulgacao_cadastros add column faixa_manual uuid references public.divulgacao_faixas(id);
create table public.divulgacao_metas(
  imovel uuid not null references public.divulgacao_imoveis(imovel) on delete cascade, etapa integer not null check(etapa between 1 and 12),
  quantidade integer not null check(quantidade between 1 and 100), dias integer not null check(dias between 1 and 365), primary key(imovel,etapa)
);
create table public.divulgacao_metas_reserva(
  reserva uuid not null references public.divulgacao_reservas(id) on delete cascade, etapa integer not null,
  quantidade integer not null, prazo timestamptz not null, validadas integer not null default 0, primary key(reserva,etapa)
);
create table public.divulgacao_publicacoes_validadas(
  id uuid primary key default gen_random_uuid(),reserva uuid not null references public.divulgacao_reservas(id) on delete cascade,
  etapa integer not null,link text not null,validada_em timestamptz not null,operador uuid references public.profiles(user_id),
  imagem bytea,mime text,unique(reserva,link)
);
create table public.divulgacao_fila(
  ordem bigint generated always as identity primary key,imovel uuid not null references public.divulgacao_imoveis(imovel) on delete cascade,
  titular uuid not null references public.divulgacao_cadastros(titular) on delete cascade,inscrito timestamptz not null default now(),limite timestamptz,saiu timestamptz
);
create unique index divulgacao_fila_uma_posicao on public.divulgacao_fila(imovel,titular) where saiu is null;
create index divulgacao_fila_vez on public.divulgacao_fila(imovel,ordem) where saiu is null;
alter table public.divulgacao_metas enable row level security;
alter table public.divulgacao_metas_reserva enable row level security;
alter table public.divulgacao_publicacoes_validadas enable row level security;
alter table public.divulgacao_fila enable row level security;
revoke all on public.divulgacao_metas,public.divulgacao_metas_reserva,public.divulgacao_publicacoes_validadas,public.divulgacao_fila from public,anon,authenticated;
grant select on public.divulgacao_metas,public.divulgacao_metas_reserva to service_role;

create function public.divulgacao_diretor(p_ator uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select from public.profiles where user_id=p_ator and ativo and role='admin_central');
$$;
create function public.divulgacao_parametros_fila(p_ator uuid,p_max integer,p_horas integer) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.divulgacao_diretor(p_ator) then raise exception 'Apenas Diretoria.' using errcode='42501';end if;
  if p_max>0 and p_horas is null then raise exception 'Defina a validade da convocação.' using errcode='P8601';end if;
  update public.divulgacao_piloto set fila_max=p_max,chamada_horas=p_horas where id;
  if p_max=0 then update public.divulgacao_fila set saiu=now() where saiu is null; end if;
  insert into public.audit_log(user_id,acao,entidade,dados_depois) values(p_ator,'divulgacao_fila_configurada','divulgacao_piloto',jsonb_build_object('max',p_max,'horas',p_horas));
end $$;
create function public.divulgacao_progressao(p_ator uuid,p_faixa uuid,p_ativa boolean,p_missoes integer,p_cliques integer,p_cadastros integer,p_visitas integer) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.divulgacao_diretor(p_ator) then raise exception 'Apenas Diretoria.' using errcode='42501';end if;
  perform from public.divulgacao_piloto where id for update;
  update public.divulgacao_faixas set progressao=p_ativa,min_missoes=p_missoes,min_cliques=p_cliques,min_cadastros=p_cadastros,min_visitas=p_visitas where id=p_faixa;
  if not found then raise exception 'Faixa inexistente.' using errcode='P8601';end if;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_ator,'divulgacao_progressao','divulgacao_faixas',p_faixa,jsonb_build_object('ativa',p_ativa,'missoes',p_missoes,'cliques',p_cliques,'cadastros',p_cadastros,'visitas',p_visitas));
end $$;
create function public.divulgacao_fixar_faixa(p_ator uuid,p_titular uuid,p_faixa uuid,p_motivo text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.divulgacao_equipe(p_ator) then raise exception 'Apenas a Matriz.' using errcode='42501';end if;
  if coalesce(length(trim(p_motivo)),0) not between 3 and 500 then raise exception 'Justifique a alteração.' using errcode='P8601';end if;
  perform from public.divulgacao_piloto where id for update;
  update public.divulgacao_cadastros set faixa_manual=p_faixa where titular=p_titular and estado='ativo';
  if not found then raise exception 'Cadastro indisponível.' using errcode='P8601';end if;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_ator,'divulgacao_faixa_manual','divulgacao_cadastros',p_titular,jsonb_build_object('faixa',p_faixa,'motivo',p_motivo));
end $$;
create function public.divulgacao_faixa_titular(p_titular uuid) returns setof public.divulgacao_faixas language plpgsql stable security definer set search_path='' as $$
declare c public.divulgacao_cadastros%rowtype; feitos bigint; cliques bigint; cadastros bigint; visitas bigint;
begin
  select * into c from public.divulgacao_cadastros where titular=p_titular and estado='ativo';
  if not found then return;end if;
  if c.faixa_manual is not null then return query select f.* from public.divulgacao_faixas f where f.id=c.faixa_manual;return;end if;
  if exists(select from public.divulgacao_faixas where progressao and seguidores_min>c.seguidores) then
    select count(*) into feitos from public.divulgacao_missoes m join public.divulgacao_reservas r on r.id=m.reserva where r.titular=p_titular and m.estado='validada';
    select v.cliques,v.cadastros,v.visitas into cliques,cadastros,visitas from public.divulgacao_resultados(p_titular) v where v.titular=p_titular;
  end if;
  return query select f.* from public.divulgacao_faixas f where f.seguidores_min<=c.seguidores or
    (f.progressao and feitos>=f.min_missoes and cliques>=f.min_cliques and cadastros>=f.min_cadastros and visitas>=f.min_visitas)
    order by f.seguidores_min desc limit 1;
end $$;
create function public.divulgacao_criterios_imovel(p_ator uuid,p_imovel uuid,p_faixa uuid,p_regiao text,p_campanha uuid,p_metas jsonb) returns void language plpgsql security definer set search_path='' as $$
declare d public.divulgacao_imoveis%rowtype;
begin
  if not public.divulgacao_equipe(p_ator) then raise exception 'Apenas a Matriz.' using errcode='42501';end if;
  perform from public.divulgacao_piloto where id for update;
  select * into strict d from public.divulgacao_imoveis where imovel=p_imovel and autorizado for update;
  if p_campanha is not null and not exists(select from public.campanhas c where c.id=p_campanha and c.property_id=p_imovel and c.gasto>=0) then
    raise exception 'Selecione uma campanha deste imóvel com gasto registrado.' using errcode='P8601';end if;
  if jsonb_typeof(p_metas) is distinct from 'array' or jsonb_array_length(p_metas)>cardinality(d.etapas) then raise exception 'Confira as metas e as etapas do kit.' using errcode='P8601';end if;
  update public.divulgacao_imoveis set min_faixa=p_faixa,regiao_exigida=nullif(trim(p_regiao),''),campanha=p_campanha where imovel=p_imovel;
  delete from public.divulgacao_metas where imovel=p_imovel;
  insert into public.divulgacao_metas(imovel,etapa,quantidade,dias)
    select p_imovel,x.etapa,x.quantidade,x.dias from jsonb_to_recordset(p_metas) as x(etapa integer,quantidade integer,dias integer)
     where x.etapa between 1 and cardinality(d.etapas);
  if (select count(*) from public.divulgacao_metas where imovel=p_imovel)<>jsonb_array_length(p_metas) then raise exception 'Etapa inexistente no kit.' using errcode='P8601';end if;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_ator,'divulgacao_criterios_imovel','properties',p_imovel,jsonb_build_object('faixa',p_faixa,'regiao',p_regiao,'campanha',p_campanha,'metas',p_metas));
end $$;
create function public.divulgacao_metas_kit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.divulgacao_metas m where m.imovel=new.imovel and old.etapas[m.etapa] is distinct from new.etapas[m.etapa];
  return new;
end $$;
revoke all on function public.divulgacao_metas_kit() from public,anon,authenticated;
create trigger trg_divulgacao_metas_kit after update of etapas on public.divulgacao_imoveis for each row when(old.etapas is distinct from new.etapas) execute function public.divulgacao_metas_kit();

-- A consulta de elegibilidade não depende da posição na fila nem do contexto momentâneo do participante.
create function public.divulgacao_elegiveis(p_titular uuid) returns table(imovel uuid,chamada text,valor numeric,codigo text,tipo text,regiao text)
language sql stable security definer set search_path='' as $$
  select i.id,d.titulo_publico,i.valor,i.codigo,i.tipo::text,mu.nome from public.divulgacao_cadastros c
  join public.profiles u on u.user_id=c.titular and u.ativo join public.divulgacao_piloto p on p.id and p.aberto
  join public.divulgacao_faixa_titular(p_titular) f on true
  join public.divulgacao_imoveis d on d.autorizado and d.aprovado and (d.regiao_exigida is null or lower(trim(d.regiao_exigida))=lower(trim(c.regiao)))
  left join public.divulgacao_faixas minima on minima.id=d.min_faixa
  join public.properties i on i.id=d.imovel and i.status='publicado' and i.valor>0 and i.valor<=f.teto_valor
  join public.owners o on o.id=i.owner_id and o.profile_id=d.autorizante left join public.municipalities mu on mu.id=i.municipality_id
  where c.titular=p_titular and c.estado='ativo' and (minima.id is null or f.seguidores_min>=minima.seguidores_min)
    and (exists(select from public.divulgacao_reservas r where r.titular=p_titular and r.imovel=i.id and r.encerrada is null and r.vence>now()) or
      not exists(select from public.opportunities op where op.property_id=i.id and op.etapa not in ('perdido','fechado','pos_venda') and
        (exists(select from public.visits v where v.opportunity_id=op.id and v.status in ('agendada','remarcada')) or
        exists(select from public.proposals s where s.opportunity_id=op.id and s.status in ('enviada','aceita','contraproposta')))));
$$;
create function public.divulgacao_proximo(p_imovel uuid) returns setof public.divulgacao_fila language sql stable security definer set search_path='' as $$
  select q.* from public.divulgacao_fila q where q.imovel=p_imovel and q.saiu is null and (q.limite is null or q.limite>now())
    and exists(select from public.divulgacao_elegiveis(q.titular) x where x.imovel=p_imovel) order by ordem limit 1;
$$;
create function public.divulgacao_chamar(p_imovel uuid) returns void language plpgsql security definer set search_path='' as $$
declare fila public.divulgacao_piloto%rowtype; cabeca public.divulgacao_fila%rowtype;
begin
  select * into strict fila from public.divulgacao_piloto where id for update;
  if not fila.aberto or fila.fila_max=0 then return;end if;
  update public.divulgacao_fila set saiu=limite where imovel=p_imovel and saiu is null and limite<=now();
  if exists(select from public.divulgacao_reservas where imovel=p_imovel and encerrada is null and vence>now()) then return;end if;
  select * into cabeca from public.divulgacao_proximo(p_imovel);
  if cabeca.ordem is null or cabeca.limite is not null then return;end if;
  update public.divulgacao_fila set limite=now()+make_interval(hours=>fila.chamada_horas) where ordem=cabeca.ordem;
  insert into public.notificacoes(user_id,nivel,titulo,texto,link,chave) values(cabeca.titular,'info','Chegou sua vez na fila de divulgação',
    'Abra seu painel para reservar o imóvel até o fim do prazo da convocação.','/divulgador','divulgacao_fila_'||cabeca.ordem)
    on conflict(user_id,chave) where chave is not null do nothing;
end $$;
create function public.divulgacao_ofertas(p_titular uuid) returns table(imovel uuid,chamada text,valor numeric,codigo text,tipo text,regiao text,situacao text,posicao bigint,limite timestamptz)
language sql stable security definer set search_path='' as $$
  select e.*,case when r.titular=p_titular then 'reservado' when q.ordem is not null and r.id is null and cabeca.titular=p_titular then 'sua_vez'
    when q.ordem is not null then 'na_fila' when r.id is not null or cabeca.titular is not null then 'fila' else 'livre' end,
    case when q.ordem is not null then(select count(*) from public.divulgacao_fila f where f.imovel=e.imovel and f.ordem<=q.ordem and f.saiu is null and (f.limite is null or f.limite>now())) end,q.limite
  from public.divulgacao_elegiveis(p_titular) e join public.profiles u on u.user_id=p_titular and u.nicho='divulgador'
  join public.divulgacao_piloto p on p.id
  left join public.divulgacao_reservas r on r.imovel=e.imovel and r.encerrada is null and r.vence>now()
  left join public.divulgacao_fila q on q.imovel=e.imovel and q.titular=p_titular and q.saiu is null and (q.limite is null or q.limite>now())
  left join lateral public.divulgacao_proximo(e.imovel) cabeca on p.fila_max>0
  where r.id is null or r.titular=p_titular or p.fila_max>0 order by e.codigo;
$$;
create or replace function public.divulgacao_catalogo(p_titular uuid) returns table(imovel uuid,chamada text,valor numeric,codigo text)
language sql stable security definer set search_path='' as $$
 select e.imovel,e.chamada,e.valor,e.codigo from public.divulgacao_ofertas(p_titular) e where e.situacao in ('livre','sua_vez','reservado');
$$;
create function public.divulgacao_fila_mudar(p_titular uuid,p_imovel uuid,p_entrar boolean) returns void language plpgsql security definer set search_path='' as $$
declare maximo integer;
begin
  select fila_max into strict maximo from public.divulgacao_piloto where id for update;
  perform public.divulgacao_chamar(p_imovel);
  if not p_entrar then
    update public.divulgacao_fila set saiu=now() where imovel=p_imovel and titular=p_titular and saiu is null;
    perform public.divulgacao_chamar(p_imovel);return;
  end if;
  if exists(select from public.divulgacao_fila where imovel=p_imovel and titular=p_titular and saiu is null) then return;end if;
  if maximo=0 or not exists(select from public.divulgacao_ofertas(p_titular) where imovel=p_imovel and situacao='fila') then raise exception 'Fila indisponível.' using errcode='P8601';end if;
  if maximo<=(select count(*) from public.divulgacao_fila where imovel=p_imovel and saiu is null) then raise exception 'A fila deste imóvel está cheia.' using errcode='P8601';end if;
  insert into public.divulgacao_fila(imovel,titular) values(p_imovel,p_titular);
end $$;
create or replace function public.divulgacao_reservar(p_titular uuid,p_imovel uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare f public.divulgacao_faixas%rowtype; ja uuid; preco numeric;
begin
  perform from public.divulgacao_piloto where id for update;
  if not exists(select from public.divulgacao_aceites a join public.divulgacao_termos t on t.id=a.termo and t.vigente where a.titular=p_titular)
    then raise exception 'Aceite o termo vigente de participação antes de reservar.' using errcode='P8601';end if;
  perform public.divulgacao_chamar(p_imovel);
  select c.valor into preco from public.divulgacao_catalogo(p_titular)c where c.imovel=p_imovel;
  if not found then raise exception 'Imóvel indisponível para este participante.' using errcode='P8601';end if;
  update public.divulgacao_reservas set encerrada=vence where imovel=p_imovel and encerrada is null and vence<=now();
  select id into ja from public.divulgacao_reservas where titular=p_titular and imovel=p_imovel and encerrada is null;
  if found then return ja;end if;
  select * into strict f from public.divulgacao_faixa_titular(p_titular);
  if f.simultaneos<=(select count(*) from public.divulgacao_reservas where titular=p_titular and encerrada is null and vence>now())
    then raise exception 'Você atingiu o limite simultâneo da sua faixa.' using errcode='P8601';end if;
  insert into public.divulgacao_reservas(imovel,titular,faixa,preco_reserva,teto_reserva,vence,etapas)
    select p_imovel,p_titular,f.id,preco,f.teto_valor,now()+make_interval(days=>f.dias),d.etapas from public.divulgacao_imoveis d where d.imovel=p_imovel returning id into ja;
  insert into public.divulgacao_links(reserva,etapa) select ja,generate_subscripts(r.etapas,1) from public.divulgacao_reservas r where r.id=ja;
  insert into public.divulgacao_metas_reserva(reserva,etapa,quantidade,prazo)
    select ja,l.etapa,coalesce(m.quantidade,1),least(r.vence,r.criada+make_interval(days=>coalesce(m.dias,f.dias)))
    from public.divulgacao_reservas r join public.divulgacao_links l on l.reserva=r.id left join public.divulgacao_metas m on m.imovel=r.imovel and m.etapa=l.etapa where r.id=ja;
  update public.divulgacao_fila set saiu=now() where titular=p_titular and imovel=p_imovel and saiu is null;
  insert into public.audit_log(user_id,acao,entidade,entidade_id) values(p_titular,'divulgacao_reservada','divulgacao_reservas',ja);
  return ja;
end $$;

-- As reservas anteriores mantêm uma publicação por etapa e o prazo original.
insert into public.divulgacao_metas_reserva(reserva,etapa,quantidade,prazo,validadas)
 select r.id,l.etapa,1,r.vence,case when m.estado='validada' then 1 else 0 end from public.divulgacao_reservas r
 join public.divulgacao_links l on l.reserva=r.id left join public.divulgacao_missoes m on m.reserva=r.id and m.etapa=l.etapa;
insert into public.divulgacao_publicacoes_validadas(reserva,etapa,link,validada_em,imagem,mime)
 select m.reserva,m.etapa,m.link,coalesce(m.decisao,m.enviada),c.imagem,c.mime from public.divulgacao_missoes m
 left join public.divulgacao_comprovantes c on c.missao=m.id where m.estado='validada' order by m.reserva,m.etapa on conflict do nothing;
alter table public.divulgacao_missoes drop constraint divulgacao_missoes_estado_check;
alter table public.divulgacao_missoes add constraint divulgacao_missoes_estado_check check(estado in ('enviada','validada','rejeitada','parcial'));
alter function public.divulgacao_entregar(uuid,uuid,smallint,text,text,text) rename to divulgacao_entregar_unica;
alter function public.divulgacao_validar(uuid,uuid,boolean,text) rename to divulgacao_validar_unica;
alter function public.divulgacao_rotinas() rename to divulgacao_rotinas_base;
revoke all on function public.divulgacao_entregar_unica(uuid,uuid,smallint,text,text,text),public.divulgacao_validar_unica(uuid,uuid,boolean,text),public.divulgacao_rotinas_base() from public,anon,authenticated,service_role;
create function public.divulgacao_entregar(p_titular uuid,p_reserva uuid,p_etapa smallint,p_link text,p_captura text,p_mime text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform from public.divulgacao_piloto where id for update;
  if exists(select from public.divulgacao_publicacoes_validadas where reserva=p_reserva and link=p_link) then raise exception 'Esta publicação já foi validada na reserva.' using errcode='P8601';end if;
  update public.divulgacao_missoes m set estado='rejeitada' where m.reserva=p_reserva and m.etapa=p_etapa and m.estado='parcial'
    and exists(select from public.divulgacao_reservas r where r.id=p_reserva and r.titular=p_titular);
  perform public.divulgacao_entregar_unica(p_titular,p_reserva,p_etapa,p_link,p_captura,p_mime);
end $$;
create function public.divulgacao_validar(p_ator uuid,p_missao uuid,p_valida boolean,p_motivo text) returns void language plpgsql security definer set search_path='' as $$
declare m public.divulgacao_missoes%rowtype; andamento public.divulgacao_metas_reserva%rowtype;
begin
  perform from public.divulgacao_piloto where id for update;
  perform public.divulgacao_validar_unica(p_ator,p_missao,p_valida,p_motivo);
  select * into strict m from public.divulgacao_missoes where id=p_missao;
  if p_valida then
    insert into public.divulgacao_publicacoes_validadas(reserva,etapa,link,validada_em,operador,imagem,mime)
      select m.reserva,m.etapa,m.link,now(),p_ator,c.imagem,c.mime from public.divulgacao_comprovantes c where c.missao=m.id;
    update public.divulgacao_metas_reserva set validadas=validadas+1 where reserva=m.reserva and etapa=m.etapa returning * into strict andamento;
    if andamento.validadas<andamento.quantidade then update public.divulgacao_missoes set estado='parcial' where id=m.id;end if;
  end if;
  insert into public.notificacoes(user_id,nivel,titulo,texto,link)
    select r.titular,'info',case when p_valida then 'Publicação validada' else 'Publicação precisa de ajuste' end,'Consulte o andamento da missão no seu painel.','/divulgador' from public.divulgacao_reservas r where r.id=m.reserva;
end $$;
create function public.divulgacao_rotinas() returns integer language plpgsql security definer set search_path='' as $$
declare total integer; extras integer; imovel_na_fila uuid;
begin
  total:=public.divulgacao_rotinas_base();
  if not exists(select from public.divulgacao_piloto where id and aberto) then return total;end if;
  for imovel_na_fila in select distinct imovel from public.divulgacao_fila where saiu is null loop perform public.divulgacao_chamar(imovel_na_fila);end loop;
  select count(*) into extras from public.divulgacao_metas_reserva m join public.divulgacao_reservas r on r.id=m.reserva
    where m.prazo<=now() and m.validadas<m.quantidade and (r.encerrada is null or r.encerrada=r.vence)
    and public.fn_tarefa_automatica('divulgacao:prazo:'||r.id||':'||m.etapa,'meta_atrasada','marketing','Revisar meta de publicação vencida',
      r.etapas[m.etapa]||': '||m.validadas||' de '||m.quantidade||' publicações validadas.',null,current_date,'normal',r.imovel,null) is not null;
  return total+extras;
end $$;

-- Coorte observacional. Mesma cidade/tipo e mesmo intervalo; uma linha por grupo.
-- O custo vem exclusivamente de campanhas dedicadas e explicitamente vinculadas.
create function public.divulgacao_comparativo(p_ator uuid,p_inicio date,p_fim date) returns table(grupo text,imoveis integer,visitas_semana numeric,dias_venda numeric,cadastros integer,gasto numeric,cpl numeric)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.divulgacao_equipe(p_ator) then raise exception 'Apenas a Matriz.' using errcode='42501';end if;
  if p_inicio is null or p_fim is null or p_fim<p_inicio or p_fim-p_inicio>365 then raise exception 'Período inválido.' using errcode='P8601';end if;
  return query
  with periodo as(select p_inicio::timestamp at time zone 'America/Sao_Paulo' ini,(p_fim+1)::timestamp at time zone 'America/Sao_Paulo' fim),
  divulgados as(select r.imovel,min(r.criada) primeira from public.divulgacao_reservas r,periodo j where r.criada<j.fim and least(r.vence,coalesce(r.encerrada,r.vence))>j.ini group by r.imovel),
  grupos as(select 'Divulgados'::text nome,d.primeira acompanhamento,i.* from public.properties i join divulgados d on d.imovel=i.id
    union all select 'Comparáveis'::text,i.published_at,i.* from public.properties i,periodo j
      where i.published_at<j.fim and (i.sold_at is null or i.sold_at>=j.ini) and i.status in ('publicado','em_negociacao','vendido','historico')
       and not exists(select from public.divulgacao_reservas r where r.imovel=i.id and r.criada<j.fim)
       and exists(select from divulgados d join public.properties t on t.id=d.imovel where t.tipo=i.tipo and t.municipality_id=i.municipality_id)),
  medidas as(select g.nome,g.id,
     greatest(1,least(p_fim,(now() at time zone 'America/Sao_Paulo')::date,coalesce((g.sold_at at time zone 'America/Sao_Paulo')::date,p_fim))-greatest(p_inicio,(g.acompanhamento at time zone 'America/Sao_Paulo')::date)+1) dias_observados,
     (select count(*) from public.visits v join public.opportunities o on o.id=v.opportunity_id where o.property_id=g.id and v.status='realizada' and v.relatorio_em is not null and v.data_hora>=greatest(j.ini,g.acompanhamento) and v.data_hora<least(j.fim,now(),coalesce(g.sold_at,j.fim))) visitas,
     case when g.sold_at>=j.ini and g.sold_at<j.fim then extract(epoch from g.sold_at-g.published_at)/86400 end dias,
     (select count(*) from public.divulgacao_atribuicoes a where a.imovel=g.id and a.criado>=j.ini and a.criado<j.fim) atribuidos,
     (select count(*) from public.divulgacao_atribuicoes a where a.imovel=g.id and (a.criado at time zone 'America/Sao_Paulo')::date between c.inicio and c.fim) atribuicoes_campanha,
     c.gasto custo
    from grupos g cross join periodo j left join public.divulgacao_imoveis d on g.nome='Divulgados' and d.imovel=g.id
    left join public.campanhas c on c.id=d.campanha and c.property_id=g.id and c.inicio>=p_inicio and c.fim<=p_fim)
  select nomes.nome,count(m.id)::integer,
    round(sum(m.visitas)::numeric*7/nullif(sum(m.dias_observados),0),2),round(avg(m.dias),1),
    case when nomes.nome='Divulgados' then coalesce(sum(m.atribuidos),0)::integer end,
    case when count(m.custo)=count(m.id) then sum(m.custo) end,
    case when count(m.custo)=count(m.id) then round(sum(m.custo)/nullif(sum(m.atribuicoes_campanha),0),2) end
  from (values('Divulgados'),('Comparáveis')) nomes(nome) left join medidas m on m.nome=nomes.nome group by nomes.nome order by nomes.nome desc;
end $$;
revoke all on function public.divulgacao_diretor(uuid),public.divulgacao_parametros_fila(uuid,integer,integer),public.divulgacao_progressao(uuid,uuid,boolean,integer,integer,integer,integer),public.divulgacao_fixar_faixa(uuid,uuid,uuid,text),public.divulgacao_faixa_titular(uuid),public.divulgacao_criterios_imovel(uuid,uuid,uuid,text,uuid,jsonb),public.divulgacao_elegiveis(uuid),public.divulgacao_proximo(uuid),public.divulgacao_chamar(uuid),public.divulgacao_ofertas(uuid),public.divulgacao_fila_mudar(uuid,uuid,boolean),public.divulgacao_entregar(uuid,uuid,smallint,text,text,text),public.divulgacao_validar(uuid,uuid,boolean,text),public.divulgacao_rotinas(),public.divulgacao_comparativo(uuid,date,date) from public,anon,authenticated;
grant execute on function public.divulgacao_parametros_fila(uuid,integer,integer),public.divulgacao_progressao(uuid,uuid,boolean,integer,integer,integer,integer),public.divulgacao_fixar_faixa(uuid,uuid,uuid,text),public.divulgacao_criterios_imovel(uuid,uuid,uuid,text,uuid,jsonb),public.divulgacao_ofertas(uuid),public.divulgacao_fila_mudar(uuid,uuid,boolean),public.divulgacao_entregar(uuid,uuid,smallint,text,text,text),public.divulgacao_validar(uuid,uuid,boolean,text),public.divulgacao_rotinas(),public.divulgacao_comparativo(uuid,date,date) to service_role;
