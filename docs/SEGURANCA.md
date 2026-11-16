# Arini Imóveis Brasil — arquitetura de segurança

Documento pedido no item 22 de "Requisitos de segurança, LGPD e proteção de
dados" (01/10/2026). Descreve o que está implementado, como foi testado e o que
ainda falta. Atualizado em 07/10/2026 (revisão das APIs e itens 6.2 a 6.15 do
roadmap). Documentos irmãos: `docs/AUDITORIA-APIS.md` (achados por rota),
`docs/INCIDENTES.md` (resposta a incidentes), `docs/LGPD-MAPA-DE-DADOS.md`
(mapa de dados pessoais).

Cada afirmação "implementado" abaixo tem um teste automatizado ou uma medição
citada. O que não foi testado está marcado como tal.

---

## 1. Fluxo de uma requisição

```
navegador → HTTPS → aplicação (Next.js) → autenticação e autorização → banco (Postgres + RLS)
                                        ↘ armazenamento (media público · docs privado)
```

- O banco **não** é acessado direto pelo navegador para escrita: toda gravação
  passa por uma rota do servidor, que confere quem é o usuário e o que ele pode.
- O navegador usa a chave pública do Supabase só para login e leituras; a RLS
  limita o que cada sessão enxerga.
- A chave mestra (`SUPABASE_SERVICE_ROLE_KEY`) existe só no servidor.

## 2. Perfis e matriz de permissões

Três famílias (`src/lib/perfis.ts`):

| Família | Perfis | Onde entra |
|---|---|---|
| Equipe (Matriz) | Diretoria, Equipe | Central Arini (`/admin`), por setor |
| Parceiro | Imobiliária, Corretor, Engenheiro, Leiloeiro, Franqueado | Painel do anunciante (`/painel`) |
| Cliente | Proprietário, Comprador, Consulta | Painel (proprietário) e área pública |

### 2.1 Equipe — por setor (`src/lib/setores.ts`)

A diretoria atua em todos os setores. Os demais membros, só nos setores
marcados em Equipe e usuários. A trava é no servidor: `exigirSetor()` em cada
tela e `temSetor()` em cada rota.

| Ação | Setor exigido |
|---|---|
| Analisar, pedir correção, aprovar, publicar, suspender anúncio | Operações |
| Aprovar cadastro de parceiro e proprietário | Operações |
| Conferir documento do imóvel | Operações ou Jurídico |
| Funil, leads, visitas, propostas | Comercial |
| Comissões, mensalidades, planilha financeira | Financeiro |
| Pedidos de titulares (LGPD), autorizações, contratos | Jurídico |
| Origem de leads, materiais de divulgação | Marketing |
| Plantas urbanas, calibração, CAR, municípios | Cartografia |
| Solicitações cartográficas (triagem, vetorização, validação de geometria) | Cartografia |
| Chamados de suporte | Suporte |
| Eventos de acesso, auditoria | Segurança (auditoria também Diretoria) |
| Configurações, equipe, território de franquia | Diretoria |
| Tarefas internas | Só as do próprio setor |

### 2.2 Parceiros e clientes

| Ação | Proprietário | Parceiro | Leiloeiro | Franqueado | Comprador / Consulta |
|---|---|---|---|---|---|
| Ver mapa, anúncios e termos | sim | sim | sim | sim | sim |
| Consultar informações de área do CAR | sim | sim | sim | sim | sim (com conta) |
| Informar imóvel ausente/divergente no mapa | sim (com conta) | sim (com conta) | sim (com conta) | sim (com conta) | sim (com conta) |
| Anunciar imóvel | sim, o próprio | sim, com conta aprovada | sim, em leilão | sim, com conta aprovada | não |
| Documento obrigatório | matrícula | matrícula + autorização do proprietário | edital | matrícula + autorização | — |
| Ver os próprios imóveis e documentos | sim | sim | sim | sim | — |
| Ver imóveis, documentos ou leads de terceiros | não | não | não | não | não |
| Ver oportunidades | as encaminhadas a ele | as encaminhadas a ele | idem | idem | — |
| Aprovar ou publicar | não | não | não | não | não |

Aprovação e publicação são sempre da Matriz, inclusive para o franqueado.

## 3. RLS (Row-Level Security)

Medido em 07/10/2026: 67 tabelas no schema `public`; **66 com RLS ligada**. A
única sem RLS é `spatial_ref_sys` (tabela do PostGIS, só leitura de sistemas
de coordenadas) — `_migrations` foi fechada na migration 0026.

