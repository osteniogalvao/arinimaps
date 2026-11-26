-- 0173: CRM do escritório (corretor, imobiliária e profissional técnico).
--
-- Pedido do Stenio em 25/11/2026: "todos os planos têm que estar funcionando",
-- com um CRM próximo do da Arini Negócios Imobiliários. Até aqui o plano pago
-- de corretor entregava só a triagem de contatos (/painel/crm). Esta migration
-- cria o escritório: carteira de imóveis com código automático, clientes e
-- proprietários, funil de negócios em colunas, agenda (visitas, reuniões,
-- ligações, prazos) e histórico de alterações.
--
-- Espaço: cada registro pertence a um espaço. Sem equipe, o espaço é a conta
-- ('conta/<user_id>'). Com o recurso crm_equipe no plano da organização
-- (Profissional e Premium), o espaço é a organização ('org/<id>') e todos os
-- membros ativos trabalham na mesma carteira, com responsável por registro.
--
-- A trava é do banco: as policies usam crm_esc_espaco(); o gatilho grava o
-- espaço e o autor, então ninguém grava em espaço alheio forçando a API.
-- Idempotente: pode rodar de novo.

-- ---------------------------------------------------------------- espaço
create or replace function public.crm_esc_espaco() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  rec text[];
  perfil record;
  org_id uuid;
  org_nome text;
  org_papel text;
begin
  if uid is null then return null; end if;
  rec := public.crm_privado_recursos();
  if rec is null or not ('crm_privado' = any(rec)) then return null; end if;
  select user_id, nome, nicho, plan_origem into perfil from public.profiles where user_id = uid;
  if 'crm_equipe' = any(rec) and perfil.plan_origem = 'padrao' then
    select o.id, o.nome, m.papel_org into org_id, org_nome, org_papel
      from public.organization_members m
      join public.organizations o on o.id = m.org_id and o.ativo
      join public.plans pl on pl.id = o.plan_id and pl.ativo and pl.escopo = 'organizacao'
        and pl.recursos @> array['crm_privado','crm_equipe']
     where m.user_id = uid and m.status = 'ativo' and m.nicho_vinculo is not distinct from perfil.nicho
       and (o.plan_valido_ate is null or o.plan_valido_ate >= now())
     limit 1;
  end if;
  if org_id is not null then
    return jsonb_build_object('chave', 'org/' || org_id, 'nome', org_nome, 'nicho', perfil.nicho,
      'equipe', true, 'gestor', org_papel = 'admin', 'auditoria', 'crm_auditoria' = any(rec));
  end if;
  return jsonb_build_object('chave', 'conta/' || uid, 'nome', perfil.nome, 'nicho', perfil.nicho,
    'equipe', false, 'gestor', true, 'auditoria', 'crm_auditoria' = any(rec));
end $$;
revoke all on function public.crm_esc_espaco() from public, anon;
grant execute on function public.crm_esc_espaco() to authenticated;

create or replace function public.crm_esc_chave() returns text
language sql stable security definer set search_path = '' as $$
  select public.crm_esc_espaco()->>'chave';
$$;
revoke all on function public.crm_esc_chave() from public, anon;
grant execute on function public.crm_esc_chave() to authenticated;

-- Pessoas que podem ser responsáveis no espaço atual (a própria conta, ou os
-- membros ativos da organização).
create or replace function public.crm_esc_membros()
returns table(user_id uuid, nome text, gestor boolean)
language plpgsql stable security definer set search_path = '' as $$
declare chave text := public.crm_esc_chave();
begin
  if chave is null then return; end if;
  if chave like 'conta/%' then
    return query select p.user_id, coalesce(nullif(p.nome,''), 'Eu'), true
      from public.profiles p where p.user_id = auth.uid();
  else
    return query select p.user_id, coalesce(nullif(p.nome,''), m.email), m.papel_org = 'admin'
      from public.organization_members m join public.profiles p on p.user_id = m.user_id and p.ativo
     where m.org_id = substr(chave, 5)::uuid and m.status = 'ativo'
     order by 2;
  end if;
