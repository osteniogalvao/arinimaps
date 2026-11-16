-- Nome de apresentação do produto. Razões sociais, contratos já aceitos,
-- comprovantes e remetentes configurados conservam seus registros históricos.
update public.settings set valor=to_jsonb('ARINI'::text)
where chave='nome_sistema' and lower(trim(valor #>> '{}')) in ('arini maps','arini imóveis brasil');
