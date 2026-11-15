-- Cada série usa o índice (serie_id, data) para encontrar a observação mais recente.
-- O custo de listar o catálogo deixa de depender da extensão do histórico importado.
create or replace view public.cotacoes_ultimas with (security_invoker=true) as
  select s.id,s.slug,s.produto,s.nome,s.descricao,s.praca,s.uf,s.unidade,s.casas,
         s.fonte,s.url_fonte,s.destaque,s.ordem,s.atualizado_em,v.data,v.valor,v.variacao
  from public.cotacoes_series s
  cross join lateral (
    select h.data,h.valor,h.variacao
    from public.cotacoes_valores h
    where h.serie_id=s.id
    order by h.data desc limit 1
  ) v
  where s.ativa;
