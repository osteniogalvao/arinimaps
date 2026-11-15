import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eventoFiscalAssinatura } from "@/lib/nfse-assinaturas";
import { CNPJ_TECNOLOGIA, faturaDaReferencia } from "@/lib/nfse-regras";
import { limitarEmMemoria } from "@/lib/geo/limiteMemoria";
import { ipDoPedido, respostaLimite } from "@/lib/seguranca/limite";

export async function POST(req: Request) {
  const esperado = Buffer.from(process.env.ASAAS_NFSE_TECNOLOGIA_WEBHOOK_TOKEN ?? "");
  const recebido = Buffer.from(req.headers.get("asaas-access-token") ?? "");
  if (!esperado.length) return NextResponse.json({error: "Webhook fiscal desativado."}, { status: 503 });
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
    const limite = limitarEmMemoria("nfse-tecnologia:negado:" + ipDoPedido(req), 20, 60);
    if (!limite.permitido) return respostaLimite(limite, "autenticação fiscal");
    return NextResponse.json({error: "Acesso negado."}, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const fatura = faturaDaReferencia(body?.invoice?.externalReference);
  if (typeof body?.event === "string" && body.event.startsWith("INVOICE_") && typeof body.invoice?.id === "string") {
    try { await eventoFiscalAssinatura(fatura, body.invoice.id, CNPJ_TECNOLOGIA); }
    catch { return NextResponse.json({error: "Falha ao conferir a NFS-e. Reenvie o evento."}, { status: 503 }); }
  }
  return NextResponse.json({ok: true});
}
