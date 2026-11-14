# Backup e recuperação

| Cópia | Conteúdo | Destino e retenção |
|---|---|---|
| Backup nativo | Banco, conforme plano contratado | Supabase. Conferir retenção e horário no projeto. |
| `scripts/backup.mjs` | Esquema e dados de `public`, contas e metadados de Storage | R2 privado, sete diários, domingos de até 31 dias e primeiros dias do mês de até 366 dias. |
| `scripts/backup-arquivos.mjs` | Conteúdo dos objetos de todos os buckets do Supabase Storage | R2 privado em `backups/arquivos/`. A cópia retém exclusões por 30 dias após a primeira ausência observada. |

As metas operacionais são RPO de 24 horas e RTO de duas horas. Medir o RTO no exercício de banco **e** arquivos, do início da recuperação ao teste do aplicativo. A conferência de leitura dos dumps mede outra etapa.

## Geração e conferência

Guardar `BACKUP_CHAVE` no servidor e em um cofre independente sob responsabilidade da ARINI. O gerador usa uma sessão PostgreSQL direta ou pooler em modo **sessão** para compartilhar um snapshot entre os dois processos de `pg_dump`. O host remoto exige TLS com validação da cadeia e do nome. Quando o pooler usar CA própria, fornecer o caminho do PEM oficial em `BACKUP_PGSSLROOTCERT` ou `PGSSLROOTCERT`, legível pelo Node e pelo cliente PostgreSQL. O modo local sem TLS se limita ao endereço de loopback. Usar clientes PostgreSQL compatíveis com a versão do banco.

O formato `ARINIBK2` autentica o cabeçalho e o conteúdo de cada dump com AES-256-GCM. Cada geração usa um sal aleatório compartilhado pelo par, com IVs independentes. A transação exportadora mantém tabelas, contas e metadados no mesmo instante. As ACLs de tabelas e funções do esquema acompanham o dump. Sessões, refresh tokens, trilha interna de autenticação e históricos de migrações de Auth/Storage ficam fora da cópia.

```sh
node scripts/backup.mjs                     # grava localmente e envia se o R2 estiver configurado
node scripts/backup.mjs --local /pasta      # grava somente em /pasta/<geração>/
node scripts/backup-restaurar.mjs "$PUBLIC_ENC" --conferir-par "$AUTH_STORAGE_ENC"
node scripts/backup-restaurar.mjs "$ARQUIVO_ENC" --conferir
```

No R2, procurar o `completo.json` mais recente pela data de envio em `backups/banco/AAAA-MM-DD/<geração>/`. O marcador só é enviado depois dos dois dumps da geração e registra nomes e tamanhos em bytes. Uma nova execução cria outro prefixo, inclusive no mesmo dia. Usar os dois arquivos indicados pelo marcador e conferir o par na máquina privada de recuperação. O comando autentica a geração, confere as seções esperadas e lê os dois arquivos integralmente com `pg_restore`. A conferência individual também aceita o formato antigo.

## Recuperação do banco

Preparar um Supabase compatível, privado e vazio na máquina ou VPS autorizada para os dados. Manter aplicação, worker, webhooks e acesso externo desligados até o aceite. O destino precisa dos schemas e das versões compatíveis de Auth e Storage, dos papéis `anon`, `authenticated` e `service_role`, e de PostGIS, pgcrypto e unaccent nos mesmos schemas da origem. Usar o papel `postgres`, proprietário das funções nas migrations, com permissão para criar objetos, atribuir privilégios e instalar o gatilho de cadastro em `auth.users`. Uma imagem PostgreSQL com PostGIS fornece apenas parte dessas dependências.

O banco pode conter a estrutura e os históricos dos serviços da plataforma. Contas, buckets, objetos e tabelas da aplicação devem estar vazios ou ausentes. Reservar espaço para os dumps e seu SQL descompactado no diretório temporário privado. A URI ou o serviço de conexão deve indicar expressamente o destino descartável.

```sh
node scripts/backup-restaurar.mjs "$PUBLIC_ENC" --par "$AUTH_STORAGE_ENC" --destino "$BANCO_DE_RECUPERACAO"
```

A CLI carrega contas e metadados antes das linhas de negócio e suas chaves estrangeiras. Ela restaura as ACLs e policies do esquema, aplica o padrão global de privilégios da migration 0046 e reinstala o gatilho de cadastro da migration 0001, que pertence a `auth.users`. Uma transação única desfaz dados e estrutura se ocorrer erro. O estado gerenciado por outros serviços, suas credenciais, configurações do Auth, roles adicionais e políticas personalizadas fora de `public` precisam de conferência própria. Reconciliar quaisquer mudanças feitas diretamente no painel com a versão das migrations correspondente ao backup.

