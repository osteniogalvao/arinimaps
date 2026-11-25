import { PLANOS_CATALOGO, CATALOGO_POR_ENTRADA, planoNoPerfil } from "@/lib/planos-catalogo";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";
import { numeroDaApiWhatsapp, segredoWhatsapp, telefoneWhatsapp, whatsappConfigurado } from "@/lib/meta";
import { textoOptIn } from "@/lib/retomada-cadastro";

export function GET() {
  return Response.json({ disponivel: whatsappConfigurado() && !!segredoWhatsapp() });
}
export async function POST(req: Request) {
  const limite = await limitar("retomada-cadastro:" + ipDoPedido(req), 8, 600);
  if (!limite.permitido) return respostaLimite(limite, "retomada");
  const b = await req.json().catch(() => null),
    tel = telefoneWhatsapp(b?.telefone);
  const plano = PLANOS_CATALOGO.find((p) => p.id === b?.plano);
  if (
    !tel ||
    !/^55\d{10,11}$/.test(tel) ||
    !plano ||
    b?.autorizar !== true ||
    typeof b?.perfil !== "string" ||
    !planoNoPerfil(plano, CATALOGO_POR_ENTRADA[b.perfil])
  )
    return Response.json({ error: "Informe o número e confirme a autorização." }, { status: 400 });
  const numero = segredoWhatsapp() && (await numeroDaApiWhatsapp().catch(() => null));
  if (!numero) return Response.json({ error: "O WhatsApp está indisponível." }, { status: 503 });
  return Response.json(
    { link: "https://wa.me/" + numero + "?text=" + encodeURIComponent(textoOptIn(tel, plano.id, b.perfil)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
