# Auditoria do ARINI no celular (18/11/2026)

Pedido do Stenio depois do retorno do Carlos ("no mobile não tem funções direito e não está organizado").

## Como foi feita

- Base: produção (`arinibrasil.com.br`, main `1839e18`, já com o PR #42).
- Aparelhos simulados, em retrato: iPhone 13 (390 × 664 úteis) e Pixel 7 (412 × 839).
- Contas: visitante, conta grátis (`plano.consulta-basica`), proprietário (`plano.anunciante`), corretor (`plano.parceiro`) e Matriz (`admin`).
- Rotas: 16 públicas, 27 do painel/conta e 67 da Central (mais as do imóvel), cada uma com captura de tela, procura de rolagem lateral, botões pequenos e erros de JavaScript.
- Fluxos tocados no mapa: barra de botões, menu Mais, Camadas e Dados, clique numa área do CAR, lista "Buscar imóveis", Medir Área, Consultar Área (desenho e Concluir).

Resultado geral: nenhuma página rola de lado e a Central é usável no celular. O problema estava concentrado no **mapa**, que é a tela principal do produto, e em botões flutuantes que tampavam conteúdo.

## Achados e correções deste PR

| # | Onde | O que acontecia no celular | Correção |
|---|------|----------------------------|----------|
| 1 | Mapa: desenhar / medir / consultar | **Não funcionava.** A barra de botões (4 linhas) e o aviso do CAR cobriam o terço de cima; os toques caíam neles. Em produção, de 3 toques só 1 marcava ponto (iPhone e Android). Sobravam ~110 px de mapa para desenhar | Enquanto desenha, a barra, o aviso e a aba da lista saem da frente no celular |
| 2 | Mapa: barra de botões | 7 botões em 4 linhas, ~1/3 da tela | 2 linhas: "Não encontrei meu imóvel" + troca Satélite/Mapa; Camadas, Buscar e Mais. "Mosaico com menos nuvens" foi para o Mais |
| 3 | Mapa: ferramentas | Só ícones; o visitante via 4 cadeados sem nome | Nome curto embaixo de cada ícone (Área, Distância, Consultar, Importar, Imprimir, Foto) |
| 4 | Mapa: lista "Buscar imóveis" | Os botões do mapa ficavam por cima do campo de busca e dos filtros | Com a lista aberta, a barra sai da frente no celular |
| 5 | Mapa: créditos das fontes | Nascia aberto, uma faixa de texto de ~70 px sobre as ferramentas | Começa fechado no celular (o "i" abre) |
| 6 | Mapa: faixa de cotações (visitante) | Mais 40 px a menos de mapa | A faixa não aparece no mapa do celular (continua nas outras páginas) |
| 7 | Botão "Ajuda" (mapa, painel, Central) | Pílula flutuante tampava cartões, campos e selects | No celular vira só o "?"; no mapa fica abaixo dos cartões |
| 8 | Botão "Pergunte à Ari" (páginas públicas) | Tampava o campo de busca de /imoveis e textos | No celular a pílula diz só "Ari" |
| 9 | Painel do cliente (todas as páginas) | A capa "Olá, …" ocupava ~45 % da primeira tela; só cabiam 2 abas e a ativa podia ficar fora | Capa compacta no celular; a aba ativa rola para a vista e a borda indica que há mais abas |
| 10 | /balcao e /divulgador | Abriam sem cabeçalho nem menu: no celular a pessoa ficava presa | Passam a usar o cabeçalho e o rodapé do site |

Prints antes/depois: `docs/auditoria-mobile-2026-11-18/`.

## O que ficou de fora (depende de decisão ou de dado)

1. **Nenhum imóvel publicado.** Ficha, Tour 3D, relatório, espelho e financiamento do imóvel respondem 404 para todo mundo, inclusive a Matriz (os 39 estão inativos ou históricos). No celular isso aparece como "função que não existe". Não deu para auditar essas telas ao vivo; o Tour 3D no celular foi revisado no PR #42. Sugestão: publicar 1 imóvel de demonstração e repetir só essas telas.
2. **CRM do corretor de teste.** `plano.parceiro` está no plano antigo "Parceiro profissional", que não inclui `crm_privado`; por isso "Meu CRM" mostra "Confira se o seu plano…". Os planos `corretor_*` e `tecnico_*` incluem. Para testar o CRM no celular, trocar o plano da conta de teste.
3. **WhatsApp da Central** segue "Desconectado" (falta ler o QR em Central › WhatsApp › Conexão).
4. **Regiões**: a Central mostra 6 municípios no mapa. Conferir se são os 9 que o Carlos pediu.
5. **Erro de hidratação do React (#418)** em /mapa, /conta e /conta/seguranca (sem efeito visível; provável data/hora formatada diferente no servidor e no aparelho).
6. **Tabelas e quadros da Central** (Regiões, funis do CRM) rolam de lado dentro do próprio quadro. Funciona, mas a última coluna fica cortada até rolar.
7. Testes de toque real (gestos de pinça, teclado do iOS cobrindo campos) precisam de um aparelho físico; o simulador não reproduz.
