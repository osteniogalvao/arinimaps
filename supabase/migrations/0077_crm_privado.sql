-- Carteira particular do corretor/técnico. O plano pode vir da organização;
-- a titularidade dos registros é sempre da pessoa autenticada.
create function public.crm_privado_recursos() returns text[]
language sql stable security definer set search_path = '' as $$
    select coalesce(org.recursos, pessoal.recursos) from public.profiles p
    left join public.plans pessoal on pessoal.id = p.plan_id and pessoal.ativo
      and (p.plan_valido_ate is null or p.plan_valido_ate >= now())
    left join lateral (
      select plano.id, plano.recursos from public.organization_members m
      join public.organizations o on o.id = m.org_id and o.ativo
      join public.plans plano on plano.id = o.plan_id and plano.ativo and plano.escopo = 'organizacao'
      where m.user_id = p.user_id and m.status = 'ativo'
        and (o.plan_valido_ate is null or o.plan_valido_ate >= now())
    ) org on p.plan_origem = 'padrao'
    where p.user_id = (select auth.uid()) and p.ativo
      and p.role not in ('admin_central','analista_arini')
      and p.nicho in ('corretor_imobiliaria','engenheiro')
      and ((auth.jwt()->>'aal') = 'aal2' or not exists (
        select 1 from auth.mfa_factors f where f.user_id = p.user_id and f.status = 'verified'
      ));
$$;
create function public.crm_privado_liberado() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce('crm_privado' = any(public.crm_privado_recursos()),false);
$$;
create function public.crm_setorial_liberado() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.crm_privado_recursos() @> array['crm_privado','crm_setorial'],false)
     and exists(select 1 from public.profiles where user_id = (select auth.uid()) and nicho = 'engenheiro');
$$;

create table public.crm_privado_espacos (
  titular_id uuid primary key references public.profiles(user_id) on delete cascade,
  criado_em timestamptz not null default now()
);
create table public.crm_privado_contatos (
  titular_id uuid not null references public.crm_privado_espacos on delete cascade,
  id uuid not null default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 140),
  email text check (length(email) <= 254),
  telefone text check (length(telefone) <= 40),
  primary key (titular_id,id)
);
create table public.crm_privado_atendimentos (
  titular_id uuid not null, id uuid not null, contato_id uuid not null,
  assunto text not null check (length(trim(assunto)) between 1 and 180),
  etapa text not null check (etapa in ('triagem','em_atendimento','aguardando_retorno','concluido')),
  proximo_retorno date, versao integer not null default 1,
  atualizado_em timestamptz not null default now(),
  primary key (titular_id,id),
  foreign key (titular_id,contato_id) references public.crm_privado_contatos(titular_id,id) on delete cascade
);
create index crm_privado_lista on public.crm_privado_atendimentos(titular_id, atualizado_em desc, id);
create table public.crm_privado_historico (
  titular_id uuid not null, atendimento_id uuid not null, versao integer not null,
  etapa_anterior text, etapa text not null, proximo_retorno date,
  nota text check (length(nota) <= 2000), criado_em timestamptz not null default now(),
  primary key (titular_id,atendimento_id,versao),
  foreign key (titular_id,atendimento_id) references public.crm_privado_atendimentos(titular_id,id) on delete cascade
);

do $$ declare tabela text; begin
  foreach tabela in array array['crm_privado_espacos','crm_privado_contatos','crm_privado_atendimentos','crm_privado_historico'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('revoke all on public.%I from public, anon, authenticated', tabela);
    execute format('grant select on public.%I to authenticated', tabela);
    execute format('create policy somente_titular on public.%I for select to authenticated using (titular_id = (select auth.uid()) and (select public.crm_privado_liberado()))', tabela);
  end loop;
end $$;

-- Os mesmos descritores alimentam o formulário e validam o RPC; não há lookup
-- de conselho, registro, órgão ou serviço de terceiro.
create function public.crm_privado_modelos() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "advocacia":{"nome":"Advocacia","categorias":{"caso":"Caso ou processo","dossie":"Dossiê do imóvel","contrato":"Peça ou contrato","honorarios":"Honorários"},"campos":{"referencia":{"nome":"Referência do caso ou processo","tipo":"texto"},"prazo":{"nome":"Prazo ou audiência","tipo":"data"}}},
    "agrimensura":{"nome":"Agrimensura e topografia","categorias":{"levantamento":"Levantamento de campo","memorial":"Memorial ou planta","confrontantes":"Confrontantes","orcamento":"Orçamento por área"},"campos":{"area":{"nome":"Área do levantamento (ha)","tipo":"numero"},"art":{"nome":"Referência da ART","tipo":"texto"}}},
    "contabilidade":{"nome":"Contabilidade","categorias":{"obrigacao":"Obrigação e vencimento","competencia":"Tarefa por competência","documento":"Documentação fiscal","honorarios":"Honorários"},"campos":{"competencia":{"nome":"Competência (mês/ano)","tipo":"texto"},"vencimento":{"nome":"Vencimento da obrigação","tipo":"data"}}},
    "engenharia_ambiental":{"nome":"Engenharia ambiental","categorias":{"licenca":"Licença ou condicionante","vistoria":"Vistoria e laudo","app":"APP ou Reserva Legal","recuperacao":"Recuperação de áreas"},"campos":{"licenca":{"nome":"Referência da licença ou área","tipo":"texto"},"prazo":{"nome":"Prazo da condicionante","tipo":"data"}}},
    "engenharia_civil":{"nome":"Engenharia civil","categorias":{"obra":"Obra e cronograma","vistoria":"Vistoria","medicao":"Orçamento e medição","estudo":"Estudo do terreno"},"campos":{"obra":{"nome":"Identificação da obra","tipo":"texto"},"art":{"nome":"Referência da ART","tipo":"texto"},"vistoria":{"nome":"Data da vistoria","tipo":"data"}}},
    "corretagem":{"nome":"Corretagem","categorias":{"captacao":"Captação de imóvel","visita":"Visita ou lead","proposta":"Negociação ou proposta","comissao":"Comissão"},"campos":{"imovel":{"nome":"Referência particular do imóvel","tipo":"texto"},"visita":{"nome":"Data da visita","tipo":"data"}}}
  }'::jsonb;
