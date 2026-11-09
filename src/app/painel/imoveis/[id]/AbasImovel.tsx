"use client";

/**
 * Abas do imóvel no painel do anunciante: o anúncio, o acompanhamento das
 * visitas e propostas (item 28) e a Minha área de trabalho (item 29).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, CalendarClock, PencilRuler, type LucideIcon } from "lucide-react";

export default function AbasImovel({ id }: { id: string }) {
  const caminho = usePathname();
  const base = `/painel/imoveis/${id}`;
  const abas: { href: string; rotulo: string; icone: LucideIcon }[] = [
    { href: base, rotulo: "Anúncio", icone: FileText },
    { href: `${base}/acompanhamento`, rotulo: "Acompanhamento", icone: CalendarClock },
    { href: `${base}/minha-area`, rotulo: "Minha área", icone: PencilRuler },
  ];
  return (
    <nav aria-label="Seções do imóvel" className="border-b border-linha">
      <div className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {abas.map(({ href, rotulo, icone: Icone }) => {
          const ativo = caminho === href;
          return (
            <Link key={href} href={href} aria-current={ativo ? "page" : undefined}
              className={"flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-[0.95rem] transition-colors " +
                (ativo ? "border-ouro font-semibold text-texto" : "border-transparent text-texto-2 hover:text-texto")}>
              <Icone className="size-[17px]" />
              {rotulo}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
