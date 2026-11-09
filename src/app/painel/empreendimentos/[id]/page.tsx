import { notFound, redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { lerEmpreendimento, podeGerirEmpreendimento } from "@/lib/empreendimento/espelho";
import PaginaEspelho from "@/components/empreendimento/PaginaEspelho";

export const dynamic = "force-dynamic";

/** Espelho de vendas do loteamento, para o anunciante dono (segunda etapa, item 10). */
export default async function EspelhoDoAnunciante({ params }: PageProps<"/painel/empreendimentos/[id]">) {
  const { id } = await params;
  const a = await ator();
  if (!a) redirect("/entrar");
  const emp = await lerEmpreendimento(id);
  // só o dono (proprietário ou parceiro do anúncio); empreendimento de outro = 404
  if (!emp || a.ehArini || !podeGerirEmpreendimento(a, emp)) notFound();
  return <PaginaEspelho emp={emp} base="/painel" />;
}
