# Arini Imóveis Brasil — planos por nicho

Pedido do Carlos (05/10/2026): "criar tipos de planos de acordo com o nicho do
usuário; esses planos dão ou bloqueiam acesso a ferramentas". Cobre o Fluxograma
Mestre §3 (identifica perfil → carrega permissões) e §20 (sem permissão →
bloqueia → registra a tentativa), e os itens 1, 10 e 15 da "Especificação de
alterações e melhorias" (SaaS, matriz de permissões, consulta básica ×
profissional). Atualizado em 05/10/2026.

---

## 1. Três eixos, de propósito separados

Cada conta (`profiles`) carrega três coisas que parecem a mesma e não são:

| Eixo | Coluna | O que responde | Onde é definido |
|---|---|---|---|
| **Papel** | `profiles.role` | O que a pessoa **faz** no fluxo (proprietário anuncia, parceiro atende oportunidade, equipe opera a Central) | `src/lib/perfis.ts`; escolhido no cadastro; a Matriz pode mudar |
| **Nicho** | `profiles.nicho` | O **segmento comercial** da conta (persona do Fluxograma Mestre: produtor rural, corretor, prefeitura…) | `src/lib/planos.ts` (`NICHOS`); escolhido no cadastro quando o papel admite mais de um; a Matriz pode mudar |
| **Plano** | `profiles.plan_id` | O **pacote de recursos e cotas** que a conta tem | tabela `plans`, editável pela Diretoria em `/admin/planos` |

Por que separar: o papel já existia e governa o fluxo (aprovações, painéis,
setores). O nicho é a leitura comercial — duas contas com o mesmo papel
(`proprietario`) podem ser "proprietário/vendedor" e "produtor rural", com
planos diferentes. O plano é o que efetivamente libera ou bloqueia cada
ferramenta, e muda sem mexer no código.

A **equipe da Matriz** (`admin_central`, `analista_arini`) não usa plano: o
papel libera todos os recursos (`montarAcesso` devolve `equipe: true`). A
divisão interna dela continua sendo por **setor** (`src/lib/setores.ts`).

## 2. Tabelas (migration `0028_planos_por_nicho.sql`)

### `plans`
| Coluna | Significado |
|---|---|
| `id` (text, PK) | slug estável: `consulta_basica`, `parceiro`… (`^[a-z][a-z0-9_]{2,40}$`) |
| `nome`, `descricao` | o que aparece em `/planos` |
| `nichos_padrao` (text[]) | nichos que **nascem** com este plano |
| `recursos` (text[]) | ids do registro `RECURSOS` (`src/lib/planos.ts`) |
| `cotas` (jsonb) | `{"consultas_area_mes": 2, "imoveis_ativos": 3}`; chave ausente = sem limite |
| `preco_mensal`, `periodicidade` (`gratis`/`mensal`/`anual`) | preço zero com periodicidade paga = "sob consulta" na página pública |
| `escopo` (`conta`/`organizacao`) | `organizacao` = vale para todos os membros de uma organização (§10, migration 0035) |
| `destaque`, `ativo`, `ordem` | exibição; inativo não aparece nem pode ser atribuído |

RLS: leitura pública só dos ativos; escrita só pelo servidor (service role) a
partir de `/api/admin/planos`.

### Colunas novas em `profiles`
| Coluna | Significado |
|---|---|
| `nicho` | um de `NICHO_IDS` (check no banco) ou null |
| `plan_id` | FK para `plans` (`on delete set null`) |
| `plan_origem` | `padrao` (segue o nicho) · `manual` (Diretoria fixou) · `assinatura` (cobrança) |
| `plan_valido_ate` | vencido → a conta volta ao acesso de visitante + solicitação cartográfica (`montarAcesso`) |

A própria pessoa **não** altera nicho/plano (policy `p_profiles_self_update`).

