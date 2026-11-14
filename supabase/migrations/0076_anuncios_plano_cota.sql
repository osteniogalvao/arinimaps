-- Imóveis cadastrados pela Central podem aguardar a identificação do anunciante.
-- A API antiga preenchia o primeiro owner encontrado, inclusive de outra conta.
alter table public.properties add column if not exists responsavel_central boolean not null default false;
alter table public.properties drop constraint if exists chk_property_responsavel;
alter table public.properties add constraint chk_property_responsavel check (
  owner_id is not null or partner_id is not null or (responsavel_central and created_by is not null)
);

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
      where m.user_id = titular and m.status = 'ativo'
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
revoke all on function public.fn_verificar_cota_imovel() from public, anon, authenticated;

drop trigger if exists trg_cota_anuncio on public.properties;
create trigger trg_cota_anuncio before insert or update of status, owner_id, partner_id, responsavel_central, created_by on public.properties
  for each row execute function public.fn_verificar_cota_imovel();

-- Conclui o cadastro do empreendimento e suas unidades em uma transação.
create or replace function public.fn_enviar_cadastro_imoveis(p_criado_por uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare total integer;
begin
  if p_criado_por is null or coalesce(cardinality(p_ids), 0) not between 1 and 201 then
    raise exception 'Cadastro de imóveis inválido';
  end if;
  update public.properties set status = 'pendente'
    where id = any(p_ids) and created_by = p_criado_por and status = 'rascunho';
  get diagnostics total = row_count;
  if total <> cardinality(p_ids) then raise exception 'O cadastro mudou durante o envio'; end if;
end $$;
revoke all on function public.fn_enviar_cadastro_imoveis(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.fn_enviar_cadastro_imoveis(uuid, uuid[]) to service_role;
