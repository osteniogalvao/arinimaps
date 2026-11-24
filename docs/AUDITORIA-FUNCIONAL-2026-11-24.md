# Auditoria funcional ARINI — 24/11/2026

Esta rodada executa funcionalidades reais em ambiente isolado, além da pesquisa anterior de compradores simulados. A pesquisa `founder-consumer` não foi contada como teste de software. O documento **ARINI Matriz: Estrutura dos CRMs por Setor** também foi confrontado com o código; o detalhamento está em [AUDITORIA-CRM-SETOR-2026-11-24.md](AUDITORIA-CRM-SETOR-2026-11-24.md).

## Ambiente e método

Aplicação Next em build de produção, Supabase Auth/PostgREST/Storage/PostgreSQL reais e contas sintéticas. Cobranças usam servidor Asaas simulado; mensagens ficam no ambiente de teste. Nenhuma compra real nem mensagem a clientes foi usada para homologação. As consultas públicas de mapas podem acessar fontes externas.

As credenciais, fatores TOTP, banco e relatórios detalhados ficam fora do Git, em `../auditoria-funcional-2026-11-24/`. Scripts reproduzíveis ficam em `scripts/qa/` e recusam produção. Banco SQL de regressão também é efêmero.

## Resultados comprovados

| Verificação | Resultado e limite |
|---|---|
| 100 contas, dez personas, dez contas por persona | **1.920/1.920 assertivas aprovadas**. Jornada HTTP com Auth, aplicação e RLS reais; concorrência quatro. Não são 100 navegadores simultâneos nem teste de carga. Cadastros iniciais são fixtures AuthAdmin. |
| Retomada do lote | 86 contas aprovadas antes da última integração; 14 jornadas concluídas/repetidas na build integrada. Tentativas afetadas pelo reload do PostgREST foram preservadas e repetidas com os mesmos IDs. |
| Contratação e uso | 51 verificações HTTP de proprietário, corretor/organização e contratação por proposta; mais 22 verificações de jornada navegável. Cadastro, login, aceite, fatura, Pix simulado, liberação, cofre, cancelamento e estorno. |
| Chat e ponto | **42/42** verificações HTTP finais: privacidade de conversas, escopo setorial, PIN, identidade do operador, limite de tentativas, concorrência, idempotência, hash e RLS. |
| Navegação | 118 rotas estáticas. 31 rotas dinâmicas ficaram fora desta varredura automática; algumas foram exercitadas nas jornadas específicas. Abrir uma tela não equivale a testar todos os seus botões. |
| Regressões desta rodada | **41/41**, sem skips: handlers reais com dependências controladas, SQL transacional, concorrência, autorização, MFA, emissão, login e automações. Parte dessas verificações se sobrepõe às jornadas; os números não devem ser somados como clientes distintos. |
| Suítes anteriores | 60 verificações SQL na primeira rodada e 18 nos roteiros de cofre/cota/worker/SICOR/raster ajustados. Logs mantêm os comandos e resultados. |
| MFA no serviço real | AAL1 da Diretoria só consulta o próprio perfil; perde acesso aos dados e helpers de gestão. Após TOTP válido, AAL2 recupera o acesso autorizado. |
| Qualidade de código | Build e TypeScript aprovados. Lint sem erros; avisos existentes permanecem registrados. Auditoria estática de API é triagem, não prova de ausência de vulnerabilidades. |

## Correções e implementações

- Aluguéis: conflito de edição retorna 409; retenção de repasse já pago é recusada; falha ao consultar contrato não vira taxa zero; datas inválidas são rejeitadas.
- Atendimento/CRM: responsável precisa ser membro ativo; reabertura limpa a data de resolução; criação de CRM a partir de conversa é atômica, não duplica em concorrência e respeita campos obrigatórios. E-mail vem do Auth; perfil Leitura não marca conversas da equipe como lidas.
- Contratação: falha na emissão não é apresentada como contratação faturada; plano de corretor não exige aprovação de engenheiro; a tela considera o perfil efetivo da assinatura.
- Login: indisponibilidade/ausência do perfil retorna 503 e encerra a sessão criada, sem inventar o papel comprador nem registrar sucesso.
- Chat e ponto: JSON nulo e tipos incorretos retornam erro de entrada, em vez de 500; validação de PIN e limite de texto são explícitos.
- Automação: falhas parciais são comunicadas, o botão volta a responder após erro de rede e a quantidade real de resumos é mostrada.
- Equipe: perfil Leitura e MFA obrigatório para Diretoria/gestores, também em acesso direto ao banco; cadastro do autenticador continua acessível.
- Agenda dos setores: reúne vencimentos de tarefas, CRMs, autorizações, pedidos LGPD, despesas e aluguéis, filtrados pelos setores autorizados.
- Pendências automáticas: material incompleto de imóvel publicado, autorização com prazo próximo/vencido e pedido LGPD aberto. Concorrência não duplica tarefas; resolução confere a origem e mantém histórico. O motor não decide contratos nem responde ao titular.

## Produção e publicação

O histórico `_migrations` estava em 0142, apesar de várias estruturas posteriores já existirem. A comparação de funções, colunas, índices, constraints, policies e triggers identificou diferenças reais em SICOR e nas novas correções. Ausência no histórico não foi tratada como prova de SQL ausente.

Antes de publicar foi preparado backup criptografado adicional, com autenticação AES-GCM e leitura integral dos dois dumps do mesmo snapshot. Isso não é um exercício completo de restauração de aplicação e objetos Storage. A aplicação das migrations e a confirmação do deploy devem ser registradas abaixo após a execução.

## Pendências para aceite integral

O projeto **não está integralmente homologado em todas as funções**. O cruzamento do novo documento ainda registra: editor genérico de regras; reuniões na agenda comum; sugestões automáticas de redistribuição; filtro temporal da Matriz; gatilhos setoriais adicionais de tráfego, fontes cartográficas e revisão de acessos; avaliação após atendimento; e estudos de aplicativo próprio/cartografia com IA.

Também permanecem a homologação das integrações externas com contas reais, decisões operacionais sobre prazos/textos/regras e uma rodada sistemática de telas dinâmicas, dispositivos móveis e carga concorrente. Pagamentos simulados não certificam Asaas, emissão fiscal, Meta, WhatsApp ou demais fornecedores em produção. Nenhuma medição desta rodada comprova precisão cadastral ou remoção de nuvens em todo o Brasil.

Os relatórios preservam falhas iniciais, correções, repetições e limites; não há declaração de “100% do sistema testado”.