### `plan_subscriptions`
Assinatura do plano **por conta** (a mensalidade por imóvel continua em
`subscriptions`). Hoje só a Diretoria registra manualmente; o campo
`gateway_id` fica reservado para o Asaas. Ainda não há tela para ela.

### `access_attempts`
Append-only, fluxograma §20. Cada negação do servidor grava `user_id`, `role`,
`plan_id`, `recurso` (id do recurso ou `setor:<id>`), `rota`, `motivo`
(`sem_sessao` · `sem_plano` · `cota:<cota>` · `sem_setor` · `sem_equipe`) e
`ip`. Sem policy: só o servidor escreve e só a Central lê, em
`/admin/seguranca` ("Tentativas bloqueadas").

## 3. Como o plano padrão é atribuído (gatilho)

`trg_profiles_plano` (`before insert or update of role, nicho, plan_origem`)
executa `fn_profile_plano()`:

1. `nicho` nulo → recebe `fn_nicho_padrao(role)` (espelhado em
   `nichoPadrao()` no registro);
2. se `plan_origem = 'padrao'` e há nicho → `plan_id` recebe
   `fn_plano_padrao(nicho)` = o primeiro plano **ativo** que lista o nicho em
   `nichos_padrao`, por `ordem`.

Consequências práticas:
- Conta nova (cadastro) sempre nasce com nicho e plano, mesmo sem escolher.
- Quando a Diretoria muda `nichos_padrao` de um plano, as contas em
  `plan_origem = 'padrao'` **não** mudam sozinhas: o gatilho só dispara em
  update de `role`/`nicho`/`plan_origem` da conta. Para reaplicar, basta um
  update que toque `nicho` (é o que `/api/admin/usuarios` faz ao escolher
  "Padrão do nicho").
- `manual` e `assinatura` congelam o `plan_id`; só a Matriz muda.

Papel → nicho padrão: comprador → `comprador_investidor` · consulta → `consulta`
· proprietario → `proprietario` · imobiliaria/corretor → `corretor_imobiliaria`
· engenheiro → `engenheiro` · leiloeiro → `leiloeiro` · franqueado → `franqueado`.
Equipe → null.

## 4. O registro (`src/lib/planos.ts`)

- `RECURSOS` — cada recurso com `id`, `nome`, `descricao`, `grupo`
  (`consulta`, `ferramentas`, `profissional`, `anuncios`, `organizacao`) e
  `reservado` quando ainda não há tela/rota que o use.
- `COTAS` — limites que um plano pode impor: `consultas_area_mes`,
  `imoveis_ativos`.
- `NICHOS` — personas do fluxograma: `id`, `nome`, `papeis` (o primeiro é o
  sugerido), `escolhivel` (aparece no cadastro?) e `reservado` (persona sem
  fluxo definido).
- `montarAcesso(role, plano, nicho, validoAte)` → `Acesso` (`recursos: Set`,
  `cotas`, `equipe`, `vencido`). `ACESSO_VISITANTE` é o que quem não tem sessão
  enxerga (mapa, ficha, interesse, camadas CAR/lotes, medir).
- `nichosDoPapel(role)` / `nichoPadrao(role)` — usados no cadastro.

Lado servidor (`src/lib/planos-servidor.ts`): `acessoDe(userId)`,
`acessoAtual()` (páginas), `conferirRecurso(request, user, recurso, {cota})`
(rotas: confere recurso + cota, já registra a tentativa), `respostaNegacao()`
(`{error, solucao, codigo}` com 401/403), `registrarTentativa()`,
`consultasAreaNoMes()`, `imoveisAtivosDe()`.

`ator()` (`src/lib/authz.ts`) já devolve `nicho` e `acesso`; `temRecurso(ator, id)`
é o atalho.

## 5. Como adicionar um recurso

Regra herdada do CRM: **quem manda é o servidor, não a tela**. Esconder o botão
é conveniência.

