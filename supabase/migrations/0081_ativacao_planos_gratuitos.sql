-- A data inicial fica preservada mesmo após sair do teste ou trocar de persona.
create table public.planos_testes_utilizados (
  titular_id uuid not null references public.profiles(user_id) on delete cascade on update cascade deferrable initially deferred,
  plano_id text not null check (plano_id in ('corretor_teste','produtor_teste','tecnico_teste')),
  iniciado_em timestamptz not null,
  primary key (titular_id, plano_id)
);
alter table public.planos_testes_utilizados enable row level security;
revoke all on public.planos_testes_utilizados from public, anon, authenticated;

-- Essas ofertas só são de autoativação enquanto gratuitas e de conta.
-- A demonstração técnica não recebe o CRM com dados reais.
alter table public.plans add constraint chk_teste_tecnico_demonstracao
  check (id <> 'tecnico_teste' or not (recursos && array['crm_privado','crm_setorial']));

create function public.fn_perfil_oferta_gratuita(plano text, papel text, nicho text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(case plano
    when 'corretor_teste' then nicho='corretor_imobiliaria' and papel in ('corretor','imobiliaria')
    when 'produtor_teste' then nicho='produtor_rural' and papel in ('consulta','proprietario')
    when 'tecnico_teste' then nicho='engenheiro' and papel='engenheiro'
    when 'proprietario_gratuito' then nicho='proprietario' and papel='proprietario'
    else false end, false);
$$;
revoke all on function public.fn_perfil_oferta_gratuita(text,text,text) from public, anon, authenticated;

-- Inclui atribuições da Diretoria. Um retry usa o mesmo relógio da primeira
-- atribuição. O gatilho roda após trg_profiles_plano, que resolve o plano padrão.
create function public.fn_validar_teste_atribuido() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inicio timestamptz;
begin
  if new.plan_id is null or new.plan_id not in ('corretor_teste','produtor_teste','tecnico_teste') then return new; end if;
  if not public.fn_perfil_oferta_gratuita(new.plan_id, new.role::text, new.nicho) then
    raise exception using errcode='P8101', message='O teste não corresponde ao perfil desta conta.';
  end if;
  insert into public.planos_testes_utilizados(titular_id, plano_id, iniciado_em)
    values (new.user_id, new.plan_id, now()) on conflict (titular_id, plano_id) do nothing;
  select t.iniciado_em into strict inicio from public.planos_testes_utilizados t
    where t.titular_id = new.user_id and t.plano_id = new.plan_id;
  new.plan_valido_ate := inicio + interval '72 hours';
  if new.plan_valido_ate <= now() and (tg_op='INSERT' or old.plan_id is distinct from new.plan_id) then
    raise exception using errcode='P8102', message='Esta conta já utilizou este teste.';
  end if;
  return new;
end $$;
revoke all on function public.fn_validar_teste_atribuido() from public, anon, authenticated;
create trigger trg_profiles_validar_teste before insert or update of role,nicho,plan_id,plan_valido_ate,plan_origem
  on public.profiles for each row execute function public.fn_validar_teste_atribuido();
alter table public.profiles add constraint chk_profiles_teste_com_validade
  check (plan_id not in ('corretor_teste','produtor_teste','tecnico_teste') or plan_valido_ate is not null) not valid;
-- A 0080 não atribui planos. Se a Diretoria já atribuiu um teste entre as
-- migrations, mantenha o vencimento anterior, limitado ao novo prazo.
insert into public.planos_testes_utilizados(titular_id,plano_id,iniciado_em)
  select user_id,plan_id,least(coalesce(plan_valido_ate,now()+interval '72 hours'),now()+interval '72 hours')-interval '72 hours'
  from public.profiles where plan_id in ('corretor_teste','produtor_teste','tecnico_teste')
  on conflict do nothing;
update public.profiles p set plan_valido_ate=t.iniciado_em + interval '72 hours'
  from public.planos_testes_utilizados t where t.titular_id=p.user_id and t.plano_id=p.plan_id;
alter table public.profiles validate constraint chk_profiles_teste_com_validade;

create function public.fn_ativar_plano_gratuito(p_titular uuid, p_plano text) returns jsonb
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
      where m.user_id=p_titular and m.status='ativo' and (o.plan_valido_ate is null or o.plan_valido_ate>=agora))
    or exists(select 1 from public.plan_subscriptions s where s.user_id=p_titular and s.status in ('ativa','pendente')) then
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
revoke all on function public.fn_ativar_plano_gratuito(uuid,text) from public, anon, authenticated;
grant execute on function public.fn_ativar_plano_gratuito(uuid,text) to service_role;
