# Conferência funcional do CRM por setor — 24/11/2026

Documento confrontado: **ARINI Matriz: Estrutura dos CRMs por Setor**, Carlos, 19/11/2026, recebido nesta auditoria. A conferência considera a main local com os PRs 68–75 integrados e as correções 0163–0166. Existência de código não equivale a homologação em produção. Nenhuma conclusão abaixo afirma que as integrações externas foram usadas com clientes reais.

## Critério

**Implementado** identifica código executável localizado. **Parcial** identifica o subconjunto existente e a diferença concreta. **Não localizado** significa que as buscas no código/migrations/worker não encontraram a implementação solicitada, não que a função dependa de uma credencial. Testes controlados usam banco e contas sintéticos; cobranças e mensagens externas não são disparadas.

## Conferência das seções 1–7 e 9–12

| Pedido do documento | Situação e evidência | Falta para o aceite completo |
|---|---|---|
| Um núcleo, dez setores e Diretoria global | Implementado: `src/lib/setores.ts`, `src/app/admin/page.tsx`, `src/lib/setores-servidor.ts`, migrations 0065/0069 | Homologar rotinas com equipe real e volume operacional |
| Tarefas com origem, vínculo, responsável, prazo, prioridade e histórico | Implementado: 0065, `api/admin/tarefas`, `admin/tarefas` | Aceite operacional dos tipos e prazos iniciais |
| Vencida calculada pelo prazo | Implementado: `src/lib/matriz.ts`, `matriz-servidor.ts`, 0162; não é estado escolhido manualmente | — |
| Evento e trilha de auditoria | Implementado: `task_events`, `audit_log`, `src/lib/audit.ts` | Auditar todos os eventos específicos de cada setor; tabela genérica não prova cobertura de todo evento |
| Editor de regra: gatilho, condição, ação, destino, prazo, escalonamento, liga/desliga | **Parcial**: catálogo fixo de regras em `admin/automacoes/page.tsx`; parâmetros em configurações e `matriz_prazos` | Editor genérico de regras e ativação individual não localizado |
| Agenda comum por setor, reunião, autorização, fatura, LGPD | **Parcial, ampliado nesta auditoria**: `admin/agenda-setores` agrega tarefas, prazo CRM, autorizações, LGPD, despesas e aluguéis com filtro de período/setor; visitas/follow-ups seguem na Agenda Comercial | Cadastro de reuniões e vencimentos de faturas (a tabela invoices não tem campo de vencimento) ainda não integrados |
| Notificação painel/e-mail/WhatsApp | **Parcial**: sino `fn_notificar`, envio por provedores nas rotas específicas | Não há garantia de que toda regra ofereça os três canais; homologar fornecedores e custos |
| Níveis 0/1/2/3, limites por setor e por tipo | Implementado: 0067/0162, `PrazosMatriz.tsx`, `admin/automacoes/acoes.ts` | Exercitar também volume/concorrência e datas de virada na operação |
| Fechar tarefa quando causa desaparece, com evidência | Implementado para causas conhecidas: 0139 e rotinas específicas | Novas regras precisam declarar sua causa de resolução; não há fechamento genérico arbitrário |
| Ari lê filas, detecta atraso, cobra e resume | Implementado: 0162, 0065–0069, `api/admin/assistente` | Detectores setoriais adicionais abaixo |
| Ari sugere redistribuição baseada em carga/tempo médio | **Parcial**: capacidade configurada e carga calculada, painel `admin/capacidade` | Sugestão automática de redistribuição baseada no tempo médio não localizada |
| Ari não aprova, paga, apaga nem responde LGPD sozinha | Mantido nas rotinas examinadas; as rotinas criam tarefas/avisos e preservam decisão humana | Revisar permissões de qualquer futura ferramenta de IA |
| Matriz com números, atrasos, gargalos ordenados e resumo | Implementado: `matriz-servidor.ts`, componentes de Matriz, 0162 | Filtro de período não localizado; filtro atual de gargalos é setor/tipo |
| Origem acompanha tarefa, aceite, devolução e repasse | Implementado: 0065 e `api/admin/tarefas` | Executar todas as passagens da tabela da seção 9; capacidade de encaminhar manualmente não significa gatilho automático em cada linha |
| Mais de dois setores sem avanço vira gargalo | Implementado: `tasks.saltos`, trigger e filtro 0162 | — |
| Diretor, gestor, operador e leitura | Diretor/gestor/operador existentes; **Leitura implementado nesta auditoria** (0165, proxy, rotas cartográficas, Equipe) | Papel de leitura é global por usuário; os setores continuam delimitando consulta |
| MFA obrigatório Diretoria/gestores | **Implementado nesta auditoria**: authz/layout/segurança da conta + 0165 | Homologar cadastro do autenticador dos usuários reais antes de exigir na operação |
| MFA também na API direta | Testado: SELECT restritivo, helpers RPC sem privilégio aal1, DML e RPC definer de escrita negados; próprio perfil acessível para enrollment | Novas tabelas devem receber os mesmos guard/policy |
| Auditoria imutável inclusive Diretoria | Implementado desde 0036; API não oferece apagar/editar | Backups e acesso operacional ao banco têm governança própria |
| Saída da equipe reatribui tarefas abertas | Implementado: trigger 0162 transfere para gestor/fila e notifica | Não equivale a redistribuição de todos os objetos do sistema, como carteira comercial privada |
| Capacidade inicial 1–3, crescimento sem refazer sistema | Sem limite fixo artificial de três; Equipe gerencia membros/setores | Dimensionar infraestrutura com carga real |
| Fases 1–5 e critérios de aceite | Núcleo e motor presentes; setores possuem diferenças abaixo | Não declarar fase 4 integralmente encerrada enquanto diferenças setoriais existirem |
| Decisões técnicas e comerciais separadas | Código central Next/Supabase/worker reaproveitado; sem duplicar CRMs | ARINI define textos, prazos comerciais e regras ativas; não inventar critérios legais/financeiros |