1. **Registro**: nova entrada em `RECURSOS` (e no tipo `RecursoId`) com nome,
   descrição e grupo. Se ainda não há rota, marque `reservado: true` — ele
   aparece em `/admin/planos` com a etiqueta e em `/planos` como "(em breve)".
2. **Trava na rota** (`src/app/api/...`):
   ```ts
   const { negacao } = await conferirRecurso(request, user, "meu_recurso", { cota: "..." });
   if (negacao) return respostaNegacao(negacao);
   ```
   Isso já grava em `access_attempts`.
3. **Tela**: em página servidor, `const { acesso } = await acessoAtual()` e
   `acesso.recursos.has("meu_recurso")` para esconder/mostrar; em componente
   cliente, receba o booleano por prop. Na negação, mostre `error` **e**
   `solucao` do corpo da API (ver `BotaoConsultar.tsx`).
4. **Planos**: a Diretoria marca o recurso nos planos em `/admin/planos`. Não
   é preciso migration — a matriz mora no banco.
5. Nova **cota**: entrada em `COTAS` + função de contagem em
   `planos-servidor.ts` + o ramo em `conferirRecurso`.

## 6. Matriz inicial (seed da migration 0028)

`on conflict do nothing`: o que a Diretoria editar depois não é sobrescrito.
Preços em **zero** até o Carlos definir (pendência 8.5 do roadmap).

| Plano | Nichos padrão | Recursos | Cotas | Periodicidade / escopo |
|---|---|---|---|---|
| `consulta_basica` Consulta básica | consulta, comprador_investidor | mapa, ficha_basica, interesse, camada_car, camada_lotes, ferramenta_medir, solicitacao_cartografica | consultas_area_mes: 2 | grátis / conta |
| `consulta_profissional` Consulta profissional (destaque) | engenheiro, produtor_rural | básica + camadas_oficiais, consulta_area, relatorio_territorial, ferramenta_kml, ferramenta_exportar, historico_imovel, pre_avaliacao | consultas_area_mes: 100 | mensal / conta |
| `anunciante` Anunciante | proprietario | básica + anunciar, oportunidades, historico_imovel | consultas_area_mes: 5 · imoveis_ativos: 5 | grátis / conta |
| `parceiro` Parceiro profissional | corretor_imobiliaria, leiloeiro | profissional + anunciar, painel_parceiro, oportunidades | consultas_area_mes: 200 · imoveis_ativos: 50 | mensal / conta |
| `organizacao` Organização | empresa_holding, ente_publico | profissional + multiusuario, api_dados | consultas_area_mes: 500 | anual / organização |
| `franquia` Franquia | franqueado | parceiro + territorio | consultas_area_mes: 500 | mensal / organização |

A migration também preencheu nicho e plano padrão das contas existentes
(equipe fica sem plano).

## 7. Cotas

- `consultas_area_mes`: contada em `consultas_area_log` (`acao = 'consulta'`,
  mês corrente, por `user_id`). Conferida em `POST /api/consulta/car/[cod]`.
  A página `/consulta/car/[cod]` mostra "Consultas restantes no mês".
- `imoveis_ativos`: imóveis do owner/partner da conta em
  `pendente/em_analise/correcao/aprovado/publicado/em_negociacao`. A função
  existe (`imoveisAtivosDe`); a trava na rota de cadastro de imóvel é de outro
  pacote de trabalho.
- Equipe nunca tem cota. Chave ausente em `plans.cotas` = sem limite.
- Negação por cota devolve `codigo: "cota_esgotada"` (403) e grava
  `motivo: "cota:<id>"`.

## 8. Telas e rotas

