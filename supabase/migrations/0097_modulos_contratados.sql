-- O interesse comercial não concede acesso. A Diretoria registra o contrato e o território.
create table public.org_modulos_contratados (
  org_id uuid not null references public.organizations(id) on delete cascade,
  modulo text not null check (modulo in ('balcao','safras')),
  territorio text not null check (length(trim(territorio)) between 1 and 200),
  referencia text not null check (length(trim(referencia)) between 1 and 200),
  ativo boolean not null,
  revisao integer not null default 1,
  atualizado_em timestamptz not null default now(),
  primary key(org_id,modulo)
);
alter table public.org_modulos_contratados enable row level security;
revoke all on public.org_modulos_contratados from public,anon,authenticated;
grant select on public.org_modulos_contratados to service_role;

create function public.org_contexto_contratado(p_titular uuid,p_modulo text)
returns uuid language sql stable security definer set search_path='' as $$
  select o.id from public.organization_members m
    join public.organizations o on o.id=m.org_id and o.ativo
    join public.plans pl on pl.id=o.plan_id and pl.ativo and pl.escopo='organizacao'
    join public.org_modulos_contratados c on c.org_id=o.id and c.ativo and c.modulo=p_modulo
    join public.profiles p on p.user_id=m.user_id and p.ativo
    where m.user_id=p_titular and m.status='ativo' and (o.plan_valido_ate is null or o.plan_valido_ate>now())
      and ((p_modulo='balcao' and o.tipo='ente_publico') or (p_modulo='safras' and o.tipo in ('empresa','holding')))
    limit 1;
$$;

create function public.org_modulo_atual(p_titular uuid,p_modulo text)
returns uuid language sql stable security definer set search_path='' as $$
  select public.org_contexto_contratado(p_titular,p_modulo) from public.profiles p
    where p.user_id=p_titular and p.ativo and p.role not in ('admin_central','analista_arini','franqueado')
    and p.nicho=case p_modulo when 'balcao' then 'ente_publico' when 'safras' then 'empresa_holding' end;
$$;

create function public.org_configurar_contrato(p_ator uuid,p_org uuid,p_modulo text,p_territorio text,p_referencia text,p_ativo boolean,p_revisao integer)
returns void language plpgsql security definer set search_path='' as $$
declare o public.organizations%rowtype; anterior public.org_modulos_contratados%rowtype; proximo public.org_modulos_contratados%rowtype;
begin
  if not exists(select 1 from public.profiles where user_id=p_ator and ativo and role='admin_central') then raise insufficient_privilege; end if;
  select * into strict o from public.organizations where id=p_org for update;
  if not ((p_modulo='balcao' and o.tipo='ente_publico') or (p_modulo='safras' and o.tipo in ('empresa','holding'))) then raise invalid_parameter_value; end if;
  if p_ativo and (not o.ativo or o.plan_valido_ate<=now() or not exists(select 1 from public.plans where id=o.plan_id and ativo and escopo='organizacao')) then
    raise exception using errcode='P9701',message='Atribua um plano de organização vigente antes de ativar o módulo.';
  end if;
  if p_ativo and nullif(trim(o.cnpj),'') is null then
    raise exception using errcode='P9701',message='Informe o CNPJ da organização antes de ativar o contrato.';
  end if;
  select * into anterior from public.org_modulos_contratados where org_id=p_org and modulo=p_modulo;
  if coalesce(anterior.revisao,0) is distinct from p_revisao then raise serialization_failure; end if;
  insert into public.org_modulos_contratados(org_id,modulo,territorio,referencia,ativo)
    values(p_org,p_modulo,trim(p_territorio),trim(p_referencia),p_ativo)
    on conflict(org_id,modulo) do update set territorio=excluded.territorio,referencia=excluded.referencia,
      ativo=excluded.ativo,revisao=org_modulos_contratados.revisao+1,atualizado_em=now()
    returning * into proximo;
  if p_ativo then
    update public.organization_members set nicho_vinculo=case p_modulo when 'balcao' then 'ente_publico' else 'empresa_holding' end
      where org_id=p_org and status='ativo';
  end if;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois)
    values(p_ator,'modulo_contratado','organizations',p_org,to_jsonb(anterior),to_jsonb(proximo));
