import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/shell/AppShell";
import BotaoTema from "@/components/shell/BotaoTema";

/**
 * Barra de topo das telas de conta (/conta, /conta/seguranca), que ficam fora
 * do painel e da Central: logo, volta para a área de origem e tema.
 */
export default function TopoConta({ daEquipe }: { daEquipe: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-linha bg-superficie/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-3 px-5 md:px-8">
        <Link href="/" aria-label="ARINI — início"><Logo /></Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href={daEquipe ? "/admin" : "/painel"}
            className="inline-flex items-center gap-1.5 rounded-full border border-linha-forte px-3.5 py-1.5 text-sm font-semibold text-texto-2 transition-colors hover:text-verde">
            <ArrowLeft className="size-4" />
            <span>Voltar {daEquipe ? "à Central" : "ao painel"}</span>
          </Link>
          <BotaoTema />
        </div>
      </div>
    </header>
  );
}