| Onde | O quê |
|---|---|
| `/planos` | página pública: planos ativos, recursos por grupo, cotas, "Seu plano", CTA para `/suporte?assunto=plano:<id>` |
| `/admin/planos` (Diretoria) | edita cada plano (nome, preço, periodicidade, escopo, destaque, ativo, ordem, nichos, recursos, cotas), cria plano novo, lista nichos com contagem de contas |
| `/admin/usuarios` (Diretoria) | contas externas mostram nicho, plano e origem; botão "Plano" muda nicho / origem / plano / validade |
| `/admin/seguranca` | "Tentativas bloqueadas (planos e setores)": últimas 50 de `access_attempts` |
| `/entrar` (cadastro) | "Qual é o seu perfil de uso?" quando o papel admite mais de um nicho escolhível |
| `PATCH/POST /api/admin/planos` | só `admin_central`; valida recursos ⊆ `RECURSO_IDS`, nichos ⊆ `NICHO_IDS`, enums, preço ≥ 0, cotas inteiras ≥ 0; audita `plano_alterado` / `plano_criado` |
| `PATCH /api/admin/usuarios` | com `nicho`/`plan_id`/`plan_origem`/`plan_valido_ate` para conta externa; audita `usuario_plano_alterado` |
| `POST /api/cadastro` | aceita `nicho` opcional (precisa ser `escolhivel` e listar o `role`) |

## 9. Decisões em aberto (para o Carlos)

1. **Preços** — todos em zero. A página mostra "Sob consulta" para plano pago
   sem preço; "Gratuito" para `gratis`. Definir valor e se o anual tem
   desconto.
2. **Quais nichos entram na v1** — `produtor_rural`, `empresa_holding` e
   `ente_publico` estão marcados `reservado` (personas do fluxograma sem fluxo
   próprio). Hoje `produtor_rural` é escolhível no cadastro (papéis
   proprietário/consulta) e cai na consulta profissional; os outros dois só a
   Matriz atribui. Confirmar se produtor rural deve mesmo nascer no plano
   profissional ou na básica.
3. **Por conta × por organização** — implementado como "várias contas
   compartilhando o plano da organização" (§10). Falta o Carlos confirmar se
   isso basta ou se quer conta-mãe com sub-usuários, e se os membros devem
   enxergar a carteira (imóveis/oportunidades) uns dos outros.
4. **Cota gratuita** — a básica tem 2 consultas de área por mês (degustação) e
   o anunciante 5. Confirmar os números e se a degustação deve existir.
5. **Assinatura e cobrança** — `plan_subscriptions` está pronta, sem tela nem
   integração. Quando o Asaas entrar, a assinatura ativa deve pôr
   `plan_origem = 'assinatura'` e `plan_valido_ate` no fim do ciclo; o
   inadimplente volta ao padrão do nicho.
6. **Mensalidade por anúncio × plano** — hoje são cobranças separadas
   (`subscriptions` por imóvel e plano por conta). Confirmar se o plano
   Parceiro/Franquia inclui N anúncios na mensalidade.
7. **Trava de `imoveis_ativos`** no cadastro de imóvel e os recursos
   `api_dados` — reservados até existir tela (`multiusuario` passou a valer em 07/10, §10;
   `pre_avaliacao` deixou de ser reservado e `chat_ia` + cota `mensagens_ia_mes` entraram na migration 0034 —
   ver docs/PRE-AVALIACAO.md e docs/SEGURANCA.md §10).

## 10. Organizações e precedência do plano (migration 0035, 07/10/2026)

Roadmap 5.9. Várias contas sob o mesmo plano: imobiliária com corretores,
empresa, holding, ente público, franquia.

### Tabelas
- `organizations`: `nome`, `cnpj` (único quando informado), `tipo`
  (`imobiliaria` · `empresa` · `holding` · `ente_publico` · `franquia`),
  `plan_id`, `plan_valido_ate`, `region_id`, `ativo`, `observacoes`.
- `organization_members`: `org_id`, `user_id` (nulo enquanto o convite não
  foi aceito), `email` (sempre minúsculo), `papel_org` (`admin`/`membro`),
  `status` (`pendente` · `ativo` · `recusado` · `removido`). Uma conta fica
  **ativa em uma organização por vez** (índice único) e há no máximo um
  convite pendente por e-mail em cada organização.