$$;

create table public.crm_privado_preferencias_setoriais (
  titular_id uuid primary key references public.crm_privado_espacos on delete cascade,
  profissao text not null
);
-- Snapshot imutável do serviço na abertura. Guardar os rótulos preserva o
-- histórico mesmo se a pessoa trocar de profissão ou o catálogo evoluir.
create table public.crm_privado_servicos (
  titular_id uuid not null, atendimento_id uuid not null, profissao text not null,
  modelo_nome text not null, categoria text not null, categoria_nome text not null, campos jsonb not null,
  primary key (titular_id, atendimento_id),
  foreign key (titular_id,atendimento_id) references public.crm_privado_atendimentos(titular_id,id) on delete cascade
);
alter table public.crm_privado_preferencias_setoriais enable row level security;
alter table public.crm_privado_servicos enable row level security;
revoke all on public.crm_privado_preferencias_setoriais, public.crm_privado_servicos from public,anon,authenticated;
grant select on public.crm_privado_preferencias_setoriais, public.crm_privado_servicos to authenticated;
create policy titular_tecnico on public.crm_privado_preferencias_setoriais for select to authenticated
 using (titular_id = (select auth.uid()) and (select public.crm_setorial_liberado()));
create policy titular_tecnico on public.crm_privado_servicos for select to authenticated
 using (titular_id = (select auth.uid()) and (select public.crm_setorial_liberado()));

create function public.crm_privado_configuracao() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.crm_setorial_liberado() then jsonb_build_object(
    'profissao', (select profissao from public.crm_privado_preferencias_setoriais where titular_id = auth.uid()),
    'modelos', public.crm_privado_modelos()) else null end;
$$;
create function public.crm_privado_profissao(p_profissao text) returns void
language plpgsql security definer set search_path = '' as $$
declare dono uuid := auth.uid();
begin
  if not public.crm_setorial_liberado() then raise insufficient_privilege; end if;
  if p_profissao is null or not (public.crm_privado_modelos() ? p_profissao) then raise invalid_parameter_value; end if;
  insert into public.crm_privado_espacos(titular_id) values(dono) on conflict do nothing;
  insert into public.crm_privado_preferencias_setoriais(titular_id,profissao) values(dono,p_profissao)
    on conflict(titular_id) do update set profissao = excluded.profissao;
end $$;

