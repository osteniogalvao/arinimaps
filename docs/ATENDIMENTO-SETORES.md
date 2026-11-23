# Atendimento por setores (WhatsApp de 1 número)

Migration `0156_atendimento_setores.sql`. Inspirado no atendimento do CRM da
Arini Negócios Imobiliários (repositório `osteniogalvao/arini`,
`docs/ATENDIMENTO-FLUXO.md` e migrations 0025–0059), trazido para a Central
do ARINI Maps sem duplicar o que já existe (setores, funis, rodízio, tarefas).

## Caminho de uma mensagem

1. `lib/whatsapp/receber.ts` grava a mensagem e chama `entradaAtendimento`.
2. Uma conversa por telefone (`atendimento_conversas`). Conversa resolvida
   reabre quando o cliente volta; depois de `reenviar_apos_horas`, volta ao menu.
3. Reconhecimento pelo telefone, sem menu:
   - negociação aberta → Comercial, com o corretor dela;
   - proprietário → Operações; corretor/imobiliária/engenheiro/franqueado/leiloeiro → Comercial.
4. Desconhecido → menu automático ("*1* - Quero comprar…"). A escolha leva à
   fila do setor (ou direto a uma pessoa); sem resposta válida depois de N
   tentativas, vai para o setor de escape ou fica na caixa central.
5. Comandos de autosserviço (CONSULTAR CAR, MENU, BOI, cotação, localização)
   continuam respondidos antes, como antes.

## Quem vê o quê (`lib/atendimento.ts` → `podeVer`)

| Papel | Vê |
|---|---|
| Diretoria | tudo |
| Recepção (`profiles.atendimento_recepcao`) | caixa central + tudo que foi triado |
| Atendente | fila dos setores em que atua + o que foi atribuído a ele |

A fila é compartilhada: quem atua no setor vê e assume. Responder uma
conversa sem responsável já assume.

## Telas

- `/admin/atendimento`: caixas (minhas, central, cada setor, todas, resolvidas),
  conversa com histórico, assumir, triar/transferir (motivo obrigatório entre
  setores), devolver à fila, aguardando cliente, resolver, nota interna,
  etiquetas, respostas prontas (`/atalho`), criar lead no Comercial (com
  rodízio) e abrir item no funil do setor (CRM por setores).
- `/admin/atendimento/configurar` (Diretoria): menu, opções/ramais, respostas
  prontas, quem é recepção, prazo de resposta.

## Automação

O worker chama `fn_atendimento_regras()` a cada 10 min: conversa aberta sem
resposta humana há mais que `atendimento_prazo_minutos` (expediente do
rodízio) vira tarefa do setor ou do responsável, uma por conversa por dia.
