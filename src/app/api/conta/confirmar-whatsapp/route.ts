import { ator } from "@/lib/authz";
import { canalDoTitular, desafioNumero } from "@/lib/confirmacao-whatsapp";
import { numeroDaApiWhatsapp, segredoWhatsapp, whatsappConfigurado } from "@/lib/meta";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";

export async function POST() {
  const a = await ator();
  if (!a) return Response.json({ error: "Confirme sua sessão." }, { status: 401 });
  const limite = await limitar("confirmar-whatsapp:" + a.userId, 6, 600);
  if (!limite.permitido) return respostaLimite(limite, "confirmação de número");
  if (!whatsappConfigurado() || !segredoWhatsapp())
    return Response.json({ error: "WhatsApp indisponível." }, { status: 503 });
  const canal = await canalDoTitular(a.userId);
  if (!canal)
    return Response.json({ error: "Cadastre um número individual válido na sua conta." }, { status: 409 });
  const api = await numeroDaApiWhatsapp().catch(() => null);
  if (!api) return Response.json({ error: "O WhatsApp oficial está indisponível." }, { status: 503 });
  return Response.json(
    {
      link:
        "https://wa.me/" +
        api +
        "?text=" +
        encodeURIComponent(desafioNumero(canal.telefone, a.userId, canal.versao)),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
