import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { AsaasErro, asaasCobrancasPorReferencia, asaasCriarCobranca } from "@/lib/asaas";
import {clienteDoPlano} from "@/lib/clientes-asaas";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { pacoteDaAri, linkFaturaAri } from "@/lib/ia/pacote";
import { uuidAri } from "@/lib/ia/creditos";
import { falha } from "@/lib/erros";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const a = await ator();
  if (!a) return falha(401, "sem_sessao", "Entre para comprar créditos.");
  const oferta = await pacoteDaAri(a);
  if (!oferta?.ativo) return falha(503, "pacote_indisponivel", "A compra avulsa não está disponível neste perfil agora.");
  const limite = await limitar("ari:comprar:" + a.userId, 12, 600);
  if (!limite.permitido) return respostaLimite(limite, "solicitações de cobrança");
  const chave = request.headers.get("Idempotency-Key") ?? "";
  const dados = await request.json().catch(() => null);
  if (!uuidAri.test(chave) || !dados || ![dados.preco,dados.comprados,dados.cortesia,dados.meses].every(Number.isSafeInteger))
    return falha(400, "pedido_invalido", "Confira os dados do pacote.");
  const db = supabaseAdmin();
  const { data: pedido, error } = await db.rpc("fn_ari_pedido", { p_titular: a.userId, p_chave: chave, p_preco: dados.preco,
    p_comprados: dados.comprados, p_cortesia: dados.cortesia, p_meses: dados.meses }).single();
  if (error || !pedido) return falha(error?.code === "40001" ? 409 : 503, "pedido_indisponivel", "Atualize a página para conferir a oferta vigente.");
  const p = pedido as { id: string; status: string; cliente: string | null; link: string | null; preco: number; comprados: number; cortesia: number; validade_meses: number };
  if (p.status === "paga") return NextResponse.json({ status: "paga" });
  if (["cancelada","estornada"].includes(p.status)) return falha(409, "pedido_encerrado", "Este pedido foi encerrado. Atualize a página.");
  if (p.preco !== dados.preco || p.comprados !== dados.comprados || p.cortesia !== dados.cortesia || p.validade_meses !== dados.meses)
    return falha(409, "pedido_anterior", "Há um pedido anterior com outras condições. Consulte as compras na carteira.");
  if (p.status === "aberta" && p.link) return NextResponse.json({ status: "aberta", url: linkFaturaAri(p.link) });

  let emitir = false;
  let cliente = p.cliente;
  const ref = "ari_" + p.id;
  try {
    if (p.status === "nova") {
      try { cliente=await clienteDoPlano(a.userId); }
      catch(e) {return falha(422,"cadastro_cobranca",e instanceof Error && e.message.startsWith("Complete o CPF")?e.message:"Aguarde a confirmação do cadastro de cobrança no Asaas.");}
      const { data: reserva, error: erroReserva } = await db.from("ari_compras").update({ status: "emitindo", cliente })
        .eq("id", p.id).eq("status", "nova").select("id").maybeSingle();
      if (erroReserva) return falha(503, "pedido_indisponivel", "Tente novamente em instantes.");
      emitir = !!reserva;
    }
    const dataVencimento = new Date(Date.now() + 3 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const cobrancas = emitir ? [await asaasCriarCobranca({ customer: cliente!, value: p.preco / 100, dueDate: dataVencimento,
      description: "Pacote avulso de créditos da Ari", externalReference: ref })] : await asaasCobrancasPorReferencia(ref);
    if (cobrancas.length !== 1 || !cobrancas[0] || cobrancas[0].deleted) return NextResponse.json({ status: "emitindo" }, { status: 202 });
    const cobranca = cobrancas[0];
    const url = linkFaturaAri(cobranca.invoiceUrl);
    if (!url) return falha(503, "fatura_indisponivel", "Aguarde a disponibilização do link na sua carteira.");
    const { error: erroLink } = await db.from("ari_compras").update({ link: url, pagamento: cobranca.id, status: "aberta" })
      .eq("id", p.id).eq("status", "emitindo");
    if (erroLink) return falha(503, "fatura_indisponivel", "A cobrança foi registrada. Consulte a carteira novamente.");
    return NextResponse.json({ status: "aberta", url });
  } catch (e) {
    // Uma falha de transporte pode ter ocorrido depois de o gateway criar a cobrança.
    // Somente rejeição definitiva permite outro POST. Os demais casos conciliam pela referência.
    if (emitir && e instanceof AsaasErro && [400,401,403,422].includes(e.status)) {
      await db.from("ari_compras").update({ status: "nova" }).eq("id", p.id).eq("status", "emitindo");
    }
    return falha(503, "falha_cobranca", "Não foi possível confirmar a emissão. Consulte a carteira e tente novamente.");
  }
}