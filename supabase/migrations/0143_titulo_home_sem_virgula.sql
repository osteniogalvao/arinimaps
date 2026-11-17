-- Anexo B E22.02: o título aprovado é "Seu próximo negócio imobiliário começa no mapa",
-- sem vírgula. Só troca o valor se ele ainda for o padrão antigo; um texto
-- personalizado pela Diretoria no painel é preservado.
update public.settings
   set valor = to_jsonb('Seu próximo negócio imobiliário'::text), updated_at = now()
 where chave = 'hero_titulo'
   and valor #>> '{}' = 'Seu próximo negócio imobiliário,';
