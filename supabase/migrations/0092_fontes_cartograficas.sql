update public.fontes_externas set
  tipo='wfs', endpoint='https://geoportal.incra.gov.br/geoserver/ows', camada='geonode:sigef_geo',
  sonda_url='https://geoportal.incra.gov.br/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=geonode:sigef_geo&resultType=hits&bbox=-50.21,-19.74,-50.19,-19.72,EPSG:4326',
  observacao='Geoportal nacional do INCRA. Parcelas com situação registrada ou certificada.',
  ficha=(ficha - 'situacao_sondagem' - 'sondado_em') || jsonb_build_object(
    'endereco_oficial','https://geoportal.incra.gov.br',
    'documentacao','https://geoportal.incra.gov.br/catalogue/#/dataset/1',
    'acesso','WFS nacional em GeoJSON, geonode:sigef_geo', 'limites','Consulta por envelope ou número, com limite por pedido',
    'licenca','O catálogo do Geoportal informa licença não especificada.',
    'campos','parcela_codigo, nome_area, status, natureza, codigo_imovel, data_aprovacao, registro_matricula, municipio_id')
where id='sigef';

insert into public.fontes_externas(id,nome,orgao,tipo,endpoint,camada,sonda_url,observacao)
values (
  'outorgas_federais','Outorgas federais de uso de águas superficiais','ANA / SNIRH','arcgis',
  'https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS/outorgas_federais_superficial/MapServer/4',
  'Outorgas Federais - Superficial',
  'https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS/outorgas_federais_superficial/MapServer/4/query?f=json&where=1%3D1&returnCountOnly=true',
  'Camada de pontos com município, ato e vigência informada pela ANA.'
),(
  'credito_rural','Glebas de operações de crédito rural','Banco Central / SICOR','importada',
  'https://www.bcb.gov.br/estabilidadefinanceira/tabelas-credito-rural-proagro','SICOR_GLEBAS_WKT',
  null,'Distribuição anual oficial importada por recorte geográfico. O mapa exibe ano e data da carga.'
)
on conflict (id) do update set endpoint=excluded.endpoint,camada=excluded.camada,
  sonda_url=excluded.sonda_url,observacao=excluded.observacao;

-- A camada foi migrada do acervo por UF para o novo catálogo nacional.
delete from public.camadas_celulas where camada='sigef';
