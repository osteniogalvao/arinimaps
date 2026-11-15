-- Um cadastro novo só recebe automaticamente um plano pessoal gratuito.
create or replace function public.fn_profile_plano() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.nicho is null then new.nicho := public.fn_nicho_padrao(new.role); end if;
  if new.plan_origem = 'padrao' and new.nicho is not null and
      (tg_op='INSERT' or old.nicho is distinct from new.nicho or old.plan_origem is distinct from new.plan_origem) then
    if new.role in ('analista_arini','admin_central','franqueado') then
      new.plan_id := coalesce(public.fn_plano_padrao(new.nicho),new.plan_id);
    else
      select id into new.plan_id from public.plans where ativo and escopo='conta'
        and periodicidade='gratis' and coalesce(preco_mensal,0)=0 and coalesce(preco_anual_centavos,0)=0
        and new.nicho=any(nichos_padrao) and right(id,6)<>'_teste' order by ordem,id limit 1;
    end if;
  end if;
  return new;
end $$;

-- O espaço de CRM pertence à pessoa. Cada contato e seus atendimentos
-- pertencem ao contexto comercial em que o contato foi criado.
alter table public.crm_privado_contatos add column nicho text;
update public.crm_privado_contatos c set nicho=p.nicho
  from public.profiles p where p.user_id=c.titular_id and p.nicho in ('engenheiro','corretor_imobiliaria');
-- Contas antigas fora de ambos os contextos podem ter um registro técnico identificável.
update public.crm_privado_contatos c set nicho='engenheiro'
  where nicho is null and exists(select 1 from public.crm_privado_atendimentos a join public.crm_privado_servicos s
    on (s.titular_id,s.atendimento_id)=(a.titular_id,a.id) where (a.titular_id,a.contato_id)=(c.titular_id,c.id));
-- Sem atribuição comprovável, um registro legado fica reservado para revisão interna.
update public.crm_privado_contatos set nicho='revisao' where nicho is null;
alter table public.crm_privado_contatos alter column nicho set not null;

create policy contexto_contato on public.crm_privado_contatos as restrictive for select to authenticated using (
  nicho=(select p.nicho from public.profiles p where p.user_id=(select auth.uid()))
);
create policy contexto_atendimento on public.crm_privado_atendimentos as restrictive for select to authenticated using (
  exists(select 1 from public.crm_privado_contatos c where (c.titular_id,c.id)=(crm_privado_atendimentos.titular_id,crm_privado_atendimentos.contato_id))
);
create policy contexto_historico on public.crm_privado_historico as restrictive for select to authenticated using (
  exists(select 1 from public.crm_privado_atendimentos a where (a.titular_id,a.id)=(crm_privado_historico.titular_id,crm_privado_historico.atendimento_id))
);

create or replace function public.crm_privado_abrir(
  p_id uuid, p_contato_id uuid, p_nome text, p_email text, p_telefone text,
  p_assunto text, p_retorno date, p_nota text,
  p_modelo text default null, p_categoria text default null, p_campos jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare dono uuid := auth.uid(); contexto text; contato uuid := p_contato_id;
  modelo jsonb; configurado text; campo record; descritor jsonb; valor text; snapshot jsonb := '{}';
begin
  select nicho into contexto from public.profiles where user_id=dono for share;
  if not public.crm_privado_liberado() then raise insufficient_privilege; end if;
  if p_id is null or nullif(trim(p_assunto),'') is null or length(trim(p_assunto)) > 180
     or length(p_nota) > 2000 then raise invalid_parameter_value; end if;
  insert into public.crm_privado_espacos(titular_id) values(dono) on conflict do nothing;
  -- Serializa retries da mesma abertura. Chave idempotente é privada por titular.
  perform pg_advisory_xact_lock(hashtextextended(dono::text || p_id::text, 0));
  if exists(select 1 from public.crm_privado_atendimentos a join public.crm_privado_contatos c
    on (c.titular_id,c.id)=(a.titular_id,a.contato_id) where a.titular_id=dono and a.id=p_id and c.nicho=contexto)
    then return p_id; end if;
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
    insert into public.crm_privado_contatos(titular_id,nicho,nome,email,telefone)
      values(dono,contexto,trim(p_nome),nullif(trim(p_email),''),nullif(trim(p_telefone),'')) returning id into contato;
  elsif not exists(select 1 from public.crm_privado_contatos where titular_id = dono and id = contato and nicho=contexto)
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

create or replace function public.crm_privado_encaminhar(
  p_id uuid, p_versao integer, p_etapa text, p_retorno date, p_nota text
) returns integer language plpgsql security definer set search_path = '' as $$
declare dono uuid := auth.uid(); contexto text; anterior public.crm_privado_atendimentos%rowtype; seguinte integer;
begin
  select nicho into contexto from public.profiles where user_id=dono for share;
  if not public.crm_privado_liberado() then raise insufficient_privilege; end if;
  if p_etapa is null or p_etapa not in ('triagem','em_atendimento','aguardando_retorno','concluido')
    or p_versao is null or p_versao < 1 or length(p_nota) > 2000 then raise invalid_parameter_value; end if;
  select a.* into anterior from public.crm_privado_atendimentos a
    join public.crm_privado_contatos c on (c.titular_id,c.id)=(a.titular_id,a.contato_id)
    where a.titular_id=dono and a.id=p_id and c.nicho=contexto for update of a;
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

-- Os campos internos (autor, correção de cadastro, responsáveis) só são
-- consultados diretamente pela equipe e pelo anunciante. A ficha usa o RPC D1.
alter policy p_properties_read on public.properties using (public.fn_property_editable_id(id));

create or replace function public.fn_opp_visible(o public.opportunities)
returns boolean language sql stable security definer set search_path='' as $$
  select public.fn_is_arini() or exists (
    select 1 from public.profiles p where p.user_id=auth.uid() and p.ativo and (
      exists(select 1 from public.partners pa where pa.id in (o.responsavel_partner_id,o.partner_comprador_id)
        and pa.profile_id=p.user_id and pa.tipo::text=p.role::text)
      or (p.role='proprietario' and o.responsavel_tipo='proprietario' and exists(
        select 1 from public.properties im join public.owners ow on ow.id=im.owner_id
        where im.id=o.property_id and ow.profile_id=p.user_id))
    )
  );
$$;

-- A atribuição da franquia também exige os metadados administrativos.
create or replace function public.fn_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pedido text := coalesce(new.raw_app_meta_data->>'role', new.raw_user_meta_data->>'role');
  v_role user_role := 'comprador';
begin
  begin
    v_role := coalesce(v_pedido::user_role, 'comprador');
  exception when others then
    v_role := 'comprador';
  end;
  if v_role in ('admin_central', 'analista_arini','franqueado')
     and coalesce(new.raw_app_meta_data->>'role', '') <> v_role::text then
    v_role := 'comprador';
  end if;
  insert into public.profiles (user_id, nome, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), v_role)
  on conflict (user_id) do nothing;
  return new;
end $$;
