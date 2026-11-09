-- Arini Imóveis Brasil — migration 0057: comissão padrão de 1,9%.
--
-- Revisão do Carlos (PDF "Revisão", seção 06): "Corrigir a comissão, para 1,9%".
-- Só troca o valor que ainda está no padrão antigo (1%). Se a Diretoria já
-- tiver gravado outro percentual no admin, ele é mantido.

update settings set valor = '1.9'::jsonb, updated_at = now()
 where chave = 'comissao_percentual_padrao' and (valor::text in ('1', '1.0', '1.00', '"1"', '"1.00"'));

update settings set valor = to_jsonb('1,9% sobre o valor da operação, conforme contrato de intermediação.'::text), updated_at = now()
 where chave = 'regra_comissao_texto' and valor::text like '"1\% sobre%';

-- base de conhecimento da Ari
update kb_artigos
   set conteudo = replace(conteudo, '**1% sobre o valor da operação**', '**1,9% sobre o valor da operação**'),
       fonte = replace(fonte, 'comissao_percentual_padrao = 1%', 'comissao_percentual_padrao = 1,9%'),
       updated_at = now()
 where slug = 'comissao-da-arini' and conteudo like '%**1\% sobre o valor da operação**%';

-- comissão nova (commissions.percentual, numeric(5,2) na 0001) nasce com 1,9%
alter table commissions alter column percentual set default 1.9;