## Conferência dos dez setores (seção 8)

| Setor | Implementado/localizado | Diferença em relação ao documento |
|---|---|---|
| Operações | Fila de imóveis, aprovações, documentos, devolução com motivo, histórico; tarefa de cadastro parado (0065) | Gatilhos imediatos para cada anúncio/cadastro/documento e reenvio precisam ser completados/verificados; espera de dois dias não é “evento gera tarefa” imediato |
| Comercial | Leads, rodízio, funil configurável, visitas, relatório pós-visita, propostas, perda, parceiros, lembrete de atraso | Lead novo recebe responsável, mas tarefa de contato imediata para todo novo lead não foi localizada; não confundir distribuição com tarefa |
| Financeiro | Comissões, faturas, assinaturas, conciliação webhook, despesas, contabilidade, resultado, aluguel e repasses | Recebimento externo real e regras de emissão/estorno dependem de homologação Asaas; nesta auditoria não houve cobrança real |
| Jurídico | Aceites/versionamento, autorizações, contratos, fila LGPD, guarda/encerramento controlado | **Fechado nesta auditoria**: 0166 cria tarefas para autorização que vence em até 30 dias e pedidos LGPD abertos, usando o prazo do registro; confere causa e audita conclusão. Regras de decisão continuam humanas |
| Marketing Produção | Publicações, aprovação, catálogo de divulgadores, vitrine, ranking e origem dos leads | Regra “publicado sem capa/descrição” adicionada na 0166, idempotente, com resolução verificada e novas ocorrências. “Sem interesse sugere destaque” continua não localizada |
| Marketing Tráfego | Campanhas, gasto, atribuição UTM, leads/oportunidades/vendas, custo por lead (`admin/marketing/trafego`) | Alertas campanha sem resultado e gasto acima do orçamento não localizados; exige distinguir orçamento de gasto realizado |
| Cartografia e Dados | Solicitações, editor, fontes, municípios/plantas, revisão e trilha de limite | Tarefa automática por fonte desatualizada e checklist automático de município novo não localizados; saúde da fonte não equivale à data de atualização do dado |
| Suporte | Filas por setor/canal, conversa, respostas prontas, transferência e relatório; prazo configurável; 0156 | Avaliação pós-resolução não localizada; transferência de conversa não cria necessariamente tarefa vinculada no destino |
| Segurança | Eventos, limites/bloqueio temporário, alertas aparelho/IP/falhas, MFA, trilha pesquisável | Primeiro acesso não gera alerta por desenho (`seguranca/alertas.ts`); tarefa de revisão de permissão para novo usuário não localizada |
| Diretoria | Matriz, equipe, cargo/gestor, prazos/regras comerciais, configuração, resumo e cobrança crítica | Editor genérico de automações e filtro temporal ainda parciais |

