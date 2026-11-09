import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { exigirAnunciante } from "@/lib/imovel/anunciante";
import AbasImovel from "./AbasImovel";

/** Cabeçalho e abas do imóvel. Só o anunciante do imóvel entra (senão, 404). */
export default async function LayoutImovel({ children, params }: LayoutProps<"/painel/imoveis/[id]">) {
  const { id } = await params;
  const { imovel } = await exigirAnunciante(id);
  return (
    <div className="space-y-8">
      <div>
        <Link href="/painel" className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 hover:text-verde transition-colors">
          <ArrowLeft className="size-4" /> Meus imóveis
        </Link>
        <p className="mt-5 font-mono text-sm text-texto-2">{imovel.codigo}</p>
        <h1 className="lp-display mt-1 text-2xl md:text-[2rem] text-texto text-balance">{imovel.titulo}</h1>
        <div className="mt-5">
          <AbasImovel id={imovel.id} />
        </div>
      </div>
      {children}
    </div>
  );
}
