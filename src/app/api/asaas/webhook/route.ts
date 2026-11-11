import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { timingSafeEqual } from "node:crypto";
import type { AsaasNota } from "@/lib/asaas";
import { camposDaNota } from "@/lib/modulos/financeiro";

/** Comparação em tempo constante: o tempo de resposta não revela quantos caracteres acertaram. */
function tokenConfere(recebido: string | null, esperado: string) {
  const a = Buffer.from(recebido ?? "");
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook do Asaas (API v3): mensalidade (invoices) e comissão (commissions).
 * Configure com authToken = ASAAS_WEBHOOK_TOKEN (header `asaas-access-token`);
 * o cadastro é feito por scripts/asaas-webhook.mjs — ver docs/ASAAS.md.
 *
 * Regras de entrega do Asaas que moldam este arquivo:
 *  - "pelo menos uma vez": o mesmo evento pode chegar de novo. O id do evento
 *    (evt_...) é gravado em asaas_webhook_events; o segundo envio é ignorado.
 *    Além disso, toda mudança é condicionada ao status atual (só muda se ainda
 *    não mudou) e só audita quando alguma linha mudou.
 *  - 15 falhas seguidas pausam a fila. Evento desconhecido, referência que não
 *    é nossa ou payload estranho respondem 200. Só falha de banco responde 500
 *    (para o Asaas reenviar depois).
 */
const EVENTOS = [
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_DELETED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
] as const;
type Evento = (typeof EVENTOS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

type Pagamento = {
  id: string;
  externalReference?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
};

type Admin = ReturnType<typeof supabaseAdmin>;

class ErroBanco extends Error {}
function checa<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new ErroBanco(r.error.message);
  return r.data;
}

function hojeSP() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function dataPagamento(p: Pagamento) {
  const d = [p.paymentDate, p.clientPaymentDate, p.confirmedDate].find((x) => x && DATA.test(x.slice(0, 10)));
  return d ? d.slice(0, 10) : hojeSP();
}

/** Assinatura volta a "ativa" quando não sobra fatura vencida/estornada. */
async function reativarSeQuitada(admin: Admin, subscriptionId: string) {
  const r = await admin.from("invoices").select("id", { count: "exact", head: true })
    .eq("subscription_id", subscriptionId).not("status", "in", "(paga,aberta)"); // vencida/estornada
  if (r.error) throw new ErroBanco(r.error.message);
  if (!r.count) checa(await admin.from("subscriptions").update({ status: "ativa" }).eq("id", subscriptionId).eq("status", "inadimplente"));
}

async function marcarInadimplente(admin: Admin, subscriptionId: string) {
  checa(await admin.from("subscriptions").update({ status: "inadimplente" })
    .eq("id", subscriptionId).in("status", ["ativa", "pendente"]));
}

/** Aplica o evento numa fatura. Devolve a ação de auditoria se algo mudou. */
async function eventoFatura(admin: Admin, evento: Evento, p: Pagamento, inv: { id: string; subscription_id: string }) {
  const base = () => admin.from("invoices");
  let mudou: { id: string }[] = [];
  let acao = "";
  let depois: Record<string, unknown> = {};

  switch (evento) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_CONFIRMED": {
      const pago_em = dataPagamento(p);
      mudou = checa(await base().update({ status: "paga", pago_em, gateway_id: p.id })
        .eq("id", inv.id).in("status", ["aberta", "vencida"]).select("id")) ?? [];
      if (mudou.length) await reativarSeQuitada(admin, inv.subscription_id);
      acao = "fatura_paga_asaas"; depois = { status: "paga", pago_em };
      break;
    }
    case "PAYMENT_OVERDUE":
      mudou = checa(await base().update({ status: "vencida" })
        .eq("id", inv.id).eq("gateway_id", p.id).eq("status", "aberta").select("id")) ?? [];
      if (mudou.length) await marcarInadimplente(admin, inv.subscription_id);
      acao = "fatura_vencida_asaas"; depois = { status: "vencida" };
      break;
    case "PAYMENT_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
      mudou = checa(await base().update({ status: "estornada", pago_em: null })
        .eq("id", inv.id).eq("gateway_id", p.id).eq("status", "paga").select("id")) ?? [];
      // chargeback = cliente contestou: a mensalidade volta a dever
      if (mudou.length && evento === "PAYMENT_CHARGEBACK_REQUESTED") await marcarInadimplente(admin, inv.subscription_id);
      acao = evento === "PAYMENT_REFUNDED" ? "fatura_estornada_asaas" : "fatura_chargeback_asaas"; depois = { status: "estornada" };
      break;
    case "PAYMENT_RECEIVED_IN_CASH_UNDONE":
      mudou = checa(await base().update({ status: "aberta", pago_em: null })
        .eq("id", inv.id).eq("gateway_id", p.id).eq("status", "paga").select("id")) ?? [];
      acao = "fatura_pagamento_desfeito_asaas"; depois = { status: "aberta" };
      break;
    case "PAYMENT_DELETED":
      // cobrança removida no Asaas: a fatura continua devida, só perde o vínculo
      // (o botão "Cobrar via Asaas" gera outra)
      mudou = checa(await base().update({ gateway_id: null })
        .eq("id", inv.id).eq("gateway_id", p.id).neq("status", "paga").select("id")) ?? [];
      acao = "fatura_cobranca_removida_asaas"; depois = { gateway_id: null };
      break;
  }
  return mudou.length ? { acao, entidade: "invoices", id: inv.id, depois } : null;
}