- RLS: a equipe lê tudo; o membro lê a própria organização e a própria linha.
  Escrita só pelo servidor.

### Precedência do plano (`acessoDe()` e `ator()`)
1. Equipe da Matriz → tudo pelo papel (não muda).
2. Conta com `plan_origem` = `manual` ou `assinatura` → **plano pessoal**,
   mesmo sendo membro de organização (a Diretoria/cobrança fixou de propósito).
3. Conta com `plan_origem = padrao` **e** membro ativo de organização ativa
   cujo plano existe, está ativo, tem `escopo = organizacao` e não venceu
   (`organizations.plan_valido_ate`) → **plano da organização**.
4. Senão → plano pessoal (padrão do nicho), como antes.

Plano de escopo `conta` atribuído a uma organização não se aplica aos membros
(a tela avisa). Organização desativada ou com plano vencido devolve cada
membro ao próprio plano — não ao acesso de visitante.

### Convites
- O administrador da organização convida em `/painel/organizacao` (só se o
  plano da organização tiver `multiusuario`); a Matriz convida em
  `/admin/organizacoes` (setores Comercial/Diretoria) sem essa exigência.
- O convite vai por e-mail. No **login** (`/api/auth/entrar`), se a conta não
  está em nenhuma organização e há convite pendente para o e-mail dela, o mais
  antigo é aceito sozinho (`vincularConvites`). Os demais aparecem em
  `/conta` para aceitar ou recusar.
- O último administrador não pode sair; remover/cancelar marca `removido`.

### Fora do escopo (próximo passo)
- **Carteira compartilhada**: membros ainda veem só os próprios imóveis e
  oportunidades. Para o corretor ver os imóveis da imobiliária, as policies de
  `properties`/`opportunities` (e `podeOperarOportunidade`) precisam
  considerar o `org_id` — decisão do Carlos sobre o que o membro pode ver e
  operar.
- Cota por organização (consultas somadas de todos os membros) — hoje a cota
  continua sendo contada por conta.
- Cobrança do plano da organização (`plan_subscriptions` é por conta).

## Visitante e conta gratuita: só imóveis à venda (18/11/2026)

Pedido do Stenio: o visitante se encanta com o imóvel à venda e cria a conta
("como o Mercado Pago"); a conta gratuita vê só os imóveis à venda; imóvel de
terceiro não mostra nada.

- **Ficha do imóvel sem login** (`src/components/imovel/FichaVisitante.tsx`):
  fotos, vídeos, valor, ficha técnica, diferenciais e descrição até o limite de
  fichas por navegador (`settings.fichas_visitante`, padrão 2, cookie assinado
  em `/api/vitrine/abrir`). Localização exata, tour 3D, arredores,
  documentação, financiamento, relatório e contato ficam atrás da parede "Criar
  conta grátis". Passado o limite, só a capa desfocada e a parede.
- **Recurso `dados_terceiros`** (migration `0151_dados_terceiros.sql`): área do
  CAR ou lote urbano sem anúncio. Está nos planos pagos e nos testes de 3 dias.
  Sem ele: o cartão do CAR e do lote no mapa aparecem trancados, as medidas e a
  numeração dos lotes somem do mapa, `/consulta/car/…` e `/consulta/lote/…`
  mostram a página de bloqueio (ou levam ao anúncio, se a área estiver à venda)
  e as rotas `/api/geo/car/[cod]/matricula`, `/api/geo/car/[cod]/ambiente` e
  `/api/geo/lotes/[id]` negam o dado. Regra em `src/lib/dados-terceiros.ts`.
- Exceções: a área à venda (o dado do anúncio é público), o CAR guardado no
  cofre da própria conta e o CAR de um imóvel que a conta anunciou.
- Continuam abertos, porque o dono precisa deles para anunciar a própria área:
  `/api/geo/car/[cod]` (divisa para o cadastro) e `/api/geo/lotes?ids=`.
