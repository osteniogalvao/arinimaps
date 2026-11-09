import { notFound } from "next/navigation";
import { exigirSetor } from "@/lib/setores-servidor";
import { lerEmpreendimento } from "@/lib/empreendimento/espelho";
import PaginaEspelho from "@/components/empreendimento/PaginaEspelho";

export const dynamic = "force-dynamic";

/** Central: espelho de vendas de um loteamento (setor Comercial). */
export default async function EspelhoCentral({ params }: PageProps<"/admin/empreendimentos/[id]">) {
  await exigirSetor("comercial");
  const { id } = await params;
  const emp = await lerEmpreendimento(id);
  if (!emp) notFound();
  return <div className="max-w-6xl"><PaginaEspelho emp={emp} base="/admin" /></div>;
}
