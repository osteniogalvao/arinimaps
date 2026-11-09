import { PencilRuler } from "lucide-react";
import { exigirAnunciante } from "@/lib/imovel/anunciante";
import MinhaAreaCliente from "@/components/imovel/MinhaAreaCliente";

/**
 * Aba Minha área (item 29): mapa da divisa onde o anunciante desenha seus
 * piquetes, áreas de plantio, benfeitorias e projetos, e anexa os arquivos.
 * Privado: só o dono e a Central veem. Nada daqui vai para o anúncio.
 */
export default async function MinhaAreaPagina({ params }: PageProps<"/painel/imoveis/[id]/minha-area">) {
  const { id } = await params;
  await exigirAnunciante(id);
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
          <PencilRuler className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="lp-display text-xl md:text-2xl text-texto">Minha área</h2>
          <p className="mt-1.5 max-w-3xl text-base leading-relaxed text-texto-2">
            Planeje o imóvel sobre a divisa: marque piquetes, áreas de plantio, benfeitorias e projetos, com área e
            comprimento medidos. É privado: só você e a Central Arini veem. Nada daqui aparece no anúncio.
          </p>
        </div>
      </header>
      <MinhaAreaCliente propertyId={id} />
    </div>
  );
}
