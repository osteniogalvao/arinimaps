-- Anexo B E16.08: controle de armazenamento por conta, com limite por plano.
-- Soma o tamanho dos arquivos da conta nos buckets media e docs, pelo caminho
-- em que cada rota grava (avatars/<conta>, properties/<imóvel>, imoveis/<imóvel>,
-- cofre/<conta>, vinculos/<conta>, financiamento/<conta>). O limite vem da cota
-- "armazenamento_mb" do plano; sem plano, da configuração armazenamento_padrao_mb.
create or replace function public.armazenamento_usado(p_titular uuid)
returns bigint language sql stable security definer set search_path='' as $$
  with imoveis as (
    select p.id::text as id from public.properties p
     where p.owner_id in (select o.id from public.owners o where o.profile_id = p_titular)
        or p.partner_id in (select pa.id from public.partners pa where pa.profile_id = p_titular)
  )
  select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)::bigint
    from storage.objects o
   where (o.bucket_id = 'media' and (
            (split_part(o.name, '/', 1) = 'avatars' and split_part(o.name, '/', 2) = p_titular::text)
         or (split_part(o.name, '/', 1) = 'properties' and split_part(o.name, '/', 2) in (select id from imoveis))))
      or (o.bucket_id = 'docs' and (
            (split_part(o.name, '/', 1) in ('cofre', 'vinculos', 'financiamento') and split_part(o.name, '/', 2) = p_titular::text)
         or (split_part(o.name, '/', 1) = 'imoveis' and split_part(o.name, '/', 2) in (select id from imoveis))));
$$;
revoke all on function public.armazenamento_usado(uuid) from public, anon, authenticated;
grant execute on function public.armazenamento_usado(uuid) to service_role;

insert into public.settings (chave, valor) values ('armazenamento_padrao_mb', '500')
on conflict (chave) do nothing;
