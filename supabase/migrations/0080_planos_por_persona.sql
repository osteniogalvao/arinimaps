-- Ofertas podem ser atribuídas pela Diretoria. Nenhuma conta troca de plano
-- na implantação. Os nichos padrão existentes continuam definidos pela Matriz.
alter table public.plans
  add column preco_anual_centavos integer check (preco_anual_centavos >= 0),
  add column primeiro_mes_centavos integer check (primeiro_mes_centavos >= 0);

with base as (
  select array['mapa','ficha_basica','interesse','camada_car','camada_lotes','ferramenta_medir','solicitacao_cartografica'] as comuns,
    array['camadas_oficiais','consulta_area','relatorio_territorial','ferramenta_kml','ferramenta_exportar'] as consulta,
    array['anunciar','oportunidades'] as anuncio
), ofertas(id, nome, mensal, anual, promocao, recursos, cotas, escopo) as (
  select v.* from base b cross join lateral (values
    ('proprietario_gratuito','Proprietário · Gratuito',0,null,null,b.comuns || b.anuncio,'{"propriedades_cofre":3}'::jsonb,'conta'),
    ('proprietario_monitoramento','Proprietário · Monitoramento',29.90,29900,null,b.comuns || b.anuncio || array['ferramenta_kml','historico_imovel'],'{"propriedades_cofre":3}'::jsonb,'conta'),
    ('proprietario_inteligencia','Proprietário · Inteligência',59.90,49900,4990,b.comuns || b.anuncio || array['ferramenta_kml','historico_imovel','relatorio_territorial','pre_avaliacao','chat_ia'],'{"propriedades_cofre":3}'::jsonb,'conta'),
    ('proprietario_completo','Proprietário · Completo',99.90,69900,6990,b.comuns || b.anuncio || array['ferramenta_kml','historico_imovel','relatorio_territorial','pre_avaliacao','chat_ia','ferramenta_exportar'],'{"propriedades_cofre":3}'::jsonb,'conta'),
    ('corretor_teste','Corretor · Teste de 3 dias',0,null,null,b.comuns || b.consulta || array['crm_privado'],'{}'::jsonb,'conta'),
    ('corretor_essencial','Corretor · Essencial',97,97000,null,b.comuns || b.consulta || b.anuncio || array['painel_parceiro','crm_privado'],'{}'::jsonb,'organizacao'),
    ('corretor_profissional','Corretor · Profissional',247,247000,null,b.comuns || b.consulta || b.anuncio || array['painel_parceiro','crm_privado','historico_imovel'],'{}'::jsonb,'organizacao'),
    ('corretor_premium','Corretor · Premium',497,497000,null,b.comuns || b.consulta || b.anuncio || array['painel_parceiro','crm_privado','historico_imovel'],'{}'::jsonb,'organizacao'),
    ('produtor_teste','Produtor · Teste de 3 dias',0,null,null,b.comuns || array['calculadora_insumos'],'{"propriedades_cofre":1}'::jsonb,'conta'),
    ('produtor_essencial','Produtor · Essencial',39.90,39900,null,b.comuns || array['calculadora_insumos','ferramenta_kml','ferramenta_exportar'],'{"propriedades_cofre":3}'::jsonb,'conta'),
    ('produtor_profissional','Produtor · Profissional',89.90,89900,null,b.comuns || array['calculadora_insumos','ferramenta_kml','ferramenta_exportar','relatorio_territorial'],'{"propriedades_cofre":5}'::jsonb,'conta'),
    ('produtor_premium','Produtor · Premium',169.90,169900,null,b.comuns || array['calculadora_insumos','ferramenta_kml','ferramenta_exportar','relatorio_territorial','historico_imovel'],'{"propriedades_cofre":10}'::jsonb,'conta'),
    ('tecnico_teste','Técnico · Teste de 3 dias',0,null,null,b.comuns || b.consulta,'{}'::jsonb,'conta'),
    ('tecnico_consulta','Consulta territorial',29.90,29900,null,b.comuns || b.consulta || array['pre_avaliacao'],'{}'::jsonb,'conta'),
    ('tecnico_essencial','Técnico · Essencial',79.90,79900,null,b.comuns || b.consulta || array['crm_privado','pre_avaliacao'],'{}'::jsonb,'organizacao'),
    ('tecnico_profissional','Técnico · Profissional',159.90,159900,null,b.comuns || b.consulta || array['crm_privado','crm_setorial','pre_avaliacao','historico_imovel'],'{}'::jsonb,'organizacao'),
    ('tecnico_premium','Técnico · Premium',329.90,329900,null,b.comuns || b.consulta || array['crm_privado','crm_setorial','pre_avaliacao','historico_imovel'],'{}'::jsonb,'organizacao')
  ) as v
)
insert into public.plans(id, nome, preco_mensal, preco_anual_centavos, primeiro_mes_centavos, recursos, cotas, periodicidade, escopo, ordem)
select id, nome, mensal, anual, promocao, recursos, cotas, case when mensal = 0 then 'gratis' else 'mensal' end,
  escopo, 100 + row_number() over(order by id)
from ofertas;
