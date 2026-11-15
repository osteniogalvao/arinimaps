# Asaas: cobrança de mensalidade e comissão

Integração com a API v3 do Asaas. Código: `src/lib/asaas.ts` (cliente HTTP), `src/app/api/admin/mensalidades/route.ts` (botão **Cobrar via Asaas**), `src/app/api/asaas/webhook/route.ts` (confirmações), `scripts/asaas-webhook.mjs` (cadastro do webhook).

## Assinaturas, Pix e comunicação

A Matriz configura a periodicidade e o texto do painel em **Financeiro → Assinaturas e contatos**. Cada regra aceita o ID de um modelo aprovado da conta oficial do WhatsApp. O corpo do modelo recebe o primeiro nome e o link do pedido, nessa ordem. O modelo de confirmação de pagamento deve comunicar o recebimento. A integração consulta a aprovação da Meta antes do envio.

O cliente autoriza separadamente os avisos de assinatura e a recuperação de contratação em **Preferências de privacidade**. Durante o cadastro, pode autorizar até duas tentativas enviando pelo próprio número a mensagem exibida no WhatsApp. A resposta **PARAR LEMBRETES** encerra a recuperação. Depois do pagamento, o cliente encontra as confirmações no histórico do pedido.

Em **Meus pedidos → Ver Pix copia e cola e QR Code**, o titular pode pedir o envio para o seu WhatsApp. O número precisa ser único, ter autorização para avisos da assinatura e ser confirmado com uma mensagem enviada do próprio telefone ao WhatsApp oficial. A confirmação expira em 15 minutos. A troca de número invalida a prova anterior e exige um novo consentimento para assinaturas e recuperação. O webhook valida a assinatura da Meta.

Dentro da janela de atendimento de 24 horas, a ARINI envia a imagem privada do QR Code com o Pix copia e cola na legenda. Fora dessa janela, configure `WHATSAPP_PIX_TEMPLATE_ID` com o modelo aprovado, cabeçalho de imagem e dois parâmetros no corpo, o código Pix e o link autenticado do pedido. Como alternativa, `WHATSAPP_FATURA_LINK_TEMPLATE_ID` envia somente o link autenticado em um modelo aprovado de um parâmetro. O titular também pode iniciar uma nova janela pelo WhatsApp oficial.

O servidor confere o titular, o valor e o estado da fatura no Asaas antes da entrega. A imagem é enviada à conta Meta por upload privado e só o ID dessa mídia acompanha a mensagem. A fila registra um envio de Pix e um de link por fatura e dia. Entregas incertas ficam em conferência. Os canais usam `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET` e o webhook oficial da conta.

## Variáveis

| Variável | Obrigatória | Para quê |
|---|---|---|
| `ASAAS_API_KEY` | sim | Chave da conta. Produção começa com `$aact_prod_`, sandbox com `$aact_hmlg_`. Sem ela o botão avisa e tudo segue manual. |
| `ASAAS_WEBHOOK_TOKEN` | sim | Token que o Asaas manda no header `asaas-access-token`. De 32 a 255 caracteres, sem espaços. **Nunca** use a API key aqui. |
| `ASAAS_BASE_URL` | não | Padrão `https://api.asaas.com/v3`. Sandbox: `https://api-sandbox.asaas.com/v3`. |
| `NEXT_PUBLIC_SITE_URL` | para o script | Domínio público (`https://arinibrasil.com.br`). O script também aceita `--site=`. |
| `ASAAS_WEBHOOK_EMAIL` | para o script | E-mail que o Asaas avisa quando o webhook falha. O script também aceita `--email=`. |

Toda requisição envia `User-Agent: AriniImoveisBrasil/1.0`. O Asaas exige esse header nas contas criadas a partir de 13/06/2024.

## Sandbox (testar sem dinheiro real)

1. Crie uma conta em https://sandbox.asaas.com e gere uma chave (`$aact_hmlg_...`).
2. Num ambiente de teste, defina `ASAAS_API_KEY` com a chave de sandbox e `ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3`.
3. O webhook precisa de URL pública. Para testar no computador, use um túnel (ngrok, cloudflared) e passe `--site=https://<tunel>` ao script.
4. No painel do sandbox dá para simular o pagamento da cobrança e disparar os eventos.

Nunca misture as duas coisas: a chave de produção com a URL de sandbox (ou o contrário) responde 401.

## Pós-deploy (produção)

