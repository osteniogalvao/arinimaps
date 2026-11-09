import { redirect } from "next/navigation";
import { Secao } from "@/components/ui/Pagina";
import { ator } from "@/lib/authz";
import { listarEmpreendimentos } from "@/lib/empreendimento/espelho";
import ListaEmpreendimentos from "@/components/empreendimento/ListaEmpreendimentos";

export const dynamic = "force-dynamic";

/** Loteamentos do anunciante, cada um com o seu espelho de vendas (segunda etapa, item 10). */
export default async function MeusEmpreendimentos() {
  const a = await ator();
  if (!a) redirect("/entrar");
  const itens = await listarEmpreendimentos({ ownerId: a.ownerId, partnerId: a.partnerId });
  return (
    <Secao eyebrow="Vendas" titulo="Espelho de vendas"
      subtitulo="Seus loteamentos, lote a lote: o que está disponível, reservado e vendido, com o VGV de cada um.">
      <ListaEmpreendimentos itens={itens} base="/painel" />
    </Secao>
  );
}
