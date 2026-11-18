-- Pedido de 18/11/2026: visitante e conta gratuita veem só imóveis à venda.
-- Novo recurso `dados_terceiros` (src/lib/planos.ts): área, matrícula, quadro
-- ambiental e medidas de áreas do CAR e lotes SEM anúncio. Entra em todo plano
-- pago e nos testes de 3 dias dos planos pagos; fica de fora dos gratuitos.
-- A Diretoria muda depois em /admin/planos. A Matriz (equipe) vê tudo pelo papel.
-- Idempotente: rodar duas vezes não duplica o recurso.
update public.plans
   set recursos = array_append(recursos, 'dados_terceiros')
 where not ('dados_terceiros' = any(recursos))
   and (
     coalesce(preco_mensal, 0) > 0
     or coalesce(preco_anual_centavos, 0) > 0
     or periodicidade <> 'gratis'
     or id like '%\_teste' escape '\'
   );
