-- 0154: o INCRA tirou do ar o acervofundiario.incra.gov.br (sem DNS desde
-- nov/2026; última sondagem boa em 08/10/2026). O SNCI (certificações até
-- 2013) não tem substituto público: o Geoportal do INCRA só publica o SIGEF
-- (geonode:sigef_geo, que já é a fonte da camada e do relatório SIGEF).
-- Desligar a fonte tira o SNCI da consulta/relatório (vai para "pendentes"),
-- da sondagem de saúde e do aviso de instabilidade. Para religar quando houver
-- endereço novo: update fontes_externas set ativa = true, sonda_url = '<novo>'.
update fontes_externas
   set ativa = false,
       observacao = 'Desligada em 19/11/2026: o INCRA desativou o acervofundiario.incra.gov.br e não há serviço público substituto para o SNCI. No Paraná a camada do mapa usa o espelho do IAT.'
 where id = 'snci';
