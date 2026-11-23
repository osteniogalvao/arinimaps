import { redirect } from "next/navigation";

/** A caixa do WhatsApp virou o Atendimento por setores (migration 0156): a fila do Comercial fica lá. */
export default function CaixaWhatsapp() {
  redirect("/admin/atendimento?caixa=setor%3Acomercial");
}
