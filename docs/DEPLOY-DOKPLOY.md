# Produção no Dokploy

Desde 07/11/2026, o site é publicado pela aplicação **Arini App**, no projeto
**Arini Brasil**, ambiente **production** do Dokploy.

- Repositório: `osteniogalvao/arinimaps`, branch `main`.
- Build: Nixpacks, Node.js 22, diretório `/`, porta 3000.
- Domínio: https://arinibrasil.com.br, com certificado Let's Encrypt.
- Pushes em `main` acionam o webhook do GitHub e o Autodeploy do Dokploy.
- Variáveis de produção ficam em **Environment**; nunca incluir seus valores no Git.
- Acompanhar cada publicação em **Deployments**, incluindo status e log do build.

O timer `arini-worker-deploy.timer` da VPS confere a cada dois minutos a pasta
`worker/` do commit que o site está servindo. Se ela mudou, constrói a imagem
e atualiza o serviço Swarm existente. Uma alteração só no site preserva o worker.
A identificação da imagem usa o hash Git da pasta. O timer também acompanha uma
reversão do site. Consulte a última execução com
`journalctl -u arini-worker-deploy.service -n 30`.

Para instalar ou atualizar essa integração na VPS, copie os arquivos de
`deploy/worker-autodeploy/` para os destinos abaixo e ative o timer.

```sh
install -m 0755 deploy/worker-autodeploy/publicar /usr/local/sbin/arini-worker-deploy
install -m 0644 deploy/worker-autodeploy/arini-worker-deploy.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now arini-worker-deploy.timer
```

## Verificação após publicação

1. Confirmar que o último deployment terminou com sucesso.
2. Consultar `/api/saude`: deve responder HTTP 200 com `ok: true`.
3. Consultar `/api/geo/cartografia?fresco=1`: as camadas devem incluir `edicoes`.
4. Conferir o fluxo alterado no navegador. Saúde da API não substitui teste funcional.

Migrations do Supabase são uma etapa separada: um push não aplica SQL no banco.
A migration `0054` já estava aplicada na migração para o Dokploy.

## Transição do serviço anterior

O serviço antigo `arini-app` foi preservado para reversão. Seu router HTTPS da
aplicação usa o host inativo `rollback-arini.invalid`; o domínio principal agora
aponta para o serviço gerenciado `arini-brasil-arini-app-j51jds`.
Os routers antigos de redirecionamento HTTP e `www` ainda estão ativos.
Antes de remover o serviço antigo, transferir esses redirecionamentos.

Não restaurar o router antigo para o domínio principal enquanto o router do
Dokploy estiver ativo: duas rotas para o mesmo host tornam o destino ambíguo.