1. Aplique a migration `supabase/migrations/0045_asaas_producao.sql` **antes** de publicar o código. Ela cria o status `estornada`, a coluna `profiles.asaas_customer_id` e a tabela `asaas_webhook_events`.
2. Simule o cadastro do webhook (só lê a conta, não altera nada):
   `node scripts/asaas-webhook.mjs --site=https://arinibrasil.com.br --email=<financeiro>`
3. Confira a saída. O script só cria ou edita o webhook **"Arini Imóveis Brasil"**; os outros webhooks da conta são só listados.
   **Feito em 19/10/2026:** o antigo "Arini" foi renomeado para "Arini Imóveis Brasil", apontado para o
   domínio novo (na Vercel, provisório) e atualizado pelo script com `--aplicar`.
4. Grave: repita o comando com `--aplicar`.
5. Teste: `curl -X POST https://arinibrasil.com.br/api/asaas/webhook -H "asaas-access-token: errado"` precisa responder **401**.
6. Faça uma cobrança real de valor baixo (R$ 5) por **Admin → Mensalidades → Cobrar via Asaas**. Pague via Pix e confira que a fatura fica **paga**. Depois, se quiser, estorne pelo painel do Asaas e confira que ela fica **estornada**.

## Eventos tratados

`externalReference` da cobrança é o id da fatura (`invoices.id`) ou da comissão (`commissions.id`).

| Evento | Fatura (mensalidade) | Comissão |
|---|---|---|
| `PAYMENT_RECEIVED` / `PAYMENT_CONFIRMED` | aberta/vencida → **paga** (data do Asaas). A assinatura volta a ativa se não sobrar fatura vencida ou estornada. | registrada/cobrada → **paga** |
| `PAYMENT_OVERDUE` | aberta → **vencida**. A assinatura vai para **inadimplente** na hora, sem a carência de `suspensao_dias` (decisão do Carlos, 16/10). | nada (comissão não vence) |
| `PAYMENT_REFUNDED` | paga → **estornada** | paga/conciliada → **cobrada** |
| `PAYMENT_CHARGEBACK_REQUESTED` | paga → **estornada**. A assinatura vai para **inadimplente**. | paga/conciliada → **cobrada** |
| `PAYMENT_RECEIVED_IN_CASH_UNDONE` | paga → **aberta** | paga/conciliada → **cobrada** |
| `PAYMENT_DELETED` | perde o vínculo (`gateway_id` vazio) e continua devida. O botão gera outra cobrança. | cobrada → **registrada** |

Regras do webhook:

- Eventos negativos (vencida, estorno, remoção) só afetam a fatura se vierem da mesma cobrança gravada em `gateway_id`. Evento de uma cobrança antiga não mexe na fatura.
- **Idempotência.** O id do evento (`evt_...`) vai para `asaas_webhook_events`, e um reenvio responde `{"duplicado": true}` sem fazer nada. Além disso, toda mudança depende do status atual e a auditoria só é gravada quando algo mudou.
- **Respostas.** Evento desconhecido, referência que não é deste sistema e payload inválido respondem 200, para não pausar a fila. Só uma falha de banco responde 500: o id do evento é liberado e o Asaas reenvia depois.
- **Cliente Asaas.** O id do cliente fica em `profiles.asaas_customer_id`. Sem ele, o sistema procura pelo `externalReference` (o id do perfil) antes de criar. A mesma pessoa não vira dois clientes.
- **Cobrança já existente.** Se a fatura já tem uma cobrança ativa, o botão reabre o mesmo link em vez de criar outra.

## Fila do webhook pausada

O Asaas pausa a fila depois de **15 falhas seguidas**. Os eventos continuam sendo gerados e ficam guardados por **14 dias**. Depois disso, são apagados.

1. Descubra a causa: site fora do ar, `ASAAS_WEBHOOK_TOKEN` diferente do cadastrado (401) ou migration não aplicada (500 nos estornos). Veja os logs do servidor (`webhook Asaas ... falhou`).
2. Corrija e confira com o `curl` do passo 5.
3. Reative a fila de uma destas formas:
   - rode `node scripts/asaas-webhook.mjs --aplicar`, que grava `interrupted: false`;
   - ou, no painel do Asaas, vá em **Integrações → Webhooks** e reative a fila.

   Os eventos guardados chegam em ordem (`sendType: SEQUENTIALLY`).
4. Se a pausa passou de 14 dias, confira à mão no painel do Asaas as cobranças do período e marque as faturas em **Admin → Mensalidades**.
