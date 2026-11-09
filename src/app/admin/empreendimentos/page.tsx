import { CabecalhoPagina } from "@/components/ui/Pagina";
import { exigirSetor } from "@/lib/setores-servidor";
import { listarEmpreendimentos } from "@/lib/empreendimento/espelho";
import ListaEmpreendimentos from "@/components/empreendimento/ListaEmpreendimentos";

export const dynamic = "force-dynamic";

/** Central: todos os loteamentos com unidades e o espelho de vendas de cada um. */
export default async function AdminEmpreendimentos() {
  await exigirSetor("comercial");
  const itens = await listarEmpreendimentos();
  return (
    <div className="max-w-6xl">
      <CabecalhoPagina eyebrow="Comercial" titulo="Espelho de vendas"
        subtitulo="Loteamentos com unidades: situação de cada lote, reservas com prazo e vendas." />
      <ListaEmpreendimentos itens={itens} base="/admin" />
    </div>
  );
}