Antes de habilitar tráfego, comparar contagens de usuários, perfis, imóveis e documentos com a evidência da origem. Exercitar cadastro de um usuário sintético, acesso autenticado, bloqueios para anônimos e acesso permitido ao worker. Conferir o histórico `public._migrations` e aplicar somente migrations posteriores ao ponto recuperado, em ordem.

## Recuperação de arquivos

O dump de `storage.objects` contém referências aos arquivos. O conteúdo está no prefixo privado `backups/arquivos/<bucket>/<chave>` do R2. Comparar as chaves referenciadas no banco recuperado com o inventário de objetos e o manifesto `backups/controle/arquivos-v1.json`. O espelho é incremental e pode conter versões mais novas ou itens excluídos da origem. Ele não garante uma versão histórica do conteúdo para cada data de banco.

No backend **separado e privado** do Storage recuperado, repor os bytes das chaves que o banco requer, preservando nome, MIME e a visibilidade original dos buckets. Usar o mecanismo suportado pelo backend escolhido. Se a API fizer upsert de metadados, conferir novamente IDs, proprietário, contagens, tamanho e referências após o upload. Comparar os bytes do R2 com os do destino por SHA-256 e testar download autorizado de um documento privado e rejeição para acesso anônimo. O espelho cobre apenas os objetos do Supabase Storage. Inventariar separadamente tiles e outros arquivos mantidos diretamente em R2 ou em volumes da VPS. Registrar faltas e divergências antes da troca das variáveis do aplicativo.

## Resgate de backups antigos

O formato `ARINIBK1` guarda os dumps diretamente em `backups/banco/AAAA-MM-DD/`. As duas capturas eram sequenciais e o arquivo `public` era gerado com `--no-privileges`. Suas permissões originais de execução/gravação não podem ser deduzidas do dump. O teste do projeto reproduz a execução por `anon` de uma função privilegiada após restaurar estrutura antiga em um PostgreSQL vazio.

Se o banco de origem foi perdido e esta for a única cópia, é possível resgatar os dados em **dois ambientes privados isolados do aplicativo**. No primeiro, preparar Auth/Storage e extensões compatíveis, sem dados de negócio, e reservar diretórios novos em volume privado. A extração gera SQL em claro. Escolher os arquivos da mesma execução por data, tamanho e logs. O formato antigo não autentica o vínculo entre os dois.

```sh
node scripts/backup-restaurar.mjs "$PUBLIC_ENC" --extrair-legado "$DIR_PUBLIC"
node scripts/backup-restaurar.mjs "$AUTH_STORAGE_ENC" --extrair-legado "$DIR_AUTH"
psql -X -1 -v ON_ERROR_STOP=1 --dbname "$BANCO_DE_RESGATE" \
  -f "$DIR_AUTH/auth-storage-dados.sql" -f "$DIR_PUBLIC/pre-data.sql" \
  -f "$DIR_PUBLIC/public-dados.sql" -f "$DIR_PUBLIC/post-data.sql"
```

Esse procedimento recupera registros e confere as FKs entre os schemas em uma transação. A estrutura de resgate carece das ACLs originais. Preservar o histórico de migrations do destino, que a extração omite dos dados para importação. Em um **segundo** Supabase privado, reconstruir a versão correspondente da aplicação pelas migrations do repositório para recuperar ACLs, triggers e RLS. Promover dados por reconciliação de chaves primárias e dependências, incluindo seeds das migrations, contas já recriadas pelo gatilho de cadastro e referências circulares. Comparar os totais e validar a matriz de privilégios antes de disponibilizar esse segundo ambiente. O teste automatiza o primeiro resgate com fixture sintética; a reconciliação final depende da versão e dos dados antigos. Apagar os SQLs em claro e os destinos descartáveis após o aceite.

## Exercício e agendamento

```sh
node --test scripts/testa-backup-restauracao.mjs scripts/testa-backup-retencao.mjs
```

O teste exige ferramentas do PostgreSQL no PATH. Ele cria um cluster local descartável com registros sintéticos e verifica FK entre schemas, integridade do par, rollback, execução de função, RLS, criação de perfil e resgate legado. O teste de retenção usa objetos simulados. Para comprovar recuperação de clientes, repetir o exercício completo com a pilha compatível, os bytes dos objetos e a aplicação em rede privada.

Agendamentos previstos na VPS (verificar fuso e a última execução nos logs).

```cron
30 3 * * * cd /app && node scripts/backup.mjs >> /var/log/arini-backup.log 2>&1
0 4 * * * cd /app && node scripts/backup-arquivos.mjs >> /var/log/arini-backup.log 2>&1
```
