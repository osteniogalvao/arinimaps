-- Importação privada dos itens de compra: não conservamos chave de acesso, XML,
-- dados do destinatário ou documentos pessoais. Preço é o bruto do item menos desconto.
create table public.insumos_compras (
  titular uuid not null references public.profiles(user_id) on delete cascade,
  documento text not null check(documento ~ '^[a-f0-9]{64}$'), item integer not null check(item between 1 and 990),
  emissao date not null, fornecedor text not null check(length(fornecedor) between 1 and 160),
  produto text not null check(length(produto) between 1 and 160), gtin text check(gtin ~ '^([0-9]{8}|[0-9]{12,14})$'),
  unidade text not null check(length(unidade) between 1 and 8),
  quantidade numeric(18,4) not null check(quantidade>0), total numeric(18,2) not null check(total>=0),
  primary key(titular,documento,item)
);
create index insumos_compras_por_data on public.insumos_compras(titular,emissao desc);
alter table public.insumos_compras enable row level security;
revoke all on public.insumos_compras from public,anon,authenticated;
grant select,insert,delete on public.insumos_compras to service_role;
update public.plans set recursos=array_append(recursos,'comparador_insumos')
where id in ('produtor_profissional','produtor_premium') and not ('comparador_insumos'=any(recursos));
