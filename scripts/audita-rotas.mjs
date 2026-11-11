// Auditoria estática das rotas de API (item 6.2 do roadmap).
//
// Varre src/app/api/**/route.ts e aponta, rota a rota, o que precisa de olho
// humano: método sem conferência de sessão, sem limite de requisições, SQL
// montado com texto, filtro do PostgREST com valor interpolado, fetch para
// endereço variável (SSRF), upload sem conferência de tipo/tamanho, resposta
// com linha inteira (select("*")) e pontos de HTML cru no front.
//
// É uma triagem, não uma prova: cada achado foi revisado à mão e o resultado
// está em docs/AUDITORIA-APIS.md. Rode depois de criar ou mexer em rota:
//
//   node scripts/audita-rotas.mjs            → tabela no terminal
//   node scripts/audita-rotas.mjs --json     → JSON (para comparar versões)
//   node scripts/audita-rotas.mjs --md       → tabela em Markdown
//
// Sai com código 1 se alguma rota mutável não tiver conferência de sessão nem
// estiver na lista de exceções conhecidas (webhook com token próprio etc.).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pastaApi = join(raiz, "src", "app", "api");
const modo = process.argv.includes("--json") ? "json" : process.argv.includes("--md") ? "md" : "tabela";

function varrer(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) varrer(p, achados);
    else if (/^route\.(t|j)sx?$/.test(nome)) achados.push(p);
  }
  return achados;
}

function varrerFront(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) { if (nome !== "node_modules") varrerFront(p, achados); }
    else if (/\.(tsx?|jsx?)$/.test(nome)) achados.push(p);
  }
  return achados;
}

