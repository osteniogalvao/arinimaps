# ARINI Maps — passagem para o Claude em 16/11/2026

**Comece pelo Anexo B consolidado.** O próximo passo de lançamento é homologar os 163 requisitos L0 com a Matriz, registrar a evidência por ID e levar as exceções a Carlos e Stênio. A meta comunicada por Carlos foi **18/11/2026 às 19h, horário de Brasília**. A decisão de abrir o acesso público continua com a ARINI. A última entrega funcional conferida é `d4d8c4b`. [Commit do mapa](https://github.com/osteniogalvao/arinimaps/commit/d4d8c4b35c9185af4a80424b0c0e9c364823f939) · [CI aprovado](https://github.com/osteniogalvao/arinimaps/actions/runs/43932374037)

## Onde está o material

O código está em `arini-maps/`. No computador de Stênio, a pasta que contém esse clone chama-se `ARINI MAP/`. Os nomes da tabela abaixo são relativos a essa **pasta pai**. Quem abrir apenas o GitHub encontrará este resumo, o código e os manuais em `docs/`. As planilhas de trabalho, gravações, contratos e provas de navegador ficam no computador de Stênio. Os originais entregues por WhatsApp estão também em Downloads.

| Arquivo ou pasta na área de trabalho | Para que serve |
|---|---|
| `ANEXO-B-CONSOLIDADO-ARINI-16-11.xlsx` e `ENTREGA-E-PENDENCIAS-16-11.md` | Controle de lançamento com as seis abas originais e a revisão consolidada. O relatório identifica responsáveis e critérios de aceite. |
| `EVOLUCAO-DO-ESCOPO-ARINI-16-11.md`, `ARQUITETURA.md` e o contrato de 08/10 | Comparação com a primeira versão funcional de agosto, anexos contratuais e apêndice de commits até `e0823e5`. A cronologia abaixo acrescenta os cinco commits seguintes. |
| `HISTORICO-E-PENDENCIAS-13-11.md`, `AUDITORIA-E-PENDENCIAS-14-11.md`, `ESCOPO-CENTRAL-CARLOS-13-11.md`, `SEGUNDA-ETAPA-Fases-e-estimativa-13-11.md` | Pedidos anteriores, revisão dos PRs, escopo adicional da Central e minuta da etapa de 29 itens. |
| `ENTREGA-DEZ-PERSONAS-15-11.md`, `ENTREGA-INTEGRACOES-CARLOS-15-11.md`, `ENTREGA-MIDIAS-CARLOS-15-11.md` | Dez HTMLs, matriz de 915 itens por dez personas, solicitações de desenvolvimento, vídeos, áudios e termos. Incluem os resultados e limites de cada ensaio. |
| `REVISAO-ARQUIVOS-CARLOS-16-11.md`, `COMPLEMENTO-50-REQUISITOS-16-11.md` | Cruzamento do Documento Mestre, Anexo B, PDF de 19 implementações e arquitetura da consulta rural. O consolidado incorpora as 50 linhas que faltavam na primeira revisão. |
| `REVISAO-VISUAL-PLANOS-16-11/index.html`, `ENSAIO-RECUPERACAO-16-11.md`, `TRIAGEM-ROTAS-16-11.md` | 120 capturas dos planos em desktop/celular, ensaio de recuperação e avaliação dos apontamentos de segurança. |
| `APRESENTACAO-CARLOS-16-11/Entrega dos áudios de 16 de novembro.md` | Os quatro áudios de 16/11 e a conferência de Campina Verde. Na mesma pasta estão os PDFs simples e completo, a apresentação narrada e o projeto editável. |
| `VIDEO-SAAS-ARINI/` e `qa-nuvens-sedes/` | Apresentação estilo SaaS em MP4 normal e leve. Na pasta de QA estão as imagens de origem, a comparação de Iturama, os scripts e as capturas das quatro cidades. |

## O que foi entregue desde a base

| Período e referência | Entrega |
|---|---|
| Agosto e outubro · `a489d7e` e contrato de 08/10 | Mapa urbano/rural, cadastro de imóveis, captação e funil, comissão, cobrança Asaas e base geográfica. O contrato de R$ 6.000 descreveu a operação da VPS e worker, cartografia, integrações, validações e treinamento. |
| Novembro · PRs 1, 3, 4, 5 a 9 integrados à main | Saída da Central, calibração em tela cheia, seleção e edição por peça/vértice, desenho e exclusão de lote, DXF/UTM, memorial e importação SHP/GeoJSON. A Central adicional de **R$ 3.000** inclui encaminhamentos com aceite, rodízio de leads, pós-visita, ranking, automações, alçadas, contabilidade, ponto offline, comunicação, IA, publicação multicanal e CRM configurável por setor. O escopo comercial da segunda etapa de 29 itens tem minuta própria. |
| 14–15/11 · `d55d1f4` a `e54b5cc` | Jornadas e preços por persona, cofre/CRM privado do titular, CRM por profissão, matriz 915×10, reservas, leilões, monitoramento, cotações, contratos, assinatura, mudanças de plano, cartão e NFS-e. Canais externos exigem homologação pelo titular. |
| 16/11 · `e0823e5` | Recorte urbano sobre o CAR, edição de grupos e comparação SIGEF, consulta ANM por interseção, relatórios/tour por área, privacidade do interessado, regras de exclusividade, pré-simulação de financiamento, comparação privada de NF-e do produtor, piloto fechado de divulgadores e novos controles da Central. |
| 16/11 · `d334018`, `deb785c`, `425f6b1` | Relatórios simples e técnico na ficha do CAR, incluindo imagens e lacunas das fontes. Calibração de até 300 mil exclusões, 100 mil correções e 500 mil vértices alterados por planta. Arquivados 40 anúncios de demonstração. Os indicadores e filas excluem as transações de teste, preservando o histórico. |
| 16/11 · `c237eb6` e `d4d8c4b` | Estabilização da fotografia durante o carregamento e redução das nuvens fotografadas pelo satélite em todo o Brasil. Validação descrita abaixo. |

## Decisões de Stênio e Carlos que continuam valendo

- **Planos do proprietário.** Monitoramento, Inteligência e Completo custam R$ 29,90, R$ 59,90 e R$ 99,90 por mês. No primeiro mês, Inteligência custa R$ 49,90 e Completo R$ 69,90. Os anuais são R$ 299, R$ 499 e **R$ 699**. O valor do Completo anual foi confirmado por Stênio. Acima de três imóveis, o adicional solicitado é R$ 15 por imóvel.
- **Públicos.** São dez jornadas documentadas por Carlos. A 11ª entrada é o piloto de divulgadores. Todas as personas podem consultar o catálogo principal de imóveis publicados. As permissões de documentos privados, dados de contato e ferramentas seguem o titular, o contexto e o plano. Corretor tem CRM de controle e atendimento. Produtor pode pedir orçamento de drone e agronomia via WhatsApp. Complementos de usuários, créditos de IA e atendimento devem ficar próximos aos planos.
- **Recebimento e comissão.** Stênio confirmou que a ARINI Imóveis pode receber pela ARINI Tecnologia. A regra comercial registrada é 1,9% e a parcela do captador de 0,5% está contida nesse total. A definição fiscal do emitente e os parâmetros da NFS-e continuam com a contabilidade.
- **Identidade e cartografia.** O produto chama-se ARINI e a assistente, Ari. Carlos indicou o Geomart como referência visual de cores e legibilidade. A legenda usa as camadas e a identidade do próprio sistema. O recorte de cartografia rural para implantação urbana é operação da Matriz.
- **Marketing e gravação.** A equipe confirmada foi a V4 Company. O registro local de entrega identifica `v4@arinibrasil.com.br` com perfil Diretoria (administrador master). Há também convite temporário para gravação da interface pública. O primeiro vídeo de 35 segundos precede a versão narrada. O pacote de apresentação já contém a versão narrada e o projeto editável. As credenciais permanecem no material privado de Stênio.
- **Rastreio.** Na navegação auditada nas dez personas, foram observados cookies próprios de funcionamento e serviços de mapas. Google Analytics, Google Ads e Meta Pixel não apareceram nesse ensaio. Reavaliar se a V4 instalar tags ou alterar o consentimento.

## Nuvens no mapa — comportamento publicado e verificação

Carlos descreveu uma nuvem **presente na fotografia**, cobrindo uma cidade. A troca ocorre por trecho da imagem em qualquer município. Na visão do país entra o panorama NASA Blue Marble. Na visão regional entra o mosaico anual Sentinel-2 de 2021. Ao aproximar, a base tenta conservar o detalhe. Se detectar uma concentração contínua de pixels claros, compara outra captura de alta resolução, seguida pelo mosaico quando necessário. Aceita a troca quando a alternativa tem dados utilizáveis e reduz a obstrução. Nuvens finas podem escapar. O mosaico histórico tem resolução de 10 m e mostra menos detalhe de telhados.

O botão **Mosaico com menos nuvens** fica ao lado de **Satélite** em `/mapa`. O navegador de produção exibiu e alternou as imagens em Manaus, Recife, Porto Alegre e Iturama. Em Iturama o ensaio reproduziu a imagem nublada real e observou a consulta automática à outra captura. No conjunto de 108 recortes, cinco acionaram a comparação e nos cinco houve alternativa com menos área clara. Essa contagem descreve a amostra. [Mapa de produção](https://arinibrasil.com.br/mapa)

Para repetir a regressão do código, executar `node --experimental-strip-types --test scripts/testa-satelite-nuvens.mjs`. Para repetir o ensaio no navegador na máquina de Stênio, executar na raiz do clone `node --env-file=.env.local ../qa-nuvens-sedes/verificar-nacional.cjs`. A evidência visual está em `qa-nuvens-sedes/painel-qa-nacional.jpg`. A escolha das fontes está em `public/vendor/fonte-satelite.mjs`; a detecção e a seleção da imagem ficam em `src/lib/map/coberturaNuvens.ts` e `src/lib/map/tileSatelite.ts`. O build padrão passou no CI e no Dokploy. Na máquina Windows, o Turbopack encontrou erro ao iniciar o subprocesso CSS e o build alternativo com webpack passou.

## Infraestrutura e banco

- Repositório privado `osteniogalvao/arinimaps`, branch `main`. O push que publicou `d4d8c4b` acionou o Dokploy com o GitHub privado. No painel, o serviço do domínio é **Arini Brasil → production → Arini App**. O serviço Hello World é a demonstração do assistente de instalação. O timer da VPS verifica a pasta `worker/` a cada dois minutos e atualiza o serviço quando seu conteúdo muda. [Procedimento de deploy](./DEPLOY-DOKPLOY.md)
- **Banco conferido em 16/11 durante esta passagem.** A consulta de leitura comparou os nomes de todos os **138 arquivos SQL** do clone com `_migrations` no Supabase. Todos constavam no registro, inclusive `0141_retirar_anuncios_demonstracao.sql` e `0142_indicadores_oficiais.sql`. Os lotes históricos 0056–0069 já estão incluídos. O push da aplicação e a aplicação de novas migrations são operações separadas.
- **Disponibilidade e segurança.** O domínio serve a aplicação publicada sob proteção de pré-lançamento na última conferência registrada. Os relatórios de backup validaram as partes do banco e os 19 objetos de armazenamento. Falta a restauração completa em pilha isolada com o aplicativo funcionando e tempos medidos. [Homologação](./HOMOLOGACAO.md) · [Backup](./BACKUP.md)

## Fila para o encerramento

O Anexo B consolidou **285 requisitos em 25 épicos**. São 163 L0, 88 F1, 23 F2 e 11 F3. A revisão de 16/11 marcou 170 parciais, 103 a verificar e 12 aguardando decisão. Esses números são o estado registrado na planilha antes das últimas entregas de mapa, relatórios e demonstração. Vincular as novas provas às linhas correspondentes antes de recalcular o saldo.

| Prioridade | Responsável | Próxima ação e prova esperada |
|---|---|---|
| 1 · Aceite L0 | Carlos, Stênio e líderes dos setores | Percorrer os fluxos com um imóvel urbano e um rural autorizados e contas separadas. Registrar por ID o cenário, resultado, evidência, responsável, data e eventual contingência aprovada. Testar a fluidez no aparelho e na rede do Carlos. Cadastrar os primeiros anúncios reais autorizados. |
| 2 · Cartografia | Cartografia e proprietários | Conferir perímetro de Iturama, pontos de controle, exclusões urbanas, matrículas disponíveis e licenças de uso das imagens e plantas. Segue pendente a importação privada DXF/raster vinculada a empreendimento em pré-lançamento. |
| 3 · Jurídico | Carlos e jurídico | Resolver a divergência entre os nomes do responsável técnico no quadro inicial e na assinatura do Termo de Exclusividade, com o mesmo CRECI. Stênio autorizou continuar o desenvolvimento. A versão corrigida continua a cargo do jurídico. Validar retenção de dados, modalidade do ponto, correspondente e contrato/remuneração do divulgador. |
| 4 · Cobrança, NFS-e e crédito | Financeiro, contabilidade, banco e comercial | Confirmar emitente, código de serviço municipal, retenções e habilitação de cartão. Homologar renovação, nota e estorno controlados. Para financiamento, confirmar tabela vigente, região, correspondente, suplência, consentimento e regra de reserva de R$ 290. [Operação Asaas](./ASAAS.md) |
| 5 · Conteúdo e canais | Marketing, V4 e titulares | Obter fotos autorizadas e direito comercial da fonte das cotações. Homologar uma publicação Meta, uma conversa oficial por WhatsApp e uma importação em portal parceiro. Confirmar aceite da apresentação e das imagens finais. |
| 6 · Operação | Infraestrutura e Matriz | Cronometrar restauração de banco e arquivos até o uso da aplicação, registrar RPO/RTO, conferir titularidade dos acessos e concluir revisão humana de segurança. Registrar a decisão formal sobre abertura pública. |
| 7 · Fases seguintes | Diretoria e desenvolvimento | Acordar escopo, preço e prazo da segunda etapa. Entre os itens em aberto estão kit automático de mídia do divulgador, antifraude avançada, notificações externas, liquidação fiscal e manejo de rebanho. Meteorologia tem estudo de piloto. [Piloto de divulgadores](./PILOTO-DIVULGADORES.md) · [Meteorologia](./PILOTO-METEOROLOGIA.md) |
