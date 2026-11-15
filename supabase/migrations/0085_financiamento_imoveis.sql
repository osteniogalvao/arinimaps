-- Linhas sem tabela bancária aprovada ficam em espera. Não há taxa fictícia na carga.
create table public.fin_linhas (
  id uuid primary key default gen_random_uuid(),
  banco text not null check (length(trim(banco)) between 2 and 100),
  nome text not null check (length(trim(nome)) between 2 and 160),
  tipo text not null check (tipo in ('rural','urbano')),
  taxa_nominal_aa numeric(8,4) not null check (taxa_nominal_aa between 0 and 100),
  cet_aa numeric(8,4) not null check (cet_aa between 0 and 150),
  prazo_max integer not null check (prazo_max between 1 and 600),
  percentual_max numeric(5,2) not null check (percentual_max > 0 and percentual_max <= 100),
  seguro_mensal numeric(12,2) not null check (seguro_mensal >= 0),
  tarifa_inicial numeric(12,2) not null check (tarifa_inicial >= 0),
  sistemas text[] not null check (cardinality(sistemas) between 1 and 2 and sistemas <@ array['SAC','PRICE']::text[]),
  fonte text not null check (length(trim(fonte)) between 3 and 500),
  inicio date not null, fim date not null check (fim >= inicio),
  lista_documentos text[] not null default '{}',
  criado_por uuid references public.profiles(user_id) on delete set null,
  criado_em timestamptz not null default now(), ativo boolean not null default true
);
create table public.fin_vagas (
  id uuid primary key default gen_random_uuid(),
  banco text not null check (length(trim(banco)) between 2 and 100),
  regiao_id uuid not null references public.regions(id),
  titular_id uuid not null references public.profiles(user_id) on delete cascade,
  identificacao text not null check (length(trim(identificacao)) between 2 and 180),
  -- Referência a comprovante de habilitação verificado pela equipe. Nunca vai ao comprador.
  referencia_verificacao text not null check (length(trim(referencia_verificacao)) between 3 and 240),
  prioridade smallint not null check (prioridade in (1,2)),
  sla_minutos integer not null check (sla_minutos between 1 and 10080),
  ativo boolean not null default true,
  criado_por uuid references public.profiles(user_id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index fin_vaga_posicao on public.fin_vagas(lower(trim(banco)),regiao_id,prioridade) where ativo;
create unique index fin_vaga_titular on public.fin_vagas(lower(trim(banco)),regiao_id,titular_id) where ativo;

create table public.fin_simulacoes (
  id uuid primary key, cliente_id uuid not null references public.profiles(user_id) on delete cascade,
  imovel_id uuid not null references public.properties(id) on delete cascade,
  linha_id uuid not null references public.fin_linhas(id),
  regiao_id uuid references public.regions(id),
  espelho jsonb not null, criada_em timestamptz not null default now()
);
create index fin_sim_cliente on public.fin_simulacoes(cliente_id, criada_em desc);
create index fin_sim_imovel on public.fin_simulacoes(imovel_id);
create table public.fin_atendimentos (
  id uuid primary key references public.fin_simulacoes(id) on delete cascade,
  vaga_id uuid not null references public.fin_vagas(id) on delete cascade,
  nome text not null, email text not null, telefone text,
  consentimento text not null, consentido_em timestamptz not null default now(), revogado_em timestamptz,
  renda numeric(14,2) check (renda > 0), nascimento date,
  prazo_contato timestamptz not null, primeiro_contato timestamptz,
  estado text not null default 'REPASSADO'
    check (estado in ('REPASSADO','EM_ATENDIMENTO','DOCUMENTOS_SOLICITADOS','DOCUMENTOS_RECEBIDOS','EM_ANALISE_BANCO','APROVADO','REPROVADO','CONTRATADO','PERDIDO'))
);
create table public.fin_eventos (
  id bigint generated always as identity primary key, simulacao_id uuid not null references public.fin_simulacoes(id) on delete cascade,
  ator_id uuid references public.profiles(user_id) on delete set null, estado text not null, nota text, criado_em timestamptz not null default now()
);
create index fin_historico on public.fin_eventos(simulacao_id,id);
create table public.fin_documentos (
  id uuid primary key default gen_random_uuid(), atendimento_id uuid not null references public.fin_atendimentos(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 2 and 180), comentario text,
  estado text not null default 'PENDENTE' check (estado in ('PENDENTE','ENVIADO','APROVADO','REFAZER')),
  nome_arquivo text, storage_path text unique,
  criado_em timestamptz not null default now()
);
create unique index fin_doc_titulo on public.fin_documentos(atendimento_id,lower(trim(titulo)));

do $$
declare nome text;
begin
  foreach nome in array array['fin_linhas','fin_vagas','fin_simulacoes','fin_atendimentos','fin_eventos','fin_documentos'] loop
    execute format('alter table public.%I enable row level security',nome);
    execute format('revoke all on public.%I from public, anon, authenticated',nome);
    execute format('grant select, insert, update, delete on public.%I to service_role',nome);
  end loop;
end $$;
grant usage, select on sequence public.fin_eventos_id_seq to service_role;

-- O mesmo UUID reenviado pelo titular devolve o espelho original. O cálculo utiliza
-- somente o preço anunciado e a versão da linha lidos no banco.
create function public.fin_simular(p_id uuid,p_cliente uuid,p_codigo text,p_linha uuid,p_entrada numeric,p_meses integer,p_sistema text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
  im public.properties%rowtype; l public.fin_linhas%rowtype; muni public.municipalities%rowtype;
  esp jsonb; saldo numeric; i numeric; inicial numeric; soma numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,31));
  select espelho into esp from public.fin_simulacoes where id=p_id and cliente_id=p_cliente;
  if found then return esp; end if;
  select * into im from public.properties where codigo=p_codigo and status in ('publicado','em_negociacao')
    and aceita_financiamento and valor>0 for share;
  if not found then raise exception 'Imóvel indisponível para simulação.'; end if;
  select * into muni from public.municipalities where id=im.municipality_id;
  select * into l from public.fin_linhas where id=p_linha and ativo and current_date between inicio and fim and tipo=im.tipo::text for share;
  if not found then raise exception 'Linha indisponível para este imóvel.'; end if;
  if p_meses is null or p_meses not between 1 and l.prazo_max or p_sistema is null or not(p_sistema=any(l.sistemas))
    or p_entrada is null or p_entrada <> round(p_entrada,2) or p_entrada < 0 or p_entrada>=im.valor
    or (im.valor-p_entrada)*100>im.valor*l.percentual_max then raise exception 'Confira a entrada, o prazo e o sistema da linha.'; end if;
  saldo:=im.valor-p_entrada; i:=l.taxa_nominal_aa/1200;
  if p_sistema='SAC' then
    inicial:=saldo/p_meses+saldo*i;
    soma:=saldo+saldo*i*(p_meses+1)/2;
  else
    inicial:=case when i=0 then saldo/p_meses else saldo*i/(1-power(1+i,-p_meses)) end;
    soma:=inicial*p_meses;
  end if;
  esp:=jsonb_build_object('codigo',im.codigo,'titulo',im.titulo,'tipo',im.tipo,'municipio',muni.nome,'uf',muni.uf,
    'valor',im.valor,'entrada',p_entrada,'financiado',saldo,'prazo',p_meses,'sistema',p_sistema,
    'banco',l.banco,'linha',l.nome,'versao',l.id,'taxa_nominal_aa',l.taxa_nominal_aa,'cet_aa',l.cet_aa,
    'seguro_mensal',l.seguro_mensal,'tarifa_inicial',l.tarifa_inicial,'fonte',l.fonte,'vigencia_inicio',l.inicio,'vigencia_fim',l.fim,
    'parcela_inicial',round(inicial+l.seguro_mensal,2),'total',round(p_entrada+soma+l.seguro_mensal*p_meses+l.tarifa_inicial,2));
  insert into public.fin_simulacoes(id,cliente_id,imovel_id,linha_id,regiao_id,espelho) values(p_id,p_cliente,im.id,l.id,muni.region_id,esp);
  insert into public.fin_eventos(simulacao_id,ator_id,estado) values(p_id,p_cliente,'SIMULADO');
  return esp;
end $$;

-- O titular consente com uma instituição identificada. Uma troca de vaga exige
-- novo aceite, inclusive quando houver atraso de atendimento.
create function public.fin_repassar(p_id uuid,p_cliente uuid,p_vaga uuid,p_email text,p_renda numeric,p_nascimento date)
returns void language plpgsql set search_path=public,pg_temp as $$
declare sim public.fin_simulacoes%rowtype; v public.fin_vagas%rowtype; dado public.profiles%rowtype; termo text;
begin
  select * into sim from public.fin_simulacoes where id=p_id and cliente_id=p_cliente for update;
  if not found then raise exception 'Simulação indisponível.'; end if;
  if exists (select from public.fin_atendimentos where id=p_id and vaga_id=p_vaga and revogado_em is null) then return; end if;
  if exists (select from public.fin_atendimentos where id=p_id) then raise exception 'Este atendimento já foi solicitado.'; end if;
  select * into v from public.fin_vagas where id=p_vaga and ativo and lower(trim(banco))=lower(trim(sim.espelho->>'banco')) and regiao_id=sim.regiao_id for share;
  if not found then raise exception 'A vaga mudou. Confira a instituição antes de autorizar.'; end if;
  if p_nascimento>current_date or p_nascimento<'1900-01-01' then raise exception 'Data de nascimento inválida.'; end if;
  select * into strict dado from public.profiles where user_id=p_cliente and ativo;
  termo:=format('Autorizo compartilhar meu contato, esta simulação e os dados opcionais informados com %s para atendimento do banco %s. Versão 1.',v.identificacao,v.banco);
  insert into public.fin_atendimentos(id,vaga_id,nome,email,telefone,consentimento,renda,nascimento,prazo_contato)
    values(p_id,v.id,dado.nome,p_email,dado.telefone,termo,p_renda,p_nascimento,now()+make_interval(mins=>v.sla_minutos));
  insert into public.fin_eventos(simulacao_id,ator_id,estado,nota) values(p_id,p_cliente,'REPASSADO',v.identificacao);
end $$;

create function public.fin_movimentar(p_id uuid,p_ator uuid,p_acao text,p_nota text default null,p_doc uuid default null,p_path text default null,p_nome text default null)
returns void language plpgsql set search_path=public,pg_temp as $$
declare
  a public.fin_atendimentos%rowtype; s public.fin_simulacoes%rowtype; d public.fin_documentos%rowtype;
  cliente boolean; correspondente boolean; proximo text; detalhe text;
begin
  select * into a from public.fin_atendimentos where id=p_id for update;
  if not found then raise exception 'Atendimento indisponível.'; end if;
  select * into strict s from public.fin_simulacoes where id=p_id;
  cliente:=s.cliente_id=p_ator;
  correspondente:=exists(select from public.fin_vagas v where v.id=a.vaga_id and v.titular_id=p_ator and v.ativo)
    and exists(select from public.profiles p where p.user_id=p_ator and p.ativo and p.nicho='correspondente_bancario');
  if cliente and p_acao='REVOGAR' then
    if a.revogado_em is null then
      update public.fin_atendimentos set revogado_em=now() where id=p_id;
      insert into public.fin_eventos(simulacao_id,ator_id,estado) values(p_id,p_ator,'REVOGADO');
    end if; return;
  end if;
  if a.revogado_em is not null or not (cliente or correspondente) then raise exception 'Atendimento indisponível.'; end if;
  if a.estado in ('PERDIDO','REPROVADO','CONTRATADO') then raise exception 'Atendimento encerrado.'; end if;
  if cliente and p_acao='ENVIAR_DOCUMENTO' then
    select * into d from public.fin_documentos where id=p_doc and atendimento_id=p_id for update;
    if not found or d.estado not in ('PENDENTE','REFAZER') or p_path is null or p_nome is null then raise exception 'Documento indisponível para envio.'; end if;
    update public.fin_documentos set estado='ENVIADO',storage_path=p_path,nome_arquivo=p_nome where id=p_doc;
    detalhe:=d.titulo;
    if not exists(select from public.fin_documentos where atendimento_id=p_id and estado in ('PENDENTE','REFAZER')) then proximo:='DOCUMENTOS_RECEBIDOS'; end if;
  elsif not correspondente then raise exception 'Operação indisponível.';
  elsif p_acao='SOLICITAR_DOCUMENTO' then
    if a.estado not in ('EM_ATENDIMENTO','DOCUMENTOS_SOLICITADOS','DOCUMENTOS_RECEBIDOS') or p_nota is null then raise exception 'Inicie o atendimento antes de solicitar documentos.'; end if;
    insert into public.fin_documentos(atendimento_id,titulo) values(p_id,trim(p_nota)) on conflict do nothing;
    if not found then return; end if;
    detalhe:=trim(p_nota); proximo:='DOCUMENTOS_SOLICITADOS';
  elsif p_acao in ('APROVAR_DOCUMENTO','REFAZER_DOCUMENTO') then
    update public.fin_documentos set estado=case when p_acao='APROVAR_DOCUMENTO' then 'APROVADO' else 'REFAZER' end,
      comentario=left(p_nota,400) where id=p_doc and atendimento_id=p_id and estado='ENVIADO' returning * into d;
    if not found then raise exception 'Documento indisponível para análise.'; end if;
    if p_acao='REFAZER_DOCUMENTO' then proximo:='DOCUMENTOS_SOLICITADOS'; end if; detalhe:=d.titulo;
  elsif (p_acao='EM_ATENDIMENTO' and a.estado='REPASSADO')
    or (p_acao='EM_ANALISE_BANCO' and a.estado in ('EM_ATENDIMENTO','DOCUMENTOS_RECEBIDOS')
        and not exists(select from public.fin_documentos where atendimento_id=p_id and estado<>'APROVADO'))
    or (p_acao in ('APROVADO','REPROVADO') and a.estado='EM_ANALISE_BANCO')
    or (p_acao='CONTRATADO' and a.estado='APROVADO')
    or (p_acao='PERDIDO' and p_nota in ('Desistência','Sem retorno','Crédito incompatível','Imóvel indisponível','Outro')) then
    proximo:=p_acao; detalhe:=left(p_nota,400);
  else raise exception 'Transição indisponível para este atendimento.'; end if;
  update public.fin_atendimentos set estado=coalesce(proximo,estado),
    primeiro_contato=case when proximo='EM_ATENDIMENTO' then coalesce(primeiro_contato,now()) else primeiro_contato end where id=p_id;
  insert into public.fin_eventos(simulacao_id,ator_id,estado,nota) values(p_id,p_ator,p_acao,detalhe);
end $$;
revoke all on function public.fin_simular(uuid,uuid,text,uuid,numeric,integer,text),
  public.fin_repassar(uuid,uuid,uuid,text,numeric,date),
  public.fin_movimentar(uuid,uuid,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fin_simular(uuid,uuid,text,uuid,numeric,integer,text),
  public.fin_repassar(uuid,uuid,uuid,text,numeric,date),
  public.fin_movimentar(uuid,uuid,text,text,uuid,text,text) to service_role;

create function public.fin_resumo_central() returns table(banco text,regiao text,estado text,quantidade bigint,atrasados bigint,alertas bigint)
language sql stable set search_path=public,pg_temp as $$
  select s.espelho->>'banco',coalesce(r.nome,'Sem região'),
    case when a.revogado_em is not null then 'REVOGADO' else coalesce(a.estado,'SIMULADO') end,
    count(*),count(*) filter(where a.revogado_em is null and a.estado='REPASSADO' and a.prazo_contato<now()),
    count(*) filter(where a.revogado_em is null and a.estado='REPASSADO' and now() between a.consentido_em+(a.prazo_contato-a.consentido_em)/2 and a.prazo_contato)
  from public.fin_simulacoes s left join public.fin_atendimentos a on a.id=s.id left join public.regions r on r.id=s.regiao_id
  group by 1,2,3 order by 1,2,3
$$;
revoke all on function public.fin_resumo_central() from public,anon,authenticated;
grant execute on function public.fin_resumo_central() to service_role;

