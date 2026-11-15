# Importação de cotações regionais

A Diretoria e o setor de Operações podem abrir **Central → Operações → Importar cotações regionais**. Cada arquivo contém observações de uma série. O código, o produto, a praça, a UF, a unidade e a fonte identificam a série nas próximas cargas.

1. Preencha a origem dos valores e a página pública do fornecedor. No campo de autorização, indique a licença, o contrato de publicação comercial ou o responsável pela coleta própria. O registro da autorização fica restrito à equipe.
2. Selecione um arquivo CSV UTF-8 ou cole os dados. Use o cabeçalho `data;valor`, datas `AAAA-MM-DD` e valores positivos com até quatro casas decimais. O limite por carga é de mil datas e 65 KB.
3. Abra a prévia e confira as quantidades de datas novas, correções e registros idênticos. A tabela mostra até doze datas e os valores anteriores. Editar qualquer campo exige uma nova prévia.
4. Confirme a autorização e clique em **Publicar esta importação**. O sistema rejeita a publicação se outro operador alterou os mesmos dados depois da prévia. Nesse caso, abra uma nova prévia para conferir as diferenças.
5. Consulte o histórico para ver o operador, a fonte, o arquivo e o valor anterior de cada data. A página pública passa a mostrar o indicador em **Mercado**. O histórico de preços e as variações usam as datas efetivamente informadas.

As séries importadas usam o prefixo `manual-`. O coletor automático pula esse prefixo. Para outra unidade, praça ou fonte, cadastre outro código. Somente os valores enviados e confirmados entram no catálogo público.

## Dados abertos de Santa Catarina

O worker consulta os arquivos oficiais da Epagri/Cepa. Usa o preço mais comum ao produtor na praça informada e atribui cada observação à data registrada na planilha diária ou semanal. A pesquisa de insumos e fatores de produção informa médias estaduais e o mês de referência. O catálogo apresenta essas médias por competência e identifica os valores provisórios. A Epagri publica as planilhas como dados abertos e define que qualquer pessoa pode utilizá-los, reutilizá-los e redistribuí-los livremente. [Planilhas oficiais](https://cepa.epagri.sc.gov.br/index.php/mercado-agricola/) e [glossário da Epagri](https://transparencia.epagri.sc.gov.br/?page_id=7811).

Para verificar a leitura pública sem gravar, execute `node scripts/coleta-cotacoes.mjs --fonte=epagri --historico --seco` na raiz do projeto. Para a primeira carga, retire `--seco` e use a conexão do banco de destino. O job periódico `coletar_cotacoes` inclui as mesmas planilhas. O filtro de fonte também pode ser usado no payload do job com `{"fonte":"epagri","historico":true}`.

As séries dessa fonte têm o prefixo `epagri-sc-` e preservam a unidade e a categoria do arquivo. Novilho para corte de 1 a 2 anos é medido em quilos no levantamento regional. As três classes de novilhas têm preço por cabeça no levantamento estadual de insumos. O arquivo de insumos é localizado no catálogo a cada execução, inclusive quando a Epagri altera o ano no nome do arquivo. Se uma planilha falhar na leitura, o worker relata a falha e conserva os preços anteriores com a referência original.

Os indicadores do CEPEA entram na publicação e na coleta automática após a Diretoria registrar a autorização comercial em **Configurações → Fontes de cotações**. A coleta de teste com `--seco` funciona sem acesso ao banco e utiliza as fontes habilitadas por padrão. [Licença do CEPEA](https://cepea.org.br/br/licenca-de-uso-de-dados.aspx)
