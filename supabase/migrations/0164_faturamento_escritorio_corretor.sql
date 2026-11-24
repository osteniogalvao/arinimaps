-- A contratação direta de 0155 passou a aceitar escritórios de corretores.
-- A validação de 0099, anterior a esse fluxo, exigia um engenheiro aprovado
-- para qualquer organização e cancelava a assinatura do corretor no aceite,
-- antes de criar a primeira fatura. Mantém a aprovação no escopo técnico.
create or replace function public.assinatura_pode_faturar(s public.assinaturas_cotadas) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.plans pl on pl.id=s.plano and pl.ativo
 left join public.conta_contextos c on c.titular=p.user_id and c.nicho=s.nicho
 where p.user_id=s.titular and p.ativo and (s.org is null and (
   case when p.nicho=s.nicho then p.plan_id else c.plano end is not distinct from case when s.concedido_ate is null then s.anterior else s.plano end
   and case when p.nicho=s.nicho then p.plan_origem else c.origem end is not distinct from case when s.concedido_ate is null then s.origem_anterior else 'assinatura' end
   and case when p.nicho=s.nicho then p.plan_valido_ate else c.validade end is not distinct from coalesce(s.concedido_ate,s.validade_anterior))
 or s.org is not null and exists(select from public.organization_members m join public.organizations o on o.id=m.org_id and o.ativo
   where m.org_id=s.org and m.user_id=s.titular and m.status='ativo' and m.papel_org='admin' and m.nicho_vinculo=s.nicho
   and o.plan_id is not distinct from case when s.concedido_ate is null then s.anterior else s.plano end
   and o.plan_valido_ate is not distinct from coalesce(s.concedido_ate,s.validade_anterior)
   and (s.nicho='corretor_imobiliaria' or s.nicho='engenheiro' and exists(
     select from public.partners where profile_id=s.titular and tipo='engenheiro' and status in ('ativo','aprovado'))))));
$$;
revoke all on function public.assinatura_pode_faturar(public.assinaturas_cotadas) from public,anon,authenticated;