- Tabelas com RLS e **sem policy** só são alcançadas pelo servidor:
  `auth_events`, `car_imoveis`, `consultas_area`, `jobs`, `rate_limits`, `tasks`.
- Imóvel: visível publicamente só quando publicado, em negociação ou vendido;
  editável só pelo dono, pelo parceiro responsável ou pela equipe.
- Documentos do imóvel, autorizações e selfie: só o responsável pelo imóvel e a
  equipe. O bucket `docs` é privado; o acesso é por endereço assinado de 1 hora.
- Chamados e pedidos LGPD: o usuário lê os próprios; nota interna não aparece.
- Registros somente-inserção: ver §8.

### Escrita só pelo servidor (revisão de 07/10/2026)

O teste direto contra a API pública do banco (PostgREST com a sessão de um
usuário comum) achou policies de escrita sobrando da F0: dava para criar o
próprio cadastro de proprietário já "aprovado" e publicar imóvel sem a Matriz,
marcar o próprio documento como conferido, trocar o caminho do arquivo,
alterar aceite, selfie, oportunidade, proposta, visita e contrato. Toda
gravação do sistema já passava pelas rotas do servidor, então a migration 0036
deixou essas tabelas **só leitura** pela API pública (`owners`, `partners`,
`properties`, `property_documents`, `property_authorizations`,
`property_geometries`, `property_media`, `partner_documents`, `opportunities`,
`opportunity_events`, `proposals`, `visits`, `contracts`). No perfil, o próprio
usuário só altera nome, telefone, foto e preferências (antes alterava também
setores, `ativo`, CPF e aceite). O bucket público `media` não aceita mais envio
direto de conta logada (o vídeo usa URL de envio assinada pelo servidor).

**Cadastro direto no Auth (crítico, corrigido):** o Supabase aceita
`POST /auth/v1/signup` com a chave pública, e o gatilho criava o perfil com o
papel enviado pelo próprio cliente — inclusive `admin_central`. Agora papel de
equipe só vem de `app_metadata` (gravado só pelo servidor); fora isso a conta
nasce `comprador`. **Ação pendente (Stênio):** em Supabase › Authentication ›
Sign In / Providers, desligar "Allow new users to sign up" — o cadastro do
site usa a API administrativa (`admin.createUser`) e continua funcionando.

### Funções do banco

Achado e corrigido em 01/10/2026 (migration 0026): 34 funções `SECURITY
DEFINER` estavam executáveis pela API pública (`/rpc/...`), o que permitiria,
com a chave pública, registrar venda, trocar a divisa de um imóvel ou ler a
receita. Agora só o servidor as executa. Ficam abertas as sete funções que as
policies consultam (`fn_is_arini`, `fn_role`, `fn_property_visible*`,
`fn_property_editable_id`, `fn_opp_visible*`). Função nova nasce fechada.

Teste (chave pública, sem login): `fn_financeiro_mensal`, `fn_rate_limit`,
`fn_car_resumo` e `fn_properties_geojson` devolvem "permission denied";
`property_documents` e `auth_events` devolvem vazio.

## 4. Autenticação

