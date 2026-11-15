import "server-only";
import { asaasBuscarCobranca, asaasPagarComCartaoAutorizado, type AsaasCobranca } from "@/lib/asaas";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Fatura = { id: string; status: string; pagamento: string | null; valor: number; operacao: string | null };
type Autorizacao = {
  assinatura: string; origem: string; autorizado_em: string; final: string; situacao: string;
};

export function mesmaCobranca(c: AsaasCobranca | null, f: Pick<Fatura, "id" | "pagamento" | "valor">, cliente: string) {
  return !!c && !c.deleted && c.customer === cliente && c.externalReference === "plano_" + f.id &&
    c.id === f.pagamento && Number.isFinite(c.value) && Math.round(Number(c.value) * 100) === f.valor;
}

async function autorizacao(assinatura: string) {
  const r = await supabaseAdmin().from("assinatura_cartao").select("assinatura,origem,autorizado_em,final,situacao")
    .eq("assinatura", assinatura).maybeSingle();
  if (r.error) throw Error("Falha ao conferir autorização do cartão.");
  return r.data as Autorizacao | null;
}

// O Asaas só entrega um token reutilizável em contas habilitadas. Ele existe exclusivamente durante esta operação.
async function verificarOrigem(a: Autorizacao, cliente: string) {
  const db = supabaseAdmin();
  const { data: f, error } = await db.from("faturas_cotadas").select("id,pagamento,status,valor,operacao")
    .eq("id", a.origem).eq("assinatura", a.assinatura).single();
  if (error) throw Error("Falha ao consultar a fatura autorizada.");
  if (!f.pagamento || f.status !== "paga" || f.operacao) return null;
  const c = await asaasBuscarCobranca(f.pagamento);
  if (!mesmaCobranca(c, f, cliente) || !c || !["CONFIRMED","RECEIVED"].includes(c.status)) return null;
  const token = c.billingType === "CREDIT_CARD" && c.creditCard?.creditCardNumber === a.final ? c.creditCard.creditCardToken : null;
  const situacao = token ? "ativo" : "indisponivel";
  if (a.situacao !== situacao) {
    const r = await db.from("assinatura_cartao").update({situacao}).eq("assinatura", a.assinatura)
      .eq("origem", a.origem).eq("autorizado_em", a.autorizado_em);
    if (r.error) throw Error("Falha ao conferir o cartão da assinatura.");
  }
  return token || null;
}

export async function conferirCartao(assinatura: string, cliente: string) {
  const a = await autorizacao(assinatura);
  return a ? !!await verificarOrigem(a, cliente) : false;
}

export async function conferirCartaoPago(fatura: string, cliente: string) {
  const r = await supabaseAdmin().from("assinatura_cartao").select("assinatura,origem,autorizado_em,final,situacao")
    .eq("origem", fatura).eq("situacao","aguardando").maybeSingle();
  if (r.error) throw Error("Falha ao localizar autorização do cartão.");
  if (r.data) await verificarOrigem(r.data as Autorizacao, cliente);
}

export async function pagarRenovacaoNoCartao(assinatura: string, cliente: string, f: Fatura & {inicio:string}, c: AsaasCobranca) {
  if (c.status !== "PENDING" || c.dueDate !== f.inicio || !mesmaCobranca(c, f, cliente) || !f.pagamento) return;
  const a = await autorizacao(assinatura);
  if (!a || a.origem === f.id || a.situacao === "indisponivel") return;
  const token = await verificarOrigem(a, cliente);
  if (!token) return;
  const {data: reservada, error} = await supabaseAdmin().rpc("assinatura_reservar_cartao", {
    p_id: f.id, p_origem: a.origem, p_autorizado: a.autorizado_em,
  });
  if (error) throw Error("Falha ao reservar pagamento automático.");
  if (!reservada) return;
  await asaasPagarComCartaoAutorizado(f.pagamento, token);
}
