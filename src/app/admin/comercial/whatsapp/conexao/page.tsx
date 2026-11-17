import Link from "next/link";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import ConexaoWhatsapp from "@/components/crm/ConexaoWhatsapp";

export default async function ConexaoWhatsappPagina() {
  await exigirSetor("diretoria");
  return (
    <div className="space-y-5">
      <CabecalhoPagina titulo="Conexão do WhatsApp" eyebrow="Central" />
      <ConexaoWhatsapp />
      <Link href="/admin/comercial/whatsapp" className="underline">Voltar às mensagens</Link>
    </div>
  );
}