| Requisito | Situação |
|---|---|
| Senha nunca em texto puro | Hash bcrypt com salt, do Supabase Auth. Ninguém da equipe vê a senha. O requisito cita Argon2id "ou equivalente"; bcrypt é o que o provedor oferece. |
| Política de senha | Mínimo de 10 caracteres, com letras e números, sem as senhas mais comuns (`src/lib/seguranca/senha.ts`). Vale no cadastro, na troca e na recuperação. |
| Limite de tentativas | Login: 30 por IP a cada 10 min e 8 por e-mail a cada 15 min. Cadastro: 6 por IP por hora. Recuperação: 3 por e-mail por hora. Código do segundo fator: 6 erros a cada 15 min. Contador no banco (`fn_rate_limit`). |
| Registro de tentativas | Tabela `auth_events`: entrada, erro, bloqueio, recuperação, troca de senha, segundo fator, com IP e navegador. Tela em Segurança. |
| Segundo fator (MFA) | TOTP por aplicativo autenticador, em Segurança da conta. A diretoria pode torná-lo obrigatório para a equipe (Configurações › Segurança). |
| Recuperação de senha | Link de uso único com validade de 1 hora; a senha antiga nunca é enviada; a resposta é a mesma exista a conta ou não. Sem a senha atual, a troca só vale na sessão aberta pelo link (`amr` do token); uma sessão de login comum precisa informar a senha atual. |
| Recuperação reforçada da equipe (6.7) | Diretoria e Equipe: com segundo fator, a senha nova só é gravada depois do código do aplicativo (sessão aal2); sem segundo fator, código de 6 dígitos no e-mail (15 min, 5 tentativas, guardado como HMAC). Sempre: auditoria (`senha_recuperada_equipe`), alerta em Segurança e aviso por e-mail aos outros membros da Diretoria. Se o código não puder ser enviado, a recuperação é interrompida até o restabelecimento do serviço. `src/lib/seguranca/recuperacao.ts`. |
| Alertas de acesso anormal (6.8) | No login: aparelho (navegador + sistema) ou local (faixa /24 do IPv4, /48 do IPv6) nunca vistos na conta nos últimos 180 dias; 5 senhas erradas na conta em 15 min ou 20 do mesmo endereço em 10 min; entrada certa logo após 5+ erros. Vira `alertas_seguranca` (tela Segurança, com "visto") e e-mail ao dono da conta — inerte até o Resend (3.2). O primeiro login não alerta. `src/lib/seguranca/alertas.ts`. |
| Sessões | Trocar a senha encerra as outras sessões. O usuário encerra as outras sessões quando quiser. A sessão da Central expira (padrão: 12 horas, configurável). |
| Mensagem de erro de login | Igual para e-mail inexistente e senha errada. |
| Senha de bloqueio do site (fase de testes) | Com `SITE_SENHA` definida, o proxy manda toda página para `/acesso` e responde 401 nas APIs até a senha ser digitada. O cookie (`arini_acesso`, httpOnly, 30 dias) guarda um HMAC da senha com `SITE_BLOQUEIO_SEGREDO`: trocar a senha derruba todos os acessos. 10 tentativas por IP a cada 15 min. Só o webhook do Asaas fica de fora (tem token próprio). Para lançar, apagar `SITE_SENHA`. Código em `src/lib/seguranca/bloqueio.ts`. |

Testado em `scripts/testa-matriz.mjs`: ativação do TOTP, login exigindo o
código, eventos gravados.

## 5. Segredos

- Nenhuma chave no código-fonte: todas vêm de variáveis de ambiente do servidor.
- `.env.local` está no `.gitignore`.
- Expostas ao navegador (por serem públicas por natureza): endereço do
  Supabase, chave pública do Supabase e a chave do satélite, que deve ser
  restrita ao domínio do site no painel do fornecedor.

## 6. Criptografia

- Em trânsito: HTTPS/TLS (certificado no proxy do servidor). HSTS ligado
  (`next.config.ts`); cookie de sessão com `Secure` quando o site é https.
- Em repouso: criptografia de disco do provedor do banco e do armazenamento.
- **Criptografia de campo (6.5)** — `src/lib/seguranca/cripto.ts`, chave
  `CAMPO_CRIPTO_CHAVE` (32 bytes, `openssl rand -base64 32`), da qual saem por
  HKDF uma chave AES-256-GCM e uma chave HMAC-SHA256:
  - **CPF/CNPJ**: com a chave, o cadastro grava `cpf_cnpj_cifrado` (cifrado) e
    `cpf_hash` (HMAC, com índice único) e deixa `cpf_cnpj` nulo. A unicidade e a
    busca "já existe conta com este CPF?" usam o hash; contas antigas, em claro,
    continuam sendo encontradas. Para cifrar as antigas:
    `node scripts/cifra-cpf.mjs` (simula) e `--aplicar`. Único ponto de uso do
    CPF no código: `/api/cadastro` (conferido em 07/10). Ler: `cpfDoPerfil()`.
  - **Sem a chave, nada muda**: grava em claro como antes — cadastro e login
    não dependem dela.
  - O CPF saiu do `user_metadata` do Auth (ia dentro do token de sessão).
  - **Telefone: decisão de não cifrar.** Aparece em ~10 telas e junções
    (`profile:profiles(nome, telefone)` em imóvel, oportunidade, parceiro); é
    dado de contato que a equipe usa o tempo todo, não identificador. Cifrar
    exigiria decifrar em cada uma dessas consultas sem ganho proporcional — o
    risco dele é coberto pela RLS e pela trava de escrita. Reavaliar se o
    jurídico classificar diferente.
  - **Caminho da selfie e dos documentos: não cifrado.** O caminho é gerado
    pelo servidor (UUID) e não revela nada; o arquivo fica no bucket privado e
    só abre por `/api/arquivos`, com permissão e registro a cada abertura.
  - Busca por CPF fora da unicidade (ex.: pedido LGPD) passa a ser por hash:
    `hashesDeBusca(cpf)`.