end $$;
revoke all on function public.org_contexto_contratado(uuid,text),public.org_modulo_atual(uuid,text),
  public.org_configurar_contrato(uuid,uuid,text,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.org_contexto_contratado(uuid,text),public.org_modulo_atual(uuid,text),
  public.org_configurar_contrato(uuid,uuid,text,text,text,boolean,integer) to service_role;

create or replace function public.fn_trocar_contexto(p_titular uuid,p_entrada text,p_aceite text)
returns void language plpgsql security definer set search_path='' as $$
declare
  atual public.profiles%rowtype;
  salvo public.conta_contextos%rowtype;
  destino text;
  papel public.user_role;
  plano text;
begin
  select * into strict atual from public.profiles where user_id=p_titular for update;
  if not atual.ativo or atual.role in ('admin_central','analista_arini','franqueado') then
    raise exception using errcode='P8601',message='Este acesso é atribuído pela Central.';
  end if;
  select v.n,v.r::public.user_role into destino,papel from (values
    ('vender','proprietario','proprietario'),('anunciar','proprietario','proprietario'),
    ('produtor','produtor_rural','proprietario'),('corretor','corretor_imobiliaria','corretor'),
    ('comprar','comprador_investidor','comprador'),('tecnico','engenheiro','engenheiro'),
    ('leiloeiro','leiloeiro','leiloeiro'),('correspondente','correspondente_bancario','consulta'),
    ('consultar','consulta','consulta'),('instituicao','ente_publico','consulta'),('empresa','empresa_holding','consulta')
  ) v(e,n,r) where v.e=p_entrada;
  if destino is null then raise exception using errcode='P8602',message='Entrada inválida.'; end if;
  if atual.nicho is distinct from destino then
    if atual.nicho is not null then
      insert into public.conta_contextos values(p_titular,atual.nicho,atual.role,atual.plan_id,atual.plan_origem,atual.plan_valido_ate)
      on conflict(titular,nicho) do update set papel=excluded.papel, plano=excluded.plano,origem=excluded.origem,validade=excluded.validade;
    end if;
    select * into salvo from public.conta_contextos where titular=p_titular and nicho=destino;
    if found then
      papel:=salvo.papel;
      plano:=salvo.plano;
      if salvo.validade <= now() and plano like '%\_teste' then
        plano:=null; salvo.validade:=null; salvo.origem:='padrao';
      end if;
    else
      if destino in ('empresa_holding','ente_publico') and public.org_contexto_contratado(p_titular,case destino when 'ente_publico' then 'balcao' else 'safras' end) is null then
        raise exception using errcode='P8601',message='Solicite o acesso institucional à Central.';
      end if;
      if papel in ('corretor','engenheiro','leiloeiro') then
        if nullif(p_aceite,'') is null then raise exception using errcode='P8601',message='Leia e aceite os termos de parceria.'; end if;
        if not exists(select 1 from public.partners where profile_id=p_titular and tipo::text=papel::text) then
          insert into public.partners(profile_id,tipo,razao_social,aceite_termos_at,aceite_termos_versao)
            values(p_titular,papel::text::public.partner_type,atual.nome,now(),p_aceite);
        end if;
      elsif papel='proprietario' and not exists(select 1 from public.owners where profile_id=p_titular) then
        insert into public.owners(profile_id,aceite_termos_at,aceite_termos_versao) values(p_titular,now(),atual.aceite_termos_versao);
      end if;
      -- Um novo contexto não inicia teste nem herda um plano pago.
      select pl.id into plano from public.plans pl where pl.ativo and pl.escopo='conta'
        and destino=any(pl.nichos_padrao) and pl.periodicidade='gratis' and pl.preco_mensal=0
        and coalesce(pl.preco_anual_centavos,0)=0 and pl.id not like '%\_teste' order by pl.ordem,pl.id limit 1;
    end if;
    -- O gatilho legado atribui o padrão na mudança do nicho. A segunda escrita
    -- reinstala o plano exato no mesmo lock, sem reiniciar o relógio de testes.
    update public.profiles set role=papel,nicho=destino,entrada_ativa=p_entrada,plan_origem=coalesce(salvo.origem,'padrao'),plan_id=null,plan_valido_ate=null
      where user_id=p_titular;
    update public.profiles set plan_id=plano,plan_valido_ate=salvo.validade where user_id=p_titular;
  else
    update public.profiles set entrada_ativa=p_entrada where user_id=p_titular;
  end if;
  if atual.entrada_ativa is distinct from p_entrada then
    insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois)
      values(p_titular,'contexto_selecionado','profiles',p_titular,jsonb_build_object('nicho',atual.nicho,'entrada',atual.entrada_ativa),
        jsonb_build_object('nicho',destino,'entrada',p_entrada,'termos',p_aceite));
  end if;
end $$;

-- Convites aceitos depois da implantação também recebem o plano no perfil contratado.
create function public.org_nicho_contratado_vinculo() returns trigger language plpgsql security definer set search_path='' as $$
declare destino text;
begin
  if new.status='ativo' then
    select case c.modulo when 'balcao' then 'ente_publico' else 'empresa_holding' end into destino
      from public.org_modulos_contratados c join public.organizations o on o.id=c.org_id
      where c.org_id=new.org_id and c.ativo and o.ativo and
        (o.tipo='ente_publico' and c.modulo='balcao' or o.tipo in ('empresa','holding') and c.modulo='safras') limit 1;
    new.nicho_vinculo:=coalesce(destino,new.nicho_vinculo);
  end if;
  return new;
end $$;
revoke all on function public.org_nicho_contratado_vinculo() from public,anon,authenticated;
create trigger trg_perfil_contratado before insert or update of status,user_id,org_id on public.organization_members
  for each row execute function public.org_nicho_contratado_vinculo();
