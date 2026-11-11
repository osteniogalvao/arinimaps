import "server-only";

/**
 * Integração Asaas (mensalidade e cobrança de comissão) — API v3.
 * Sem ASAAS_API_KEY no env, tudo devolve null — o restante do sistema
 * funciona com controle manual. Sandbox: ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
 * (ver docs/ASAAS.md).
 */
const BASE = (process.env.ASAAS_BASE_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");

// Contas raiz criadas a partir de 13/06/2024 exigem User-Agent em toda requisição.
const USER_AGENT = "AriniImoveisBrasil/1.0 (Next.js)";

function headers() {
  return {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    access_token: process.env.ASAAS_API_KEY ?? "",
  };
}

export function asaasConfigurado() {
  return !!process.env.ASAAS_API_KEY;
}

/**
 * Falha da API do Asaas. `mensagem` é segura para mostrar ao operador
 * (vem do `errors[].description` do Asaas ou é texto nosso); o corpo bruto
 * fica só no log do servidor.
 */
export class AsaasErro extends Error {
  constructor(public status: number, public mensagem: string, public codigos: string[] = []) {
    super(`Asaas ${status}: ${mensagem}`);
    this.name = "AsaasErro";
  }
}

async function chamar<T>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${caminho}`, {
      method: init.method ?? "GET",
      headers: headers(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error(`Asaas ${init.method ?? "GET"} ${caminho.split("?")[0]} sem resposta:`, (e as Error).message);
    throw new AsaasErro(0, "O Asaas não respondeu a tempo.");
  }
  if (res.ok) return (await res.json()) as T;

  const texto = await res.text().catch(() => "");
  console.error(`Asaas ${init.method ?? "GET"} ${caminho.split("?")[0]} → ${res.status}: ${texto.slice(0, 500)}`);
  let erros: { code?: string; description?: string }[] = [];
  try { erros = (JSON.parse(texto) as { errors?: typeof erros }).errors ?? []; } catch { /* corpo não-JSON */ }
  const codigos = erros.map((e) => e.code ?? "").filter(Boolean);
  const descricao = erros.map((e) => e.description).filter(Boolean).join(" ");
  const mensagem =
    res.status === 401 ? "A chave do Asaas foi recusada (inválida, revogada ou de outro ambiente)."
    : res.status === 403 ? "O Asaas bloqueou a requisição (conta sem permissão ou cadastro pendente)."
    : res.status === 429 ? "Limite de requisições do Asaas atingido."
    : res.status >= 500 ? "O Asaas está instável no momento."
    : descricao || "O Asaas recusou os dados enviados.";
  throw new AsaasErro(res.status, mensagem, codigos);
}

type Lista<T> = { data: T[]; hasMore: boolean };
export type AsaasCliente = { id: string; deleted?: boolean };
export type AsaasCobranca = { id: string; invoiceUrl: string; status: string; deleted?: boolean };

/** Cliente pelo nosso identificador (externalReference = profiles.user_id). */
export async function asaasBuscarClientePorReferencia(externalReference: string) {
  if (!asaasConfigurado()) return null;
  const r = await chamar<Lista<AsaasCliente>>(`/customers?externalReference=${encodeURIComponent(externalReference)}&limit=10`);
  return r.data.find((c) => !c.deleted) ?? null;
}

export async function asaasCriarCliente(dados: {
  name: string;
  cpfCnpj: string;            // obrigatório na API v3
  email?: string;
  mobilePhone?: string;
  externalReference?: string; // profiles.user_id
}) {
  if (!asaasConfigurado()) return null;
  return chamar<AsaasCliente>("/customers", { method: "POST", body: { notificationDisabled: false, ...dados } });
}

export async function asaasBuscarCobranca(id: string) {
  if (!asaasConfigurado()) return null;
  try {
    return await chamar<AsaasCobranca>(`/payments/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof AsaasErro && e.status === 404) return null; // removida
    throw e;
  }
}

export async function asaasCriarCobranca(dados: {
  customer: string;
  value: number;
  dueDate: string; // yyyy-mm-dd
  description: string;
  externalReference: string; // invoice.id ou commission.id
}) {
  if (!asaasConfigurado()) return null;
  // UNDEFINED = cliente escolhe Pix/boleto/cartão na fatura
  return chamar<AsaasCobranca>("/payments", { method: "POST", body: { billingType: "UNDEFINED", ...dados } });
}

// ---------------------------------------------------------------------------
// Central fiscal (migration 0066): nota fiscal de serviço (NFS-e) pelo Asaas.
// A conta precisa ter a emissão de notas configurada no painel do Asaas
// (certificado, inscrição municipal e serviço municipal).
// ---------------------------------------------------------------------------
export type AsaasNota = {
  id: string; status: string; number?: string | null; pdfUrl?: string | null; xmlUrl?: string | null;
  statusDescription?: string | null;
};

export async function asaasEmitirNota(dados: {
  customer: string;
  serviceDescription: string;
  observations: string;
  value: number;
  effectiveDate: string; // yyyy-mm-dd
  municipalServiceCode?: string;
  municipalServiceName: string;
  iss: number;
  externalReference: string;
}) {
  if (!asaasConfigurado()) return null;
  const { iss, ...resto } = dados;
  const nota = await chamar<AsaasNota>("/invoices", {
    method: "POST",
    body: {
      ...resto, deductions: 0,
      taxes: { retainIss: false, iss, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0 },
    },
  });
  // agendada no Asaas: pede a emissão já
  return chamar<AsaasNota>(`/invoices/${encodeURIComponent(nota.id)}/authorize`, { method: "POST" }).catch(() => nota);
}

export async function asaasBuscarNota(id: string) {
  if (!asaasConfigurado()) return null;
  return chamar<AsaasNota>(`/invoices/${encodeURIComponent(id)}`);
}

export async function asaasCancelarNota(id: string) {
  if (!asaasConfigurado()) return null;
  return chamar<AsaasNota>(`/invoices/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}
