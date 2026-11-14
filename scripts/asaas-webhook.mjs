// Cadastra (ou atualiza) no Asaas o webhook deste sistema — ver docs/ASAAS.md.
//
// Uso:
//   node scripts/asaas-webhook.mjs                      → simula (padrão): lista e mostra o que faria
//   node scripts/asaas-webhook.mjs --simular            → idem
//   node scripts/asaas-webhook.mjs --aplicar            → cria/atualiza de verdade
//   opções: --site=https://arinibrasil.com.br  --email=financeiro@...
//
// Lê do ambiente ou do .env.local: ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN,
// ASAAS_BASE_URL (opcional; sandbox = https://api-sandbox.asaas.com/v3),
// NEXT_PUBLIC_SITE_URL (se não vier --site), ASAAS_WEBHOOK_EMAIL (se não vier --email).
//
// Só mexe no webhook chamado NOME_WEBHOOK ou no que já aponta para a URL deste
// sistema. Qualquer outro webhook da conta (ex.: "Arini", de outro sistema) é
// apenas listado, nunca alterado.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const NOME_WEBHOOK = "Arini Imóveis Brasil";
const EVENTOS = [
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_DELETED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  "INVOICE_CREATED",
  "INVOICE_UPDATED",
  "INVOICE_SYNCHRONIZED",
  "INVOICE_AUTHORIZED",
  "INVOICE_PROCESSING_CANCELLATION",
  "INVOICE_CANCELED",
  "INVOICE_CANCELLATION_DENIED",
  "INVOICE_ERROR",
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const opt = (nome) => args.find((a) => a.startsWith(`--${nome}=`))?.split("=").slice(1).join("=");
const aplicar = args.includes("--aplicar");
if (aplicar && args.includes("--simular")) { console.error("Use --aplicar OU --simular, não os dois."); process.exit(1); }

const BASE = (process.env.ASAAS_BASE_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
const chave = process.env.ASAAS_API_KEY ?? "";
const token = process.env.ASAAS_WEBHOOK_TOKEN ?? "";
const site = (opt("site") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
const email = opt("email") ?? process.env.ASAAS_WEBHOOK_EMAIL ?? "";

const erros = [];
if (!chave) erros.push("ASAAS_API_KEY ausente.");
if (token.length < 32 || token.length > 255 || /\s/.test(token)) erros.push("ASAAS_WEBHOOK_TOKEN precisa ter de 32 a 255 caracteres, sem espaços (regra do Asaas).");
if (!/^https:\/\//.test(site)) erros.push("Site inválido: passe --site=https://... ou defina NEXT_PUBLIC_SITE_URL com https.");
if (/localhost|127\.0\.0\.1/.test(site)) erros.push("O Asaas não alcança localhost: use o domínio público.");
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.push("E-mail de aviso do webhook ausente: passe --email=... ou defina ASAAS_WEBHOOK_EMAIL.");
if (erros.length) { for (const e of erros) console.error("✗ " + e); process.exit(1); }

const url = `${site}/api/asaas/webhook`;
const ambiente = BASE.includes("sandbox") ? "SANDBOX" : "PRODUÇÃO";
console.log(`Asaas ${ambiente} (${BASE}) — modo ${aplicar ? "APLICAR" : "SIMULAR"}`);
console.log(`Webhook alvo: "${NOME_WEBHOOK}" → ${url}\n`);

async function api(caminho, metodo = "GET", body) {
  const res = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "User-Agent": "AriniImoveisBrasil/1.0 (script webhook)", access_token: chave },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* não-JSON */ }
  if (!res.ok) {
    const desc = json?.errors?.map((e) => e.description).join(" ") || texto.slice(0, 300);
    throw new Error(`${metodo} ${caminho} → ${res.status}: ${desc}`);
  }
  return json;
}

async function listar() {
  const todos = [];
  for (let offset = 0; ; offset += 100) {
    const r = await api(`/webhooks?offset=${offset}&limit=100`);
    todos.push(...(r?.data ?? []));
    if (!r?.hasMore) return todos;
  }
}

try {
  const webhooks = await listar();
  console.log(`Webhooks na conta: ${webhooks.length}`);
  for (const w of webhooks) {
    console.log(`  · ${w.name} → ${w.url} [${w.enabled ? "ativo" : "inativo"}${w.interrupted ? ", FILA PAUSADA" : ""}${w.penalizedRequestsCount ? `, ${w.penalizedRequestsCount} falhas` : ""}]`);
  }

  const nosso = webhooks.find((w) => w.name === NOME_WEBHOOK) ?? webhooks.find((w) => w.url === url);
  const corpo = {
    name: NOME_WEBHOOK, url, email, enabled: true, interrupted: false,
    apiVersion: 3, authToken: token, sendType: "SEQUENTIALLY", events: EVENTOS,
  };
  const mostrar = { ...corpo, authToken: `(ASAAS_WEBHOOK_TOKEN, ${token.length} caracteres)` };

  if (!nosso) {
    if (webhooks.length >= 10) throw new Error("A conta já tem 10 webhooks (limite do Asaas). Remova um antes.");
    console.log(`\n→ CRIAR webhook:\n${JSON.stringify(mostrar, null, 2)}`);
    if (aplicar) {
      const r = await api("/webhooks", "POST", corpo);
      console.log(`✓ criado (id ${r.id}).`);
    }
  } else {
    const faltando = EVENTOS.filter((e) => !nosso.events?.includes(e));
    console.log(`\n→ ATUALIZAR webhook existente "${nosso.name}" (id ${nosso.id}).`);
    if (nosso.url !== url) console.log(`  url: ${nosso.url} → ${url}`);
    if (faltando.length) console.log(`  eventos a incluir: ${faltando.join(", ")}`);
    if (nosso.interrupted) console.log("  fila está PAUSADA → será reativada (interrupted=false)");
    console.log("  authToken será regravado com ASAAS_WEBHOOK_TOKEN.");
    if (aplicar) {
      const { email: _e, apiVersion: _v, ...atualizacao } = corpo; // PUT não aceita email/apiVersion
      await api(`/webhooks/${encodeURIComponent(nosso.id)}`, "PUT", atualizacao);
      console.log("✓ atualizado.");
    }
  }
  if (!aplicar) console.log("\nNada foi alterado (simulação). Rode com --aplicar para gravar.");
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