## 7. Dados sensíveis

| Dado | Onde fica | Quem acessa |
|---|---|---|
| Matrícula, edital, CCIR/ITR, autorização, procuração | bucket `docs` (privado) | responsável pelo imóvel e equipe (Operações, Jurídico, Cartografia), por `/api/arquivos` — cada abertura registrada |
| Selfie do aceite da exclusividade | bucket `docs` (privado) | quem fez o aceite e a equipe (Operações/Jurídico), por `/api/arquivos` — registrada |
| Contrato | bucket `docs` (privado) | quem opera a oportunidade; Comercial, Jurídico, Financeiro — registrada |
| Anexos de solicitação cartográfica | bucket `docs` (privado) | solicitante e Cartografia — registrada |
| CPF/CNPJ | `profiles.cpf_cnpj` (ou cifrado, §6) | o próprio usuário e a equipe |

**Abertura de arquivo (6.3):** `GET /api/arquivos/<caminho>` (`?acao=baixar`
para download). A permissão sai do registro que aponta para o arquivo
(`src/lib/seguranca/documentos.ts`) — caminho que não está em nenhuma tabela
não abre, nem para a equipe. Cada abertura, inclusive negada, vai para
`document_access_log` (quem, o quê, imóvel, ação, IP, aparelho) e aparece em
Segurança › Acessos a documentos. O redirecionamento é para uma URL assinada
de 60 segundos. Link para usar nas telas: `urlArquivo(path)` de
`src/lib/seguranca/link-arquivo.ts`.
| Fotos e vídeos do anúncio | bucket `media` (público) | públicos por natureza |

A selfie é foto de identificação para conferência humana. **Não há
reconhecimento facial** nem extração de dado biométrico. A exigência pode ser
desligada em Configurações › Dados jurídicos.

## 8. Auditoria

- `audit_log`: cadastro, anúncio, decisão, documento conferido, venda, comissão,
  configuração, tarefa, chamado, exportação financeira. Com usuário, data e o
  antes/depois.
- `auth_events`: acessos (seção 4).
- `consultas_area_log`: quem consultou cada área do CAR.
- `document_access_log`: quem abriu ou baixou cada documento (§7).
- `alertas_seguranca`: alertas de acesso anormal (§4); só "visto" muda.
- `revisoes_acesso`: revisões trimestrais de permissão (§13).
- `descartes_log`: o que a rotina de retenção apagou ou simulou (§12).
- Aceites de termos: versão, data, hora, usuário e IP.

**Proteção dos registros (6.12):** `audit_log`, `auth_events`,
`access_attempts`, `property_events`, `consultas_area_log`,
`document_access_log`, `descartes_log` e `revisoes_acesso` têm gatilho
`fn_log_somente_insercao` que recusa UPDATE, DELETE e TRUNCATE **inclusive da
chave mestra** (a RLS não segura a `service_role`; o gatilho segura). Passam
só: (a) a rotina de retenção, que liga `arini.descarte_autorizado` dentro da
própria transação; (b) ações em cascata de chave estrangeira (apagar um
imóvel leva o histórico dele; excluir um titular anula o `user_id`).
Testado em 07/10: delete/update/truncate diretos recusados, cascata e
descarte autorizados. Limite conhecido: o dono do banco (`postgres`) pode
desligar o gatilho — isso exige a senha do banco, que fica fora do servidor
da aplicação (§11), e aparece no log do Postgres.

## 9. Segurança das rotas

Revisão completa em `docs/AUDITORIA-APIS.md` (67 rotas, 17 achados, 07/10/2026).
Triagem automática: `node scripts/audita-rotas.mjs` (sai com erro se um método
que muda dados ficar sem trava) — rodar a cada rota nova.

- Toda rota de escrita confere a sessão e a permissão no servidor, **por
  método** (um GET público não pode ficar sem trava só porque o POST tem).