end $$;
revoke all on function public.crm_esc_membros() from public, anon;
grant execute on function public.crm_esc_membros() to authenticated;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.crm_esc_pessoas (
  id uuid primary key default gen_random_uuid(),
  espaco text not null,
  tipo text not null default 'cliente' check (tipo in ('cliente','proprietario','lead','parceiro')),
  nome text not null check (length(trim(nome)) between 1 and 140),
  telefone text check (length(telefone) <= 40),
  email text check (length(email) <= 254),
  documento text check (length(documento) <= 30),
  cidade text check (length(cidade) <= 120),
  origem text check (length(origem) <= 60),
  observacoes text check (length(observacoes) <= 4000),
  responsavel uuid references public.profiles(user_id) on delete set null,
  criado_por uuid references public.profiles(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_esc_pessoas_espaco on public.crm_esc_pessoas(espaco, tipo, nome);

create table if not exists public.crm_esc_imoveis (
  id uuid primary key default gen_random_uuid(),
  espaco text not null,
  codigo text not null,
  tipo text not null check (tipo in ('casa','apartamento','terreno','lote','rural','comercial','galpao','sala','outro')),
  finalidade text not null default 'venda' check (finalidade in ('venda','locacao','venda_locacao')),
  titulo text not null check (length(trim(titulo)) between 1 and 180),
  cidade text check (length(cidade) <= 120),
  bairro text check (length(bairro) <= 120),
  endereco text check (length(endereco) <= 240),
  link_mapa text check (length(link_mapa) <= 600),
  valor numeric(14,2) check (valor is null or valor >= 0),
  area numeric(14,2) check (area is null or area >= 0),
  area_unidade text not null default 'm2' check (area_unidade in ('m2','ha','alqueire')),
  quartos smallint check (quartos is null or quartos between 0 and 99),
  vagas smallint check (vagas is null or vagas between 0 and 99),
  proprietario_id uuid references public.crm_esc_pessoas(id) on delete set null,
  status text not null default 'captacao' check (status in ('captacao','disponivel','reservado','vendido','alugado','inativo')),
  observacoes text check (length(observacoes) <= 4000),
  responsavel uuid references public.profiles(user_id) on delete set null,
  criado_por uuid references public.profiles(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (espaco, codigo)
);
create index if not exists crm_esc_imoveis_espaco on public.crm_esc_imoveis(espaco, status, atualizado_em desc);

create table if not exists public.crm_esc_negocios (
  id uuid primary key default gen_random_uuid(),
  espaco text not null,
  titulo text not null check (length(trim(titulo)) between 1 and 180),
  etapa text not null default 'novo' check (etapa in ('novo','contato','visita','proposta','fechado','perdido')),
  pessoa_id uuid references public.crm_esc_pessoas(id) on delete set null,
  imovel_id uuid references public.crm_esc_imoveis(id) on delete set null,
  valor numeric(14,2) check (valor is null or valor >= 0),
  origem text check (length(origem) <= 60),
  proxima_acao text check (length(proxima_acao) <= 240),
  proxima_acao_em timestamptz,
  motivo_perda text check (length(motivo_perda) <= 500),
  observacoes text check (length(observacoes) <= 4000),
  responsavel uuid references public.profiles(user_id) on delete set null,
  criado_por uuid references public.profiles(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  fechado_em timestamptz
);
create index if not exists crm_esc_negocios_espaco on public.crm_esc_negocios(espaco, etapa, atualizado_em desc);

create table if not exists public.crm_esc_agenda (
  id uuid primary key default gen_random_uuid(),
  espaco text not null,
  tipo text not null default 'visita' check (tipo in ('visita','reuniao','ligacao','tarefa','prazo','outro')),
  titulo text not null check (length(trim(titulo)) between 1 and 180),
  inicio timestamptz not null,
  fim timestamptz,
  dia_inteiro boolean not null default false,
  local text check (length(local) <= 240),
  pessoa_id uuid references public.crm_esc_pessoas(id) on delete set null,
  imovel_id uuid references public.crm_esc_imoveis(id) on delete set null,
  negocio_id uuid references public.crm_esc_negocios(id) on delete set null,
  status text not null default 'agendado' check (status in ('agendado','feito','cancelado')),
  observacoes text check (length(observacoes) <= 2000),
  responsavel uuid references public.profiles(user_id) on delete set null,
  criado_por uuid references public.profiles(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index if not exists crm_esc_agenda_espaco on public.crm_esc_agenda(espaco, inicio);

create table if not exists public.crm_esc_historico (
  id bigint generated always as identity primary key,
  espaco text not null,
  entidade text not null,
  entidade_id uuid not null,
  acao text not null,
  resumo text,
  autor uuid,
  criado_em timestamptz not null default now()
);
create index if not exists crm_esc_historico_espaco on public.crm_esc_historico(espaco, criado_em desc);
create index if not exists crm_esc_historico_entidade on public.crm_esc_historico(entidade_id, criado_em desc);

create table if not exists public.crm_esc_contadores (
  espaco text not null,
  prefixo text not null,
  ultimo integer not null default 0,
  primary key (espaco, prefixo)
);

-- ---------------------------------------------------------------- gatilhos
-- Antes de gravar: espaço e autor vêm da sessão; responsável precisa ser do
-- espaço; vínculos (pessoa, imóvel, negócio) precisam ser do mesmo espaço.
create or replace function public.crm_esc_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  chave text := public.crm_esc_chave();
  j jsonb;
  v_prefixo text;
  v_numero integer;
begin
  if chave is null then raise insufficient_privilege using message = 'CRM do escritório não liberado no plano desta conta.'; end if;
  if tg_op = 'INSERT' then
    new.espaco := chave;
    new.criado_por := auth.uid();
    new.criado_em := now();
    if new.responsavel is null then new.responsavel := auth.uid(); end if;
  else
    if old.espaco <> chave then raise insufficient_privilege; end if;
    new.espaco := old.espaco;
    new.criado_por := old.criado_por;
    new.criado_em := old.criado_em;
  end if;
  new.atualizado_em := now();
  if new.responsavel is not null and not exists(select 1 from public.crm_esc_membros() m where m.user_id = new.responsavel) then
    raise invalid_parameter_value using message = 'O responsável precisa ser da equipe deste escritório.';
  end if;
  j := to_jsonb(new);
  if (j ? 'pessoa_id') and j->>'pessoa_id' is not null and not exists(select 1 from public.crm_esc_pessoas where id = (j->>'pessoa_id')::uuid and espaco = chave)
     or (j ? 'proprietario_id') and j->>'proprietario_id' is not null and not exists(select 1 from public.crm_esc_pessoas where id = (j->>'proprietario_id')::uuid and espaco = chave)
     or (j ? 'imovel_id') and j->>'imovel_id' is not null and not exists(select 1 from public.crm_esc_imoveis where id = (j->>'imovel_id')::uuid and espaco = chave)
     or (j ? 'negocio_id') and j->>'negocio_id' is not null and not exists(select 1 from public.crm_esc_negocios where id = (j->>'negocio_id')::uuid and espaco = chave) then
    raise invalid_parameter_value using message = 'Vínculo com registro de outro escritório.';
  end if;
  -- código do imóvel por tipo, em sequência (como no CRM da Arini Negócios)
  if tg_table_name = 'crm_esc_imoveis' then
    if tg_op = 'INSERT' then
      v_prefixo := case new.tipo when 'casa' then 'CA' when 'apartamento' then 'AP' when 'terreno' then 'TE' when 'lote' then 'LO'
        when 'rural' then 'RU' when 'comercial' then 'CO' when 'galpao' then 'GA' when 'sala' then 'SA' else 'IM' end;
      insert into public.crm_esc_contadores(espaco, prefixo, ultimo) values (chave, v_prefixo, 1)
        on conflict (espaco, prefixo) do update set ultimo = public.crm_esc_contadores.ultimo + 1
        returning ultimo into v_numero;
      new.codigo := v_prefixo || '-' || lpad(v_numero::text, 4, '0');
    else
      new.codigo := old.codigo;
    end if;
  end if;
  if tg_table_name = 'crm_esc_negocios' then
    if new.etapa in ('fechado','perdido') then
      if tg_op = 'INSERT' then new.fechado_em := now();
      elsif old.etapa not in ('fechado','perdido') then new.fechado_em := now();
      end if;
    else
      new.fechado_em := null;
    end if;
  end if;
  return new;
end $$;

-- Depois de gravar: trilha de alterações do escritório.
create or replace function public.crm_esc_depois() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  antes jsonb;
  nome text;
  resumo text;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then antes := to_jsonb(old); end if;
  nome := coalesce(r->>'titulo', r->>'nome', r->>'codigo');
  if tg_table_name = 'crm_esc_imoveis' then nome := (r->>'codigo') || ' ' || nome; end if;
  if tg_op = 'INSERT' then resumo := 'Criado: ' || nome;
  elsif tg_op = 'DELETE' then resumo := 'Excluído: ' || nome;
  elsif (r ? 'etapa') and (antes->>'etapa') is distinct from (r->>'etapa') then
    resumo := nome || ': etapa ' || (antes->>'etapa') || ' → ' || (r->>'etapa');
  elsif (r ? 'status') and (antes->>'status') is distinct from (r->>'status') then
    resumo := nome || ': ' || (antes->>'status') || ' → ' || (r->>'status');
  elsif (r ? 'responsavel') and (antes->>'responsavel') is distinct from (r->>'responsavel') then
    resumo := nome || ': responsável alterado';
  else resumo := 'Alterado: ' || nome;
  end if;
  insert into public.crm_esc_historico(espaco, entidade, entidade_id, acao, resumo, autor)
    values (r->>'espaco', substr(tg_table_name, 9), (r->>'id')::uuid, lower(tg_op), left(resumo, 400), auth.uid());
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['crm_esc_pessoas','crm_esc_imoveis','crm_esc_negocios','crm_esc_agenda'] loop
    execute format('drop trigger if exists antes on public.%I', t);
    execute format('create trigger antes before insert or update on public.%I for each row execute function public.crm_esc_antes()', t);
    execute format('drop trigger if exists depois on public.%I', t);
    execute format('create trigger depois after insert or update or delete on public.%I for each row execute function public.crm_esc_depois()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists ler on public.%I', t);
    execute format('create policy ler on public.%I for select to authenticated using (espaco = (select public.crm_esc_chave()))', t);
    execute format('drop policy if exists incluir on public.%I', t);
    execute format('create policy incluir on public.%I for insert to authenticated with check ((select public.crm_esc_chave()) is not null)', t);
    execute format('drop policy if exists alterar on public.%I', t);
    execute format('create policy alterar on public.%I for update to authenticated using (espaco = (select public.crm_esc_chave())) with check (espaco = (select public.crm_esc_chave()))', t);
    -- excluir: quem criou, ou o administrador do escritório
    execute format('drop policy if exists excluir on public.%I', t);
    execute format('create policy excluir on public.%I for delete to authenticated using (espaco = (select public.crm_esc_chave()) and (criado_por = (select auth.uid()) or coalesce(((select public.crm_esc_espaco())->>''gestor'')::boolean, false)))', t);
  end loop;
end $$;

alter table public.crm_esc_historico enable row level security;
revoke all on public.crm_esc_historico from public, anon, authenticated;
grant select on public.crm_esc_historico to authenticated;
drop policy if exists ler on public.crm_esc_historico;
create policy ler on public.crm_esc_historico for select to authenticated using (espaco = (select public.crm_esc_chave()));

alter table public.crm_esc_contadores enable row level security;
revoke all on public.crm_esc_contadores from public, anon, authenticated;

-- ---------------------------------------------------------------- planos
-- Profissional e Premium ganham a equipe (carteira compartilhada da
-- organização); Premium ganha também a trilha de auditoria do escritório.
update public.plans set recursos = array(select distinct unnest(recursos || array['crm_equipe']))
 where id in ('corretor_profissional','corretor_premium','tecnico_profissional','tecnico_premium')
   and not ('crm_equipe' = any(recursos));
update public.plans set recursos = array(select distinct unnest(recursos || array['crm_auditoria']))
 where id in ('corretor_premium','tecnico_premium')
   and not ('crm_auditoria' = any(recursos));

notify pgrst, 'reload schema';
