# Piloto de previsão e avisos meteorológicos
Pedido 19 de Carlos, 16/11: planejar consultas e alertas. Região proposta: Iturama/MG. A referência é o município selecionado no mapa; não enviar o contorno privado da fazenda ao provedor para buscar uma previsão regional.

| Produto | Fonte e resolução de uso | Como aparecerá no piloto |
|---|---|---|
| Previsão do tempo | [NOAA/NCEP GFS](https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast), modelo global, grades de 0,25° disponíveis. Precipitação, vento e temperatura por ciclo. | Mostrar centro da célula, data do ciclo, horário válido, horizonte de 48 h e unidade; informar que a grade regional não mede a precipitação individual de um talhão. |
| Avisos oficiais no Brasil | [Avisos meteorológicos INMET](https://portal.inmet.gov.br/servicos/avisos-especiais), com municípios e período no [painel oficial](https://avisos.inmet.gov.br/). | Cor e texto de severidade publicados pelo órgão, validade local, área afetada, instruções e link ao original. Separar aviso oficial de previsão do modelo. |
| API NWS | O [serviço de avisos NWS](https://www.weather.gov/documentation/services-web-alerts) usa as áreas de emissão dos EUA. | Não tratar resposta vazia como ausência de risco no Brasil. Usar GFS como previsão e o emissor brasileiro para avisos. |

**Ingestão proposta:** buscar os ciclos GFS de seis em seis horas, recortar previamente o município e guardar ciclo/unidade. Para avisos, confirmar com o INMET o feed oficial autorizado para redistribuição comercial, limites e créditos; só então habilitar a rotina de 15 minutos. Guardar identificador do emissor, versão, validade e cancelamento. Mudança de severidade atualiza o mesmo aviso. Na indisponibilidade da origem, mostrar última consulta e hora, sem produzir um “tudo normal”.

**Teste de aceitação:** congelar amostras de um aviso que cruza o município, outro fora, um atualizado e um cancelado. Validar fuso, recorte, expiração, reprocessamento sem duplicar e ausência do provedor. Mensagem de demonstração: “Exemplo — Iturama/MG · [fenômeno e severidade do INMET] · válido de [hora] a [hora] · Ver aviso oficial”. Envio externo exige canal habilitado e inscrição do destinatário. Nenhum alerta real foi disparado por este planejamento.