- **Origem (CSRF):** todo POST/PUT/PATCH/DELETE em `/api/*` precisa vir do
  próprio site (`Origin`, ou `Sec-Fetch-Site` ≠ cross-site) — `conferirOrigem()`
  em `src/lib/seguranca/origem.ts`, aplicada no `proxy.ts`; as rotas fora do
  matcher (`api/admin/cartografia/**`) conferem dentro da rota. Isento: webhook
  do Asaas (token próprio, comparado em tempo constante). Domínios extras:
  `ORIGENS_PERMITIDAS`. O cookie de sessão é SameSite=Lax (padrão do Supabase)
  e `Secure` em https; não é httpOnly porque o cliente do navegador o lê.
- Entradas validadas; SQL só parametrizado; nenhum filtro do PostgREST com
  valor interpolado; todo `fetch` do servidor vai a host fixo (sem SSRF).
- **Upload:** o tipo é decidido pelos primeiros bytes do arquivo
  (`conferirArquivo()`, `src/lib/seguranca/arquivos.ts`) e gravado com a
  extensão e o `Content-Type` reais — HTML/SVG renomeado não entra. Limites:
  foto 20 MB, selfie 15 MB, documento e contrato 25 MB, vídeo 50 MB, anexo
  cartográfico 25 MB. Caminho sempre gerado pelo servidor; vídeo sobe por URL
  de envio assinada de uso único.
- **HTML:** texto de usuário nunca entra cru em HTML montado à mão
  (`escaparHtml()`, `src/lib/seguranca/html.ts`).
- **Cabeçalhos** (`next.config.ts`): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, CSP `frame-ancestors 'self'; object-src 'none';
  base-uri 'self'; form-action 'self'`, `Referrer-Policy`, HSTS 1 ano,
  `Permissions-Policy` (câmera e localização só no site). CSP de `script-src`
  com nonce fica para a homologação (1.5), onde dá para testar mapa, tour e
  satélite.

## 10. Inteligência artificial

Assistente de IA (`/api/ia/chat`, migration 0034), inerte sem
`ANTHROPIC_API_KEY`. Como o requisito 18 é atendido:

- O modelo **não tem acesso ao banco**. Ele só pode pedir quatro funções do
  servidor (`src/lib/ia/ferramentas.ts`), que leem apenas o que qualquer
  visitante já vê: vitrine pública (a mesma consulta de `/imoveis`), ficha
  pública (`fn_property_public`), dados públicos do CAR e consultas de área já
  gravadas, e artigos **publicados** da base de conhecimento. Nada de SQL livre,
  dono, parceiro, lead, documento ou valor de venda.
- A rota exige sessão, o recurso `chat_ia` no plano, cota mensal
  (`mensagens_ia_mes`) e limite por minuto e por hora; negação registrada em
  `access_attempts`.
- Injeção de instrução: o prompt de sistema é fixo e trata o retorno das
  ferramentas como dado; o histórico enviado ao modelo vem do banco (só desta
  conversa, desta conta), não do navegador; links da resposta só são
  renderizados se forem internos.
- Auditoria: `ia_conversas`/`ia_mensagens` (texto, tokens, ferramentas usadas,
  só servidor lê — RLS sem policy); o `audit_log` recebe apenas metadados.
- A chave fica só no servidor; a Central mostra se está instalada.

## 11. Rotação de chaves e segredos (6.6)

Regra geral: segredo só em variável de ambiente do servidor (nunca no código,
no Git ou em print); quem tem acesso é o Stênio (servidor e painéis) e, no
painel de cada fornecedor, a conta da Arini [PREENCHER]. Lista atualizada em
`ACESSOS - NAO COMPARTILHAR.md`, fora do repositório. Toda troca é registrada
nesse arquivo (data, quem, motivo). **Troca imediata** (fora da frequência) se
o segredo vazar, se alguém com acesso sair do projeto ou em incidente
(`docs/INCIDENTES.md`).

