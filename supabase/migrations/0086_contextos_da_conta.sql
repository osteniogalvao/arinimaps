-- O perfil ativo segue em profiles também para as políticas RLS e os consumidores legados.
alter table public.profiles add column entrada_ativa text;
create table public.conta_contextos (
  titular uuid not null references public.profiles(user_id) on delete cascade,
  nicho text not null,
  papel public.user_role not null,
  plano text references public.plans(id),
  origem text not null,
  validade timestamptz,
  primary key (titular,nicho)
);
alter table public.conta_contextos enable row level security;
revoke all on public.conta_contextos from public, anon, authenticated;
grant select,insert,update,delete on public.conta_contextos to service_role;

create function public.fn_trocar_contexto(p_titular uuid,p_entrada text,p_aceite text)
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
      if destino in ('empresa_holding','ente_publico') then
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
revoke all on function public.fn_trocar_contexto(uuid,text,text) from public,anon,authenticated;
grant execute on function public.fn_trocar_contexto(uuid,text,text) to service_role;

-- As assinaturas e os vínculos existentes continuam no nicho no qual foram concedidos.
alter table public.organization_members add column nicho_vinculo text;
alter table public.plan_subscriptions add column nicho_vinculo text;
update public.organization_members m set nicho_vinculo=p.nicho from public.profiles p where p.user_id=m.user_id;
update public.plan_subscriptions s set nicho_vinculo=p.nicho from public.profiles p where p.user_id=s.user_id;
create function public.fn_nicho_do_vinculo() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.user_id is not null and (tg_op='INSERT' or old.user_id is distinct from new.user_id) then
    select p.nicho into new.nicho_vinculo from public.profiles p where p.user_id=new.user_id;
  end if;
  return new;
end $$;
revoke all on function public.fn_nicho_do_vinculo() from public,anon,authenticated;
create trigger trg_contexto_organizacao before insert or update of user_id on public.organization_members for each row execute function public.fn_nicho_do_vinculo();
create trigger trg_contexto_assinatura before insert or update of user_id on public.plan_subscriptions for each row execute function public.fn_nicho_do_vinculo();