// Rotas que, de propósito, não usam a sessão do Supabase: cada uma tem a sua
// própria trava, conferida na revisão manual.
const EXCECOES_AUTH = {
  "/api/asaas/webhook": "token do webhook (ASAAS_WEBHOOK_TOKEN)",
  "/api/acesso": "senha de bloqueio do site, com limite por IP",
  "/api/auth/entrar": "é o próprio login (limite por IP e por e-mail)",
  "/api/auth/recuperar": "pedido de recuperação (limite por IP e por e-mail)",
  "/api/cadastro": "é o próprio cadastro (limite por IP)",
  "/api/leads": "formulário público de interesse (limite por IP)",
  "/api/car/janela": "mapa público: só garante o CAR (dado aberto) da janela no Brasil, com limite por IP",
  "/api/saude": "monitoramento: sem o SAUDE_TOKEN só responde ok/erro, sem detalhe",
  "/api/interno/publicar": "chamada só pelo worker, com o SAUDE_TOKEN no cabeçalho x-saude-token",
  "/api/webhooks/whatsapp": "webhook da Meta: GET confere WHATSAPP_VERIFY_TOKEN, POST confere a assinatura HMAC (WHATSAPP_APP_SECRET)",
};
// Leituras públicas por natureza (mapa, anúncios publicados).
const LEITURA_PUBLICA = [/^\/api\/geo\//, /^\/api\/tiles\//];
// GET público revisado à mão: só entrega o que é público e trava o resto dentro.
const LEITURA_PUBLICA_CONFERIDA = {
  "/api/imoveis/[id]/consulta-rural": "relatório público só de anúncio publicado; o resto exige equipe/responsável",
  "/api/feeds/portais": "feed XML para os portais: só imóveis publicados, os mesmos dados do anúncio",
};

// executarConsultaArea (src/lib/geo/consultaArea.ts) confere sessão, plano, cota e limite por dentro
const AUTH = /\bator\(|executarConsultaArea\(|currentUser\(|auth\.getUser\(|exigirSetor\(|exigirEquipe\(|conferirRecurso\(|cookieValido\(|senhaConfere\(|ASAAS_WEBHOOK_TOKEN|asaas-access-token/;
const LIMITE = /\blimitar\(|executarConsultaArea\(|fn_rate_limit|limiteMemoria\(|limitarMemoria\(|limiteLeituraMapa\(|rateLimit|respostaLimite\(/;
const SQL_TEXTO = /\.query\(\s*`[^`]*\$\{|`\s*(select|insert|update|delete|with)\b[^`]*\$\{/i;
const FILTRO_INTERPOLADO = /\.(or|filter|textSearch)\(\s*`[^`]*\$\{/;
const FETCH_VARIAVEL = /\bfetch\(\s*(?!["'`]https?:\/\/)(?!`\$\{process\.env)[^)]/;
const UPLOAD = /formData\(\)|instanceof File|\.arrayBuffer\(\)/;
// lerArquivos (src/lib/cartografia/servidor.ts) confere extensão, tamanho e quantidade
const UPLOAD_TAMANHO = /\.size\s*[><]|maxBytes|MAX_BYTES|tamanhoMax|conferirArquivo\(|lerArquivos\(/;
const UPLOAD_TIPO = /\.type\b|extensao|ARQUIVOS_ACEITOS|conferirArquivo\(|tipoReal\(|lerArquivos\(/;
const SELECT_TUDO = /\.select\(\s*["'`]\*["'`]/;
const METODO = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;

/**
 * Corpo de cada método exportado (GET, POST…) e de cada função local. A
 * sessão é conferida POR MÉTODO: um GET sem trava num arquivo cujo POST tem
 * trava é exatamente o tipo de falha que esta auditoria precisa achar.
 */
function blocos(fonte) {
  const re = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;
  const marcas = [...fonte.matchAll(re)].map((m) => ({ nome: m[1] || m[2], ini: m.index }));
  return marcas.map((m, i) => ({ nome: m.nome, corpo: fonte.slice(m.ini, marcas[i + 1]?.ini ?? fonte.length) }));
}

function metodosSemSessao(fonte) {
  const bs = blocos(fonte);
  // funções locais que conferem a sessão (ex.: podeEditar() que chama ator())
  const locaisComAuth = new Set(bs.filter((b) => !/^(GET|POST|PUT|PATCH|DELETE)$/.test(b.nome) && AUTH.test(b.corpo)).map((b) => b.nome));
  return bs.filter((b) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(b.nome)).filter((b) => {
    if (AUTH.test(b.corpo)) return false;
    return ![...locaisComAuth].some((n) => new RegExp(`\\b${n}\\(`).test(b.corpo));
  }).map((b) => b.nome);
}

function rotaDe(arquivo) {
  const rel = relative(join(raiz, "src", "app"), dirname(arquivo)).split(sep).join("/");
  return "/" + rel;
}

const linhas = [];
let falhou = false;
for (const arquivo of varrer(pastaApi).sort()) {
  const fonte = readFileSync(arquivo, "utf8");
  const rota = rotaDe(arquivo);
  const metodos = [...fonte.matchAll(METODO)].map((m) => m[1] || m[2]);
  const temAuth = AUTH.test(fonte);
  const temLimite = LIMITE.test(fonte);
  const achados = [];

  const excecao = EXCECOES_AUTH[rota];
  const publica = LEITURA_PUBLICA.some((r) => r.test(rota)) || LEITURA_PUBLICA_CONFERIDA[rota];
  if (!excecao) {
    for (const m of metodosSemSessao(fonte)) {
      if (m === "GET" && publica) continue;
      achados.push(m === "GET" ? `MÉDIO: ${m} sem conferência de sessão` : `ALTO: ${m} sem conferência de sessão`);
      if (m !== "GET") falhou = true;
    }
  }
  if (!temLimite && (!temAuth || excecao || publica)) achados.push("MÉDIO: rota pública sem limite de requisições");
  if (SQL_TEXTO.test(fonte)) achados.push("ALTO: SQL montado com texto interpolado");
  if (FILTRO_INTERPOLADO.test(fonte)) achados.push("MÉDIO: filtro do PostgREST com valor interpolado (.or/.filter)");
  if (FETCH_VARIAVEL.test(fonte)) achados.push("REVISAR: fetch com endereço variável (SSRF?)");
  if (UPLOAD.test(fonte) && /formData\(\)/.test(fonte)) {
    if (!UPLOAD_TAMANHO.test(fonte)) achados.push("ALTO: upload sem limite de tamanho");
    if (!UPLOAD_TIPO.test(fonte)) achados.push("MÉDIO: upload sem conferência de tipo");
    if (!/conferirArquivo\(|tipoReal\(/.test(fonte)) achados.push("BAIXO: tipo do arquivo pela extensão/cabeçalho, sem conferir o conteúdo");
  }
  if (SELECT_TUDO.test(fonte)) achados.push("REVISAR: select(\"*\") — conferir se a linha inteira chega ao cliente");

  linhas.push({
    rota, metodos: metodos.join(","),
    auth: temAuth ? "sim" : excecao ? `própria: ${excecao}` : publica ? "pública" : "NÃO",
    limite: temLimite ? "sim" : "não",
    achados,
  });
}

// Pontos de HTML cru no front (XSS)
const html = [];
for (const arquivo of varrerFront(join(raiz, "src"))) {
  const fonte = readFileSync(arquivo, "utf8");
  fonte.split("\n").forEach((l, i) => {
    if (/dangerouslySetInnerHTML|\.setHTML\(|\.innerHTML\s*=/.test(l)) {
      const trecho = fonte.split("\n").slice(i, i + 6).join("\n");
      // a atribuição de camada (fonte.attribution) vem da configuração do código, não de usuário
      const escapado = /escaparHtml\(|\.replace\(\/\[<>&\]/.test(trecho) || /TEMA_SCRIPT|JSON\.stringify|fonte\.attribution/.test(trecho);
      html.push({ arquivo: relative(raiz, arquivo).split(sep).join("/"), linha: i + 1, escapado });
    }
  });
}

if (modo === "json") {
  console.log(JSON.stringify({ rotas: linhas, html }, null, 2));
} else if (modo === "md") {
  console.log("| Rota | Métodos | Sessão | Limite | Achados automáticos |\n|---|---|---|---|---|");
  for (const l of linhas) console.log(`| \`${l.rota}\` | ${l.metodos} | ${l.auth} | ${l.limite} | ${l.achados.join("<br>") || "—"} |`);
  console.log("\n| HTML cru | Linha | Escapado |\n|---|---|---|");
  for (const h of html) console.log(`| \`${h.arquivo}\` | ${h.linha} | ${h.escapado ? "sim" : "**NÃO**"} |`);
} else {
  for (const l of linhas) {
    console.log(`${l.rota}  [${l.metodos}]  sessão: ${l.auth}  limite: ${l.limite}`);
    for (const a of l.achados) console.log(`    - ${a}`);
  }
  console.log("\nHTML cru no front:");
  for (const h of html) console.log(`  ${h.escapado ? "ok " : "NÃO"} ${h.arquivo}:${h.linha}`);
  console.log(`\n${linhas.length} rotas, ${linhas.reduce((n, l) => n + l.achados.length, 0)} achados para revisar.`);
}
if (falhou) process.exitCode = 1;