## Pedidos que antecedem a estrutura dos CRMs no mesmo documento

| Pedido | Evidência / encaminhamento |
|---|---|
| Simulador no anúncio com atendimento inicial ARINI | `src/lib/financiamento.ts`, `financiamento-servidor.ts`, `api/financiamento`, `admin/financeiro/financiamento`; demanda deve ser conferida ponta a ponta pelo roteiro de compra |
| Mobile completo | Relatório anterior `AUDITORIA-MOBILE-2026-11-18.md`; não equivale a cobertura funcional atual de todas as telas |
| Múltiplas unidades no mesmo ponto | Conferência cartográfica/espelho sob auditoria principal; não atestado nesta frente CRM |
| Segundo ambiente profissional KML/KMZ/desenho | Ferramentas cartográficas existentes; comparação de toda a jornada pedida fica na auditoria principal |
| Aplicativo próprio: estudo, orçamento e planejamento | Documento específico de viabilidade não localizado nesta revisão CRM |
| Estudo de edição cartográfica com IA | Sugestão de camadas existente; estudo completo e precisão de automação não atestados nesta frente |

## Defeitos comprovados corrigidos nesta auditoria

1. Aluguel podia responder sucesso quando outra edição já havia vencido o controle de concorrência: agora retorna conflito sem auditar sucesso falso.
2. Retenção de repasse já pago permitia desfazer contabilização: agora bloqueada.
3. Falha ao consultar contrato no recebimento não pode virar taxa zero silenciosa: retorna indisponibilidade.
4. Datas inválidas de recebimento/repasse são recusadas.
5. Criação de item CRM valida responsável como integrante ativo da equipe.
6. Reabertura por transferência limpa o encerramento anterior da conversa.
7. Abrir CRM de atendimento é transacional (0163), serializado por conversa e impede duplicação concorrente. Valida os campos obrigatórios da etapa inicial antes de criar. O trigger existente envia a única notificação.
8. Perfil Leitura e MFA obrigatório de gestão implementados em camadas de aplicação e banco (0165).
9. A conversa de atendimento consultava `profiles.email`, coluna inexistente. O perfil vinculado agora é preservado e seu e-mail vem de Auth, somente após autorizar acesso à conversa.
10. A consulta por alguém com Leitura não zera o contador compartilhado de mensagens não lidas da equipe.

## Evidências de teste e limites

Rodada consolidada: **26 testes aprovados, zero falhas e zero ignorados**, com as oito suítes CRM/aluguel/atendimento/segurança/origens listadas abaixo. Executada serialmente contra Postgres descartável em `127.0.0.1:55432`; log em `../auditoria-funcional-2026-11-24/crm/testes-26.log`. Isso não significa 26 pessoas ou 26 jornadas completas de navegador. TypeScript passou; lint dos arquivos alterados passou sem erros.