async function eventoComissao(admin: Admin, evento: Evento, p: Pagamento, comId: string) {
  const base = () => admin.from("commissions");
  let mudou: { id: string }[] = [];
  let acao = "";
  let depois: Record<string, unknown> = {};

  switch (evento) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_CONFIRMED": {
      const pago_em = dataPagamento(p);
      mudou = checa(await base().update({ status: "paga", pago_em })
        .eq("id", comId).in("status", ["registrada", "cobrada"]).select("id")) ?? [];
      acao = "comissao_paga_asaas"; depois = { status: "paga", pago_em };
      break;
    }
    case "PAYMENT_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
    case "PAYMENT_RECEIVED_IN_CASH_UNDONE":
      // dinheiro devolvido/contestado: volta a "cobrada" (a receber de novo)
      mudou = checa(await base().update({ status: "cobrada", pago_em: null })
        .eq("id", comId).in("status", ["paga", "conciliada"]).select("id")) ?? [];
      acao = evento === "PAYMENT_REFUNDED" ? "comissao_estornada_asaas"
        : evento === "PAYMENT_CHARGEBACK_REQUESTED" ? "comissao_chargeback_asaas" : "comissao_pagamento_desfeito_asaas";
      depois = { status: "cobrada" };
      break;
    case "PAYMENT_DELETED":
      mudou = checa(await base().update({ status: "registrada" })
        .eq("id", comId).eq("status", "cobrada").select("id")) ?? [];
      acao = "comissao_cobranca_removida_asaas"; depois = { status: "registrada" };
      break;
    case "PAYMENT_OVERDUE":
      // comissão não tem estado "vencida": nada a mudar
      break;
  }
  return mudou.length ? { acao, entidade: "commissions", id: comId, depois } : null;
}

export async function POST(request: Request) {
  const token = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!token) return NextResponse.json({ error: "Webhook desativado." }, { status: 503 });
  if (!tokenConfere(request.headers.get("asaas-access-token"), token)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown; event?: unknown; payment?: Pagamento; invoice?: AsaasNota } | null;

  // nota fiscal (central fiscal, migration 0066): só atualiza a situação da nota nossa
  if (typeof body?.event === "string" && body.event.startsWith("INVOICE_") && body.invoice && typeof body.invoice.id === "string") {
    const admin = supabaseAdmin();
    const { data: nota } = await admin.from("notas_fiscais").select("id, status").eq("gateway_id", body.invoice.id).maybeSingle();
    if (!nota) return NextResponse.json({ ok: true, ignorado: "nota de outro sistema" });
    const campos = camposDaNota(body.invoice);
    const { error } = await admin.from("notas_fiscais").update(campos).eq("id", nota.id);
    if (error) return NextResponse.json({ error: "Falha ao gravar." }, { status: 500 });
    if (campos.status !== nota.status) {
      await logAudit({ acao: "nota_fiscal_asaas", entidade: "notas_fiscais", entidade_id: nota.id, dados_antes: { status: nota.status }, dados_depois: campos });
    }
    return NextResponse.json({ ok: true });
  }
  const evento = typeof body?.event === "string" ? body.event : undefined;
  const pagamento = body?.payment && typeof body.payment.id === "string" ? body.payment : undefined;
  const eventoId = typeof body?.id === "string" && body.id.length <= 200 ? body.id : null;

  if (!evento || !pagamento) return NextResponse.json({ ok: true, ignorado: "payload sem evento de cobrança" });
  if (!(EVENTOS as readonly string[]).includes(evento)) return NextResponse.json({ ok: true, ignorado: "evento não tratado" });
  const ref = pagamento.externalReference ?? "";
  if (!UUID.test(ref)) return NextResponse.json({ ok: true, ignorado: "sem referência deste sistema" });

  const admin = supabaseAdmin();

  // idempotência pelo id do evento
  let registrado = false;
  if (eventoId) {
    const { error } = await admin.from("asaas_webhook_events")
      .insert({ id: eventoId, evento, payment_id: pagamento.id, external_reference: ref });
    if (error?.code === "23505") return NextResponse.json({ ok: true, duplicado: true });
    if (error) console.error("asaas_webhook_events indisponível (segue só com a idempotência por status):", error.message);
    else registrado = true;
  }

  try {
    const inv = checa(await admin.from("invoices").select("id, subscription_id").eq("id", ref).maybeSingle());
    let efeito: Awaited<ReturnType<typeof eventoFatura>> = null;
    if (inv) {
      efeito = await eventoFatura(admin, evento as Evento, pagamento, inv);
    } else {
      const com = checa(await admin.from("commissions").select("id").eq("id", ref).maybeSingle());
      if (com) efeito = await eventoComissao(admin, evento as Evento, pagamento, com.id);
    }
    if (efeito) {
      await logAudit({
        acao: efeito.acao, entidade: efeito.entidade, entidade_id: efeito.id,
        dados_depois: { ...efeito.depois, gateway: pagamento.id, evento, evento_id: eventoId },
      });
    }
    return NextResponse.json({ ok: true, efeito: efeito?.acao ?? null });
  } catch (e) {
    // falha de banco: libera o id do evento e pede reenvio ao Asaas
    console.error(`webhook Asaas ${evento} ${pagamento.id} falhou:`, (e as Error).message);
    if (registrado) await admin.from("asaas_webhook_events").delete().eq("id", eventoId!);
    return NextResponse.json({ error: "Falha temporária ao processar." }, { status: 500 });
  }
}
