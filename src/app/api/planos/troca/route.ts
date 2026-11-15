import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { checkoutAtivo, conciliarFatura } from "@/lib/assinaturas-cotadas";
import { supabaseAdmin } from "@/lib/supabase/admin";

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export async function POST(req: Request) {
  const pessoa = await ator();
  if (!pessoa) return falha(401, "sessao", "Entre para consultar a proposta.");
  const limite = await limitar("troca-plano:" + pessoa.userId, 24, 300);
  if (!limite.permitido) return respostaLimite(limite, "operações");
  const body = await req.json().catch(() => null);
  if (!body || !uuid.test(body.oferta) || !["prever", "confirmar"].includes(body.acao)) {
    return falha(400, "pedido", "Informe uma proposta válida.");
  }
  const db = supabaseAdmin();
  const args = { p_titular: pessoa.userId, p_oferta: body.oferta };
  const erro = (e: { code: string; message: string }) => falha(
    e.code === "42501" ? 403 : 409, "troca", e.code === "55000" ? e.message : "Esta troca está indisponível para o perfil ativo.",
  );
  if (body.acao === "prever") {
    const { data, error } = await db.rpc("assinatura_prever_troca", args);
    if (error) return erro(error);
    if (!data) return falha(409, "troca", "A proposta já foi utilizada ou o perfil não possui assinatura ativa.");
    return NextResponse.json(data);
  }
  if (!body.previa || !uuid.test(body.previa.assinatura) || body.aceito !== true) {
    return falha(400, "aceite", "Confira e aceite os valores da troca.");
  }
  if (body.previa.valor > 0 && !checkoutAtivo()) return falha(503, "gateway", "A emissão da cobrança está indisponível.");
  const { error } = await db.rpc("assinatura_confirmar_troca", { ...args, p_previa: body.previa });
  if (error) return erro(error);
  const { data } = await db.from("assinatura_trocas").select("assinatura,fatura,status").eq("oferta", body.oferta).single();
  if (data?.fatura && data.status === "pendente") {
    await conciliarFatura(data.fatura).catch(() => undefined); // A reserva permanece na fila durável do worker.
  }
  return NextResponse.json({ assinatura: data?.assinatura ?? body.previa.assinatura });
}