- `testa-alugueis-api.mjs`: cinco casos com handlers reais e transporte de banco controlado.
- `testa-alugueis-sql.mjs`: uma jornada SQL real de geração concorrente, recebimento, repasse e reversão.
- `testa-crm-setores-api.mjs`: cinco casos (criação, campos obrigatórios, delegação, transferência e responsável).
- `testa-atendimento-api.mjs`: seis casos (consulta de perfil via Auth sem alteração por Leitura, filas, assumir/responder/resolver/reabrir, transferência e vínculo CRM).
- `testa-atendimento-crm-sql.mjs`: uma suíte transacional com dois concorrentes, um único item/evento/notificação, erro de campo obrigatório e rollback integral.
- `testa-crm-privado.mjs`: três testes, incluindo RLS real, isolamento entre titulares, MFA e herança de plano sem compartilhar dados.
- `testa-equipe-leitura.mjs`: três testes: replay de Server Actions fora da URL original, matriz de permissão de aplicação e SQL real de escrita/leitura/MFA. Objetos de extensões são excluídos dos loops da migration para respeitar ownership Supabase/PostGIS.
- Catálogo QA de RPCs SECURITY DEFINER executáveis por authenticated revisado: helpers de visibilidade usam o bloqueio MFA; APIs de CRM privado/técnico recusam papéis de equipe. Funções booleanas próprias/públicas e metadados PostGIS não dão acesso ao CRM.
- Views acessíveis a authenticated: somente `cotacoes_ultimas` com `security_invoker=true` e duas views PostGIS de metadados; nenhuma view CRM ignora o bloqueio por executar como owner.
- `scripts/qa/mfa-crm-http.mjs` verificou Auth/PostgREST reais: Diretoria em aal1 consulta apenas o próprio perfil e recebe privilégio financeiro falso; após TOTP, aal2 consulta os 142 perfis sintéticos da QA e recebe privilégio financeiro verdadeiro. Evidência: `crm/mfa-http.json`. Nenhuma chave ou código foi impresso.
- `testa-matriz-origens.mjs`: dois testes, incluindo SQL real concorrente de criação/resolução/auditoria/recorrência das três novas regras e filtro de agenda. `scripts/qa/agenda-setores-http.mjs` consultou o loader real contra PostgREST QA em quatro escopos sem erro de schema; apenas Comercial tinha registros no período, logo essa checagem não comprova renderização de todo tipo financeiro/jurídico.
- `scripts/qa/agenda-leitura-e2e.mjs`: três verificações reais de navegador/API aprovadas no build de produção QA: usuário Comercial não obtém tarefas Financeiro alterando o filtro na URL; Leitura consulta a agenda, recebe 403 ao tentar escrever e mantém a tarefa intacta; nenhum erro JavaScript. Evidências: `crm/agenda-leitura.json` e `crm/04-agenda-leitura.png`.
- `audita-crm-browser.mjs`: jornada real de navegador aprovada no build de produção QA (3005). Diretoria fez login com senha e TOTP, criou funil e item e delegou ao Jurídico; Jurídico entrou com sua própria conta, abriu o item de outro setor e concluiu, com status conferido no banco. Comercial recebeu 403 na API financeira e foi redirecionado ao tentar abrir a tela restrita. Diretoria recebeu aluguel sintético de R$ 1.000, verificou repasse calculado de R$ 900 e confirmou o repasse pela tela. Foram 12 verificações aprovadas, incluindo três logins reais e ausência de erros JavaScript. Evidência: `crm/browser-resultados.json`, screenshots `01-item-dono.png`, `02-item-delegado.png`, `03-aluguel-recebido.png`. As parcelas foram geradas como fixture no banco; nenhuma transferência bancária real ocorreu.
- Evidências externas ao Git: `../auditoria-funcional-2026-11-24/crm/` e `infra/`. Arquivos privados de MFA e credenciais nunca devem entrar no commit.

Este documento registra a fotografia da revisão; diferenças implementadas em seguida devem atualizar as linhas e anexar a evidência correspondente.
