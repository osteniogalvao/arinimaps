# WhatsApp pela Evolution API

A ARINI envia e recebe WhatsApp por um de dois provedores. O código escolhe sozinho:

| Situação | Provedor |
|---|---|
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_INSTANCE` preenchidas | **Evolution** |
| Só `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_ID` (Meta) preenchidas | Meta (Cloud API) |
| As duas, com `WHATSAPP_PROVEDOR=meta` | Meta |

Tudo o que já existia passa a sair pelo provedor ativo, sem mudar telas:
conversa do CRM (Central › WhatsApp e a oportunidade), atendimento automático
(MENU, BOI, COTAÇÃO, CONSULTAR CAR, localização, PDF do relatório), número só de
cotações, confirmação do número da conta, lembrete de cadastro incompleto, Pix e
fatura da assinatura, avisos de filtro e de monitoramento.

Código: `src/lib/whatsapp/evolution.ts` (cliente), `src/lib/meta.ts` (escolha do
provedor), `src/lib/whatsapp/receber.ts` (recebimento comum),
`src/app/api/webhooks/whatsapp/evolution/route.ts` (webhook) e
`/admin/comercial/whatsapp/conexao` (tela de conexão, Diretoria).

## 1. Subir a Evolution na VPS (Dokploy)

1. Crie o subdomínio, por exemplo `evolution.arinibrasil.com.br`, apontando para a VPS.
2. Dokploy › projeto **Arini Imóveis Brasil** › **Create Service › Compose** ›
   cole `deploy/evolution-compose.yml`.
3. Em **Environment** do compose:
   - `EVOLUTION_DOMINIO=evolution.arinibrasil.com.br`
   - `EVOLUTION_API_KEY=` gere com `openssl rand -hex 24`
   - `EVOLUTION_DB_SENHA=` gere com `openssl rand -hex 16`
4. Em **Domains**, ligue o domínio ao serviço `evolution`, porta `8080`, HTTPS ligado.
5. Deploy. Abra `https://evolution.arinibrasil.com.br` e confira a resposta da API.

## 2. Ligar no app da ARINI

No serviço do app (Dokploy › Environment), acrescente e faça **restart** (não precisa rebuild):

| Env | Valor |
|---|---|
| `EVOLUTION_API_URL` | `https://evolution.arinibrasil.com.br` |
| `EVOLUTION_API_KEY` | a mesma `EVOLUTION_API_KEY` do compose |
| `EVOLUTION_INSTANCE` | `arini` |
| `EVOLUTION_WEBHOOK_TOKEN` | gere com `openssl rand -hex 24` (mínimo 16 caracteres) |
| `EVOLUTION_COTACOES_INSTANCE` | opcional, só se houver um segundo número só de cotações (ex.: `arini-cotacoes`) |
| `EVOLUTION_NUMERO` | opcional, número com DDI se a Evolution não informar (ex.: `5534999990000`) |
| `NEXT_PUBLIC_WHATSAPP_ARINI` | o número do botão do site (este pede **rebuild**) |

## 3. Conectar o número

1. Entre como Diretoria em **Central › WhatsApp do Comercial › Conexão do número**.
2. **Criar instância e ligar webhook**: cria a instância `arini` na Evolution e aponta o
   webhook para `https://arinibrasil.com.br/api/webhooks/whatsapp/evolution?token=…`
   com os eventos `MESSAGES_UPSERT`, `MESSAGES_UPDATE` e `CONNECTION_UPDATE`.
3. **Gerar QR Code** e leia no celular do número da ARINI (WhatsApp › Aparelhos conectados).
4. O estado passa a **Conectado** e o número aparece. Mande `MENU` de outro celular para testar.

Se o celular desconectar, o webhook cria a tarefa "WhatsApp da ARINI desconectado" no
Comercial; volte à tela de conexão e gere um novo QR Code.

## 4. Avisos que na Meta dependiam de modelo aprovado

Na Evolution não há modelo aprovado nem janela de 24 horas. Os IDs de modelo viram só
o interruptor do aviso e o texto é o da ARINI (`TEXTOS_MODELO` em `src/lib/meta.ts`):

| Aviso | Como ligar na Evolution |
|---|---|
| Imóvel novo no filtro do cliente | `WHATSAPP_FILTRO_TEMPLATE_ID=1` |
| Novidade na área monitorada | `WHATSAPP_MONITORAMENTO_TEMPLATE_ID=1` |
| Pix da assinatura | já liga sozinho com o número da conta confirmado |
| Link da fatura | `WHATSAPP_FATURA_LINK_TEMPLATE_ID=1` |
| Cobrança, renovação, recuperação | Admin › Planos › Contatos: preencha `1` no "ID do modelo" da regra |

## 5. Cuidados

- A Evolution usa o WhatsApp comum (não o oficial da Meta). Envio em massa para quem
  não conversou com a ARINI pode levar ao bloqueio do número. Os avisos automáticos
  só vão para quem deu consentimento, e cada rotina tem limite por execução.
- Use um chip dedicado à ARINI, com WhatsApp Business no celular, e mantenha o celular
  ligado à internet de vez em quando para a sessão não expirar.
- A chave `EVOLUTION_API_KEY` dá controle total da Evolution: não use prefixo `NEXT_PUBLIC_`.
