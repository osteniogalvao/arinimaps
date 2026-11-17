import { ator } from "@/lib/authz";
import { asaasBuscarCobranca, asaasConfigurado, asaasPixDaCobranca } from "@/lib/asaas";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canalDoTitular } from "@/lib/confirmacao-whatsapp";
import {
  enviarModeloWhatsapp,
  enviarPixNaJanela,
  MetaErro,
  modeloWhatsappAprovado,
  subirImagemWhatsapp,
  provedorWhatsapp,
  segredoWhatsapp,
  whatsappConfigurado,
} from "@/lib/meta";
import { consentimentoDaConta } from "@/lib/privacidade/consentimento";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";

const resposta = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
type Modelo = NonNullable<Awaited<ReturnType<typeof modeloWhatsappAprovado>>>;
type Entrega = {
  tipo: "livre" | "modelo" | "link" | "confirmar" | "indisponivel";
  numero?: string;
  modelo?: Modelo;
};
async function entregaDoTitular(id: string): Promise<Entrega> {
  if (
    !whatsappConfigurado() ||
    !segredoWhatsapp() ||
    !(await consentimentoDaConta(id, "whatsapp_assinatura"))
  )
    return { tipo: "indisponivel" };
  const canal = await canalDoTitular(id);
  if (!canal?.verificado) return { tipo: "confirmar" };
  if (Date.parse(canal.janela_ate ?? "") > Date.now() + 30000)
    return { tipo: "livre", numero: canal.telefone };
  // A Evolution não tem modelo aprovado nem janela de 24 h: o Pix vai como imagem com o texto da ARINI.
  if (provedorWhatsapp() === "evolution") {
    const texto = await modeloWhatsappAprovado("1", 2, true, "pix");
    if (texto) return { tipo: "modelo", numero: canal.telefone, modelo: texto };
  }
  const pix = await modeloWhatsappAprovado(process.env.WHATSAPP_PIX_TEMPLATE_ID, 2, true, "pix").catch(() => null);
  if (pix) return { tipo: "modelo", numero: canal.telefone, modelo: pix };
  const link = await modeloWhatsappAprovado(process.env.WHATSAPP_FATURA_LINK_TEMPLATE_ID, 1, false, "fatura").catch(
    () => null,
  );
  return link ? { tipo: "link", numero: canal.telefone, modelo: link } : { tipo: "confirmar" };
}
async function processar(req: Request, whatsapp: boolean) {
  const a = await ator();
  if (!a) return resposta({ error: "Entre na conta." }, 401);
  const limite = await limitar("assinatura-pix:" + a.userId, 20, 600);
  if (!limite.permitido) return respostaLimite(limite, "consulta de Pix");
  const id = new URL(req.url).searchParams.get("fatura") ?? "";
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    return resposta({ error: "Fatura inválida." }, 400);
  const db = supabaseAdmin();
  const { data: f, error } = await db
    .from("faturas_cotadas")
    .select("id,pagamento,valor,assinatura,assinaturas_cotadas!inner(cliente,titular,cancelado)")
    .eq("id", id)
    .eq("assinaturas_cotadas.titular", a.userId)
    .is("assinaturas_cotadas.cancelado", null)
    .in("status", ["aberta", "vencida"])
    .is("operacao", null)
    .maybeSingle();
  if (error) return resposta({ error: "Falha ao consultar a fatura." }, 503);
  if (!f?.pagamento || !asaasConfigurado())
    return resposta({ error: "O Pix desta fatura está indisponível." }, 404);
  const s = f.assinaturas_cotadas as unknown as { cliente: string };
  try {
    const cobranca = await asaasBuscarCobranca(f.pagamento);
    if (
      !cobranca ||
      cobranca.deleted ||
      !["PENDING", "OVERDUE"].includes(cobranca.status) ||
      cobranca.externalReference !== "plano_" + id ||
      cobranca.customer !== s.cliente ||
      Math.round(Number(cobranca.value) * 100) !== f.valor
    )
      return resposta({ error: "Esta fatura já foi paga ou precisa de conferência." }, 409);
    const entrega = await entregaDoTitular(a.userId);
    const acao = whatsapp ? (await req.json().catch(() => ({ acao: "pix" })))?.acao : "pix";
    if (whatsapp && acao !== "pix" && acao !== "link")
      return resposta({ error: "Tipo de envio inválido." }, 400);
    if (whatsapp && (!entrega.numero || (entrega.tipo === "link") !== (acao === "link")))
      return resposta({ error: "Atualize a fatura e confirme a opção disponível para este número." }, 409);
    const pix = acao !== "link" ? await asaasPixDaCobranca(f.pagamento) : null;
    if (
      acao !== "link" &&
      (!pix ||
        typeof pix.payload !== "string" ||
        !pix.payload.startsWith("000201") ||
        pix.payload.length > 1024 ||
        typeof pix.encodedImage !== "string" ||
        !pix.encodedImage.startsWith("iVBOR") ||
        pix.encodedImage.length > 2_000_000)
    )
      return resposta({ error: "O Asaas não disponibilizou um QR Code válido." }, 503);
    if (!whatsapp) return resposta({ codigo: pix!.payload, imagem: pix!.encodedImage, canal: entrega.tipo });
    const { data: dia, error: er } = await db.rpc("assinatura_pix_reservar", {
      p_titular: a.userId,
      p_fatura: id,
      p_modo: entrega.tipo,
      p_telefone: entrega.numero,
    });
    if (er || !dia)
      return resposta(
        {
          error: er
            ? "Confira a situação da fatura, o consentimento e o telefone da conta."
            : "Este envio já foi solicitado hoje para a fatura.",
        },
        409,
      );
    let waId: string | null = null,
      status = "recusado";
    const portal = new URL(
      "/planos/solicitacoes",
      process.env.NEXT_PUBLIC_SITE_URL || "https://arinibrasil.com.br",
    );
    portal.searchParams.set("pedido", f.assinatura);
    try {
      if (entrega.tipo === "link") {
        waId = await enviarModeloWhatsapp(entrega.numero!, [portal.href], entrega.modelo!);
      } else {
        const media = await subirImagemWhatsapp(new Uint8Array(Buffer.from(pix!.encodedImage, "base64")));
        waId =
          entrega.tipo === "livre"
            ? await enviarPixNaJanela(entrega.numero!, media, pix!.payload)
            : await enviarModeloWhatsapp(
                entrega.numero!,
                [pix!.payload, portal.href],
                entrega.modelo!,
                media,
              );
      }
      status = "enviado";
    } catch (e) {
      if (e instanceof MetaErro && e.entregaIncerta) status = "conferir";
    }
    const { error: escrita } = await db
      .from("assinatura_pix_whatsapp")
      .update({ status, wa_id: waId })
      .eq("fatura", id)
      .eq("dia", dia)
      .eq("canal", acao);
    if (escrita || status !== "enviado")
      return resposta(
        { error: "O WhatsApp não confirmou a entrega. A fatura continua disponível aqui." },
        503,
      );
    return resposta({ ok: true });
  } catch {
    return resposta(
      { error: "Não foi possível consultar o Pix. A fatura também pode ser acessada pelo Asaas." },
      503,
    );
  }
}
export async function GET(req: Request) {
  return processar(req, false);
}
export async function POST(req: Request) {
  return processar(req, true);
}
