-- Catálogo paginado antes da seleção, histórico paginado depois dela.
alter table public.insumos_compras add column grupo text generated always as
  (coalesce('GTIN ' || gtin,regexp_replace(upper(trim(produto)),'[[:space:]]+',' ','g')) || ' | ' || unidade) stored;
create index insumos_compras_grupo on public.insumos_compras(titular,grupo,emissao desc);
create function public.fn_grupos_compra(p_titular uuid,p_busca text,p_pagina integer) returns table(grupo text,nome text,menor numeric)
language sql stable security definer set search_path='' as $$
  select c.grupo,min(c.produto)||' ('||min(c.unidade)||')',min(c.total/c.quantidade)
  from public.insumos_compras c where c.titular=p_titular and
    (coalesce(p_busca,'')='' or exists(select from public.insumos_compras f where f.titular=c.titular and f.grupo=c.grupo
       and (strpos(lower(f.produto),lower(left(p_busca,100)))>0 or f.gtin=p_busca)))
  group by c.grupo order by 2,c.grupo limit 51 offset 50*least(20000,greatest(0,p_pagina))
$$;
revoke all on function public.fn_grupos_compra(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.fn_grupos_compra(uuid,text,integer) to service_role;