create or replace function public.fn_property_editable_id(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.fn_is_arini() or exists (
    select 1 from public.properties p join public.profiles u on u.user_id=auth.uid() and u.ativo
    where p.id=pid and (u.role='proprietario' and exists(select 1 from public.owners o where o.id=p.owner_id and o.profile_id=u.user_id)
      or exists(select 1 from public.partners pa where pa.id=p.partner_id and pa.profile_id=u.user_id and pa.tipo::text=u.role::text)));
$$;
create or replace function public.fn_property_visible(p public.properties) returns boolean language sql stable security definer set search_path='' as $$
  select (auth.uid() is not null and p.status in ('publicado','em_negociacao')) or public.fn_property_editable_id(p.id);
$$;

create or replace function public.fn_verificar_cota_imovel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ativos constant text[] := array['pendente','em_analise','correcao','aprovado','publicado','em_negociacao'];
  titular uuid;
  situacao text;
  conta public.profiles%rowtype;
  plano public.plans%rowtype;
  limite numeric;
  usados integer;
begin
  if new.owner_id is null and new.partner_id is null then
    -- Atribuir um cadastro à Central exige um autor interno identificado.
    if not new.responsavel_central or not exists (
      select 1 from public.profiles p where p.user_id = new.created_by
        and p.role::text in ('admin_central','analista_arini')
    ) then
      raise exception using errcode = 'P7503', message = 'Informe o responsável pelo imóvel.';
    end if;
    return new;
  end if;

  if new.status::text <> all(ativos) then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status::text = any(ativos) and new.owner_id is not distinct from old.owner_id
       and new.partner_id is not distinct from old.partner_id then return new; end if;
  end if;

  -- Um anúncio intermediado é da carteira do parceiro, mesmo com proprietário identificado.
  if new.partner_id is not null then
    select p.profile_id, p.status::text into titular, situacao from public.partners p where p.id = new.partner_id;
    if situacao not in ('aprovado','ativo') then
      raise exception using errcode = 'P7503', message = 'O cadastro do parceiro precisa estar aprovado para anunciar.';
    end if;
  else
    select o.profile_id, o.status::text into titular, situacao from public.owners o where o.id = new.owner_id;
    if situacao not in ('solicitado','em_analise','pendente','aprovado','ativo') then
      raise exception using errcode = 'P7503', message = 'O cadastro do proprietário não permite anunciar.';
    end if;
  end if;

  -- O lock dura até o commit. A consulta abaixo, em READ COMMITTED, já vê o
  -- último envio que ganhou a disputa e as unidades anteriores deste envio.
  select * into conta from public.profiles where user_id = titular for update;
  if not found or not conta.ativo
    or conta.role::text not in ('proprietario','corretor','imobiliaria','leiloeiro','franqueado')
    or coalesce(conta.nicho, '') in ('engenheiro','ente_publico','comprador_investidor','consulta') then
    raise exception using errcode = 'P7503', message = 'O perfil do responsável não permite cadastrar anúncios.';
  end if;
  if coalesce(conta.plan_origem,'padrao') = 'padrao' then
    select pl.* into plano from public.organization_members m
      join public.organizations org on org.id = m.org_id and org.ativo
      join public.plans pl on pl.id = org.plan_id and pl.ativo and pl.escopo = 'organizacao'
      where m.user_id = titular and m.nicho_vinculo is not distinct from conta.nicho and m.status = 'ativo'
        and (org.plan_valido_ate is null or org.plan_valido_ate >= now());
  end if;
  if plano.id is null and (conta.plan_valido_ate is null or conta.plan_valido_ate >= now()) then
    select * into plano from public.plans where id = conta.plan_id and ativo;
  end if;
  if plano.id is null or not ('anunciar' = any(plano.recursos)) then
    raise exception using errcode = 'P7501', message = 'O plano ativo do responsável não inclui anúncios.';
  end if;
  limite := (plano.cotas->>'imoveis_ativos')::numeric;
  if limite is null then return new; end if;
  select count(*) into usados from public.properties im
    where im.status::text = any(ativos) and im.id <> new.id
      and (im.partner_id in (select p.id from public.partners p where p.profile_id = titular)
        or (im.partner_id is null and im.owner_id in (select o.id from public.owners o where o.profile_id = titular)));
  if usados >= limite then
    raise exception using errcode = 'P7502', message = format('O limite do plano é de %s imóveis ativos. Reduza a quantidade do envio ou amplie o plano.', limite);
  end if;
  return new;
end $$;

create or replace function public.crm_privado_recursos() returns text[]
language sql stable security definer set search_path = '' as $$
    select coalesce(org.recursos, pessoal.recursos) from public.profiles p
    left join public.plans pessoal on pessoal.id = p.plan_id and pessoal.ativo
      and (p.plan_valido_ate is null or p.plan_valido_ate >= now())
    left join lateral (
      select plano.id, plano.recursos from public.organization_members m
      join public.organizations o on o.id = m.org_id and o.ativo
      join public.plans plano on plano.id = o.plan_id and plano.ativo and plano.escopo = 'organizacao'
      where m.user_id = p.user_id and m.nicho_vinculo is not distinct from p.nicho and m.status = 'ativo'
        and (o.plan_valido_ate is null or o.plan_valido_ate >= now())
    ) org on p.plan_origem = 'padrao'
    where p.user_id = (select auth.uid()) and p.ativo
      and p.role not in ('admin_central','analista_arini')
      and p.nicho in ('corretor_imobiliaria','engenheiro')
      and ((auth.jwt()->>'aal') = 'aal2' or not exists (
        select 1 from auth.mfa_factors f where f.user_id = p.user_id and f.status = 'verified'
      ));
$$;

create or replace function public.cofre_limite(p_titular uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  with efetivo as (
    select coalesce(org.cotas,pessoal.cotas)->>'propriedades_cofre' as vagas
    from public.profiles p
    left join public.plans pessoal on pessoal.id=p.plan_id and pessoal.ativo and (p.plan_valido_ate is null or p.plan_valido_ate >= now())
    left join lateral (
      select plano.cotas from public.organization_members m join public.organizations o on o.id=m.org_id
      join public.plans plano on plano.id=o.plan_id and plano.ativo and plano.escopo='organizacao'
      where m.user_id=p.user_id and m.nicho_vinculo is not distinct from p.nicho and m.status='ativo' and o.ativo and (o.plan_valido_ate is null or o.plan_valido_ate >= now())
    ) org on p.plan_origem='padrao' where p.user_id=p_titular
  )
  select coalesce((select case when vagas ~ '^[0-9]{1,9}$' then vagas::int end from efetivo),3)
       + coalesce((select sum(quantidade) from public.cofre_concessoes where titular_id=p_titular),0);
$$;

create or replace function public.fn_ativar_plano_gratuito(p_titular uuid, p_plano text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  conta public.profiles%rowtype;
  agora timestamptz := now();
  vence timestamptz;
begin
  select * into conta from public.profiles where user_id=p_titular for update;
  if not found or conta.ativo is not true or not public.fn_perfil_oferta_gratuita(p_plano,conta.role::text,conta.nicho) then
    raise exception using errcode='P8101', message='Este plano exige o perfil correspondente na sua conta.';
  end if;
  if not exists(select 1 from public.plans pl where pl.id=p_plano and pl.ativo and pl.escopo='conta'
      and pl.periodicidade='gratis' and pl.preco_mensal=0 and coalesce(pl.preco_anual_centavos,0)=0
      and coalesce(pl.primeiro_mes_centavos,0)=0) then
    raise exception using errcode='P8104', message='Este plano está indisponível para ativação gratuita.';
  end if;
  if exists(select 1 from public.organization_members m
      join public.organizations o on o.id=m.org_id and o.ativo
      join public.plans pl on pl.id=o.plan_id and pl.escopo='organizacao' and pl.ativo
      where m.user_id=p_titular and m.nicho_vinculo is not distinct from conta.nicho and m.status='ativo' and (o.plan_valido_ate is null or o.plan_valido_ate>=agora))
    or exists(select 1 from public.plan_subscriptions s where s.user_id=p_titular and s.nicho_vinculo is not distinct from conta.nicho and s.status in ('ativa','pendente')) then
    raise exception using errcode='P8103', message='Sua conta já possui uma assinatura ou plano de organização. Fale com a Central.';
  end if;
  if conta.plan_id=p_plano then
    if conta.plan_valido_ate is null or conta.plan_valido_ate>agora then
      return jsonb_build_object('planoId',p_plano,'validoAte',conta.plan_valido_ate,'jaAtivo',true);
    end if;
    if p_plano <> 'proprietario_gratuito' then
      raise exception using errcode='P8102', message='Esta conta já utilizou este teste.';
    end if;
  end if;
  if conta.plan_origem <> 'padrao' or exists(select 1 from public.plans pl where pl.id=conta.plan_id and pl.ativo
        and (conta.plan_valido_ate is null or conta.plan_valido_ate>agora)
        and (pl.preco_mensal>0 or pl.preco_anual_centavos>0 or pl.primeiro_mes_centavos>0)) then
    raise exception using errcode='P8103', message='O plano atual é pago ou foi definido pela Central. Fale com a equipe para alterá-lo.';
  end if;
  -- Atualizar somente estas duas colunas mantém a precedência da organização.
  -- O gatilho legado de papel/nicho/origem não substitui a escolha pelo padrão.
  update public.profiles set plan_id=p_plano, plan_valido_ate=null where user_id=p_titular
    returning plan_valido_ate into vence;
  return jsonb_build_object('planoId',p_plano,'validoAte',vence,'jaAtivo',false);
end $$;