| Segredo | Onde | Frequência | Procedimento |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` (chave mestra) | servidor da aplicação, worker | 12 meses | Supabase › Project Settings › API Keys: criar nova *secret key* → atualizar a variável no servidor e no worker → reiniciar os dois → conferir login, mapa e um envio de arquivo → revogar a antiga. No modelo antigo (JWT legado), "Roll JWT secret" troca também a chave pública e **derruba todas as sessões**: avisar e fazer fora do horário. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / publishable key | servidor (vai ao navegador) | junto da anterior | É pública por natureza; trocar só junto da chave mestra ou se a RLS mudar de modelo. Exige novo build. |
| `SUPABASE_DB_PASSWORD` (senha do banco) | só scripts (`migrate.mjs`, `sql.mjs`), worker (`DATABASE_URL`) | 6 meses | Supabase › Database › Reset database password → atualizar `.env.local` de quem roda migration e `DATABASE_URL` do worker → reiniciar o worker. Não fica no servidor da aplicação. |
| `SITE_SENHA` / `SITE_BLOQUEIO_SEGREDO` | servidor | a cada troca de testadores; segredo 12 meses | Trocar `SITE_SENHA` derruba todos os acessos liberados (o cookie é HMAC dela). Trocar `SITE_BLOQUEIO_SEGREDO` tem o mesmo efeito. Reiniciar a aplicação. Some no lançamento (8.13). |
| `ASAAS_API_KEY` / `ASAAS_WEBHOOK_TOKEN` | servidor | 12 meses | Asaas › Integrações: gerar nova chave → atualizar → reiniciar → revogar a antiga. Token do webhook: gerar valor novo (`openssl rand -hex 32`), gravar no servidor e no cadastro do webhook do Asaas no mesmo minuto. |
| `RESEND_API_KEY` | servidor | 12 meses | Resend › API Keys: criar com permissão "sending access" só do domínio → atualizar → reiniciar → mandar um e-mail de teste (recuperação de senha) → apagar a antiga. |
| `NEXT_PUBLIC_ARCGIS_KEY` (satélite Esri) | servidor (vai ao navegador) | 12 meses | Pública por natureza: manter **restrita ao domínio** no painel da Esri. Criar nova → novo build → apagar a antiga. |
| `ANTHROPIC_API_KEY` (IA) | servidor | 6 meses | Console da Anthropic › API Keys: criar → atualizar → reiniciar → conferir o chat → desativar a antiga. Definir limite de gasto mensal no console (8.2). |
| `CAMPO_CRIPTO_CHAVE` (criptografia de campo) | servidor | 24 meses ou vazamento | 1) `CAMPO_CRIPTO_CHAVE_ANTERIOR` = chave atual; `CAMPO_CRIPTO_CHAVE` = nova (`openssl rand -base64 32`) no servidor e no `.env.local` de quem roda o script. 2) Reiniciar a aplicação (lê as duas). 3) `node scripts/cifra-cpf.mjs` (simula) e `--aplicar` (recifra e recalcula o `cpf_hash`; transação única). 4) Conferir que o script mostra 0 pendentes. 5) Apagar `CAMPO_CRIPTO_CHAVE_ANTERIOR` e reiniciar. **Perder a chave = perder os CPFs cifrados**: guardar cópia no cofre de senhas da Arini. |
| Senhas da equipe | Auth | — | Política de senha (§4) + segundo fator obrigatório (6.9). Saída de alguém: desativar a conta no mesmo dia (revisão trimestral, §13). |

## 12. Retenção e descarte (6.4)

Configurações › Segurança (só Diretoria): `retencao_selfie_dias` (após o fim
da autorização), `retencao_docs_reprovados_dias` (documentos de anúncio
reprovado, após a reprovação), `retencao_logs_acesso_dias` (entradas,
aberturas de documento, tentativas bloqueadas, consultas de área, alertas) e
"Descartar de verdade". **Padrão: 0 = não descartar e só simular**, até a
decisão 8.9 (Carlos e jurídico). Registros de acesso nunca ficam menos de
180 dias (Marco Civil da Internet, art. 15). `audit_log` e `property_events`
não entram no descarte.

O worker enfileira `descarte_retencao` uma vez por dia
(`worker/jobs/descarteRetencao.mjs`): em simulação grava em `descartes_log`
quanto seria apagado; em execução apaga primeiro os arquivos do bucket e só
então as linhas (`fn_descarte_aplicar`, que confere de novo o prazo de cada
uma). A tela Segurança mostra os prazos, o que passou do prazo hoje e o
histórico; a Diretoria pode simular ou rodar na hora.

## 13. Revisão periódica de permissões (6.13)

Central › Segurança › Revisão de acessos (`/admin/seguranca/revisao`), a cada
90 dias: equipe (papel, setores, último acesso, segundo fator), contas
externas com plano fora do padrão e parceiros com território. Ajustes em
Equipe e usuários; "Marcar revisão concluída" grava quem, quando, observações
e uma foto do que foi revisado (`revisoes_acesso`, somente-inserção). A tela
Segurança mostra "Próxima revisão de acessos" e destaca quando venceu.

## 14. Atualização mensal de dependências (6.15)

Primeira segunda-feira do mês, ~30 min, em uma branch:

```bash
npm outdated                 # o que tem versão nova
npm audit                    # vulnerabilidades conhecidas
npm install pacote@versão    # patch/minor; next fixo (sem ^) e no mesmo minor
npm audit fix                # só correções sem quebra (nunca --force)
npx next typegen && npx tsc --noEmit && npm run lint
node scripts/audita-rotas.mjs
cd worker && npm outdated && npm audit   # o worker tem package.json próprio
```

Depois: testar login, mapa, cadastro de imóvel e um envio de arquivo em
homologação (1.5) e publicar. **Major** (Next, React, MapLibre, Supabase) é
projeto à parte, com teste do mapa e do tour. Vulnerabilidade crítica fora do
calendário: aplicar no mesmo dia se houver correção sem major.

Situação em 07/10/2026: Next 16.3.2 → **16.3.8** (corrige 3 RCE críticas),
Supabase JS 2.117.3, SSR 0.12.7, MapLibre 5.24.0, `sharp` e `source-map-js`
corrigidos por `npm audit fix`. Restam: **MapLibre ≤ 6.4** (crítica,
GHSA-jrc7-96c5-q579 — contorno do sanitizador de `setHTML`; só a 6.x corrige,
é major) — mitigada porque nenhum texto de usuário entra cru em `setHTML`
(§9); e `braces` (só na ferramenta de lint, não vai para produção).

## 15. Incidentes e mapa de dados

- Plano de resposta a incidentes (6.10): `docs/INCIDENTES.md` — papéis,
  gravidade, checklist das primeiras 24 h, comunicação à ANPD e aos titulares
  (LGPD art. 48), preservação de evidências e modelo de pós-incidente.
- Mapa de dados pessoais (6.11): `docs/LGPD-MAPA-DE-DADOS.md` — tabela, coluna,
  finalidade, base legal sugerida, quem acessa, retenção e onde fica.

---

## Pendências de segurança

| Item | Situação | Depende de |
|---|---|---|
| Ambientes separados (desenvolvimento, homologação, produção) | **Não atendido.** Hoje há um banco só, usado no desenvolvimento e na produção. | Criar um segundo projeto de banco para homologação. |
| Backups automáticos e teste de restauração | **Não atendido no plano atual.** O plano gratuito do banco não tem backup automático com retenção. | Plano pago do banco (cerca de US$ 25/mês) e um teste de restauração. |
| Monitoramento e alertas | Parcial: alertas de acesso anormal detectados e listados em Segurança; o e-mail sai quando o Resend estiver configurado. Falta monitorar disponibilidade (1.10). | Serviço de e-mail (3.2); responsáveis definidos. |
| Cadastro direto no Auth | Corrigido no banco (papel de equipe só pelo servidor); falta desligar "Allow new users to sign up" no painel. | Stênio, no painel do Supabase. |
| WAF / proteção de borda | Não configurado. | Colocar o domínio atrás da Cloudflare. |
| Varredura de vulnerabilidades e pentest | Não feito. | Contratação externa antes do lançamento, como pede o item 21. |
| Plano de resposta a incidentes | Escrito (`docs/INCIDENTES.md`); faltam nomes e contatos. | Arini preencher os papéis. |
| Mapa de dados pessoais (LGPD, item 19) | Feito a partir do banco (`docs/LGPD-MAPA-DE-DADOS.md`); bases legais e prazos sugeridos. | Validação do jurídico (8.9). |
| Prazos de guarda | Mecanismo pronto, desligado (0 = não descartar). | Decisão 8.9. |
| Limite de requisições nas rotas públicas de leitura | Parcial: há limite em login, cadastro, lead, suporte, consulta e envio de mídia; as leituras do mapa não têm. | Avaliar com o tráfego real. |
| Atualização de dependências | Rotina mensal escrita (§14); MapLibre 6 (major) pendente. | Janela de teste do mapa para o MapLibre 6. |
| CSP de scripts | Só `frame-ancestors/object-src/base-uri/form-action`. | Homologação (1.5) para testar nonce. |