-- Uma transação cria o contato (ou reutiliza um contato do titular), o
-- atendimento em triagem e a primeira entrada no histórico.
create function public.crm_privado_abrir(
  p_id uuid, p_contato_id uuid, p_nome text, p_email text, p_telefone text,
  p_assunto text, p_retorno date, p_nota text,
  p_modelo text default null, p_categoria text default null, p_campos jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare dono uuid := auth.uid(); contato uuid := p_contato_id;
  modelo jsonb; configurado text; campo record; descritor jsonb; valor text; snapshot jsonb := '{}';
begin
  if not public.crm_privado_liberado() then raise insufficient_privilege; end if;
  if p_id is null or nullif(trim(p_assunto),'') is null or length(trim(p_assunto)) > 180
     or length(p_nota) > 2000 then raise invalid_parameter_value; end if;
  insert into public.crm_privado_espacos(titular_id) values(dono) on conflict do nothing;
  -- Serializa retries da mesma abertura. Chave idempotente é privada por titular.
  perform pg_advisory_xact_lock(hashtextextended(dono::text || p_id::text, 0));
  if exists(select 1 from public.crm_privado_atendimentos where titular_id = dono and id = p_id) then return p_id; end if;
  if p_modelo is not null or p_categoria is not null or p_campos is distinct from '{}'::jsonb then
    if not public.crm_setorial_liberado() then raise insufficient_privilege; end if;
    select profissao into configurado from public.crm_privado_preferencias_setoriais where titular_id=dono for share;
    if configurado is null or configurado is distinct from p_modelo then raise serialization_failure; end if;
    modelo := public.crm_privado_modelos()->p_modelo;
    if p_categoria is null or not ((modelo->'categorias') ? p_categoria) or p_campos is null
      or jsonb_typeof(p_campos) <> 'object' or octet_length(p_campos::text) > 4096 then raise invalid_parameter_value; end if;
    for campo in select * from jsonb_each(p_campos) loop
      descritor := modelo->'campos'->campo.key;
      if descritor is null or jsonb_typeof(campo.value) <> 'string' then raise invalid_parameter_value; end if;
      valor := trim(campo.value #>> '{}');
      if length(valor) > 250 then raise invalid_parameter_value; end if;
      if valor = '' then continue; end if;
      if descritor->>'tipo' = 'data' then
        if valor !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_parameter_value; end if;
        perform valor::date;
      elsif descritor->>'tipo' = 'numero' and valor !~ '^[0-9]{1,12}([.][0-9]{1,6})?$' then raise invalid_parameter_value;
      end if;
      snapshot := snapshot || jsonb_build_object(campo.key, descritor || jsonb_build_object('valor',valor));
    end loop;
  end if;
  if contato is null then
    if nullif(trim(p_nome),'') is null or length(trim(p_nome)) > 140
       or length(p_email) > 254 or length(p_telefone) > 40 then raise invalid_parameter_value; end if;
    insert into public.crm_privado_contatos(titular_id,nome,email,telefone)
      values(dono,trim(p_nome),nullif(trim(p_email),''),nullif(trim(p_telefone),'')) returning id into contato;
  elsif not exists(select 1 from public.crm_privado_contatos where titular_id = dono and id = contato)
    then raise no_data_found;
  end if;
  insert into public.crm_privado_atendimentos(titular_id,id,contato_id,assunto,etapa,proximo_retorno)
    values(dono,p_id,contato,trim(p_assunto),'triagem',p_retorno);
  insert into public.crm_privado_historico(titular_id,atendimento_id,versao,etapa,proximo_retorno,nota)
    values(dono,p_id,1,'triagem',p_retorno,nullif(trim(p_nota),''));
  if modelo is not null then
    insert into public.crm_privado_servicos(titular_id,atendimento_id,profissao,modelo_nome,categoria,categoria_nome,campos)
      values(dono,p_id,p_modelo,modelo->>'nome',p_categoria,modelo->'categorias'->>p_categoria,snapshot);
  end if;
  return p_id;
end $$;

create function public.crm_privado_encaminhar(
  p_id uuid, p_versao integer, p_etapa text, p_retorno date, p_nota text
) returns integer language plpgsql security definer set search_path = '' as $$
declare dono uuid := auth.uid(); anterior public.crm_privado_atendimentos%rowtype; seguinte integer;
begin
  if not public.crm_privado_liberado() then raise insufficient_privilege; end if;
  if p_etapa is null or p_etapa not in ('triagem','em_atendimento','aguardando_retorno','concluido')
    or p_versao is null or p_versao < 1 or length(p_nota) > 2000 then raise invalid_parameter_value; end if;
  select * into anterior from public.crm_privado_atendimentos where titular_id = dono and id = p_id for update;
  if not found then raise no_data_found; end if;
  if anterior.versao <> p_versao then raise serialization_failure; end if;
  if anterior.etapa = p_etapa and anterior.proximo_retorno is not distinct from p_retorno
     and nullif(trim(p_nota),'') is null then raise invalid_parameter_value; end if;
  seguinte := anterior.versao + 1;
  update public.crm_privado_atendimentos set etapa = p_etapa, proximo_retorno = p_retorno,
    versao = seguinte, atualizado_em = clock_timestamp() where titular_id = dono and id = p_id;
  insert into public.crm_privado_historico(titular_id,atendimento_id,versao,etapa_anterior,etapa,proximo_retorno,nota)
    values(dono,p_id,seguinte,anterior.etapa,p_etapa,p_retorno,nullif(trim(p_nota),''));
  return seguinte;
end $$;

revoke all on function public.crm_privado_recursos(), public.crm_privado_modelos() from public, anon, authenticated;
revoke all on function public.crm_privado_liberado(), public.crm_setorial_liberado(), public.crm_privado_configuracao(), public.crm_privado_profissao(text), public.crm_privado_abrir(uuid,uuid,text,text,text,text,date,text,text,text,jsonb),
  public.crm_privado_encaminhar(uuid,integer,text,date,text) from public, anon, authenticated;
grant execute on function public.crm_privado_liberado(), public.crm_setorial_liberado(), public.crm_privado_configuracao(), public.crm_privado_profissao(text), public.crm_privado_abrir(uuid,uuid,text,text,text,text,date,text,text,text,jsonb),
  public.crm_privado_encaminhar(uuid,integer,text,date,text) to authenticated;
