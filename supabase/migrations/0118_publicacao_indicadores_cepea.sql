-- A licença pública do CEPEA é não comercial. A Diretoria registra a autorização
-- da ARINI antes de habilitar estes indicadores no catálogo e no coletor.
create function public.cotacoes_cepea_autorizado() returns boolean
language sql stable security definer set search_path='' as $$
  select exists (select from public.settings where chave='cotacoes_cepea_autorizado' and valor='true'::jsonb);
$$;
revoke all on function public.cotacoes_cepea_autorizado() from public;
grant execute on function public.cotacoes_cepea_autorizado() to anon,authenticated,service_role;

alter policy p_cotacoes_series_leitura on public.cotacoes_series
  using (ativa and (slug not like 'cepea-%' or (select public.cotacoes_cepea_autorizado())));
-- A política de cotacoes_valores já consulta cotacoes_series sob a RLS do usuário.
-- A view é usada também pelo backend service_role, para o qual a RLS não se aplica.
create or replace view public.cotacoes_ultimas with (security_invoker=true) as
  select s.id,s.slug,s.produto,s.nome,s.descricao,s.praca,s.uf,s.unidade,s.casas,
         s.fonte,s.url_fonte,s.destaque,s.ordem,s.atualizado_em,v.data,v.valor,v.variacao
  from public.cotacoes_series s
  cross join lateral (
    select h.data,h.valor,h.variacao from public.cotacoes_valores h
    where h.serie_id=s.id order by h.data desc limit 1
  ) v
  where s.ativa and (s.slug not like 'cepea-%' or (select public.cotacoes_cepea_autorizado()));
