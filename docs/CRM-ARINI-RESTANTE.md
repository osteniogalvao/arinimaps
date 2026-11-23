# CRM da Arini: aluguéis, caixa, fluxo do imóvel e redes no Atendimento

Segunda leva do CRM por setores, no molde do CRM da Arini Negócios Imobiliários
(a primeira é o Atendimento, em `docs/ATENDIMENTO-SETORES.md`). Migration
**0157**, que roda **depois da 0156**.

## 1. Aluguéis (Financeiro e Jurídico)

- **Contratos de locação** (`/admin/registros/contratos-locacao`, código `LC-#####`):
  imóvel, proprietário, inquilino, valor, dia de vencimento, taxa de administração,
  início e fim, conta do caixa. Ações: suspender, reativar, encerrar (encerrar
  cancela as parcelas futuras ainda pendentes).
- **Parcelas** (`/admin/financeiro/alugueis`): o contrato novo já gera o mês
  corrente e o seguinte; depois o worker (`fn_alugueis_rotina`, a cada ciclo)
  gera os meses, marca atraso e cria tarefas para cobrança, repasse pendente e
  contrato vencendo em 60 dias.
- Pagar a parcela lança a **entrada** no caixa; repassar ao proprietário lança a
  **saída** (as duas na conta 2.1, Aluguéis a repassar). Desfazer estorna o lançamento.

## 2. Caixa e contas (Financeiro)

- `/admin/financeiro/caixa`: saldo por conta (`fn_caixa_saldos`), movimentos,
  lançamento avulso e transferência entre contas (duas pernas com origem
  `transferencia`, que fica de fora do resultado mensal).
- Contas em `/admin/registros/contas-bancarias`. Todo lançamento existente foi
  para a "Conta principal"; os novos usam a conta da despesa ou a padrão.

## 3. Fluxo captação → marketing → aprovação

- Na ficha do imóvel, Operações **envia ao Marketing**; o Marketing inicia,
  anexa o material (fotos, vídeo, textos) e **envia para aprovação**; a
  Diretoria **aprova** ou **pede ajustes**. Cada passo avisa o setor seguinte e
  fica no histórico (`imovel_fluxo_eventos`).
- Painel do Marketing: `/admin/marketing/fluxo`.
- Trava opcional: com "Publicação exige marketing aprovado" ligada (Diretoria,
  no mesmo painel), Operações só publica imóvel com material aprovado. Vem
  **desligada**, para não mudar nada em produção sem decisão.

## 4. Instagram e Messenger no Atendimento

- As mensagens do Direct e do Messenger entram na mesma caixa, com menu,
  filas e setores iguais ao WhatsApp. O contato aparece como `ig:<id>` ou
  `fb:<id>` (com selo do canal na lista); a resposta sai pelo mesmo canal.
- "Criar lead" pede telefone, então em contato das redes o atendente pede o
  WhatsApp do cliente ou abre o item direto no funil.
- A Meta só deixa responder até 24 h depois da última mensagem do cliente.

### Para ligar

1. No app da Meta (o mesmo do WhatsApp), adicionar os produtos **Messenger** e
   **Instagram**, com webhook em `https://<site>/api/webhooks/meta-mensagens`,
   campo `messages`, nos objetos *page* e *instagram*.
2. Variáveis no Dokploy (app):
   - `FACEBOOK_PAGE_TOKEN`: token da página com `pages_messaging` e
     `instagram_manage_messages` (a conta do Instagram ligada à página).
   - `META_VERIFY_TOKEN` (opcional; sem ele vale o `WHATSAPP_VERIFY_TOKEN`).
   - `WHATSAPP_APP_SECRET` já existe e confere a assinatura.
