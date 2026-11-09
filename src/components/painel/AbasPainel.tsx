"use client";

/**
 * Navegação da área do cliente (/painel): abas com ícone e estado ativo.
 * No celular rola na horizontal dentro do próprio trilho — a página não rola de lado.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2, Handshake, PlusCircle, Map as MapIcon, Users, LifeBuoy, UserRound, ShieldCheck, Grid3x3,
  type LucideIcon,
} from "lucide-react";

const ABAS: { href: string; rotulo: string; icone: LucideIcon }[] = [
  { href: "/painel", rotulo: "Meus imóveis", icone: Building2 },
  { href: "/painel/oportunidades", rotulo: "Minhas oportunidades", icone: Handshake },
  { href: "/painel/novo", rotulo: "Anunciar", icone: PlusCircle },
  { href: "/painel/empreendimentos", rotulo: "Espelho de vendas", icone: Grid3x3 },
  { href: "/painel/cartografia", rotulo: "Mapa: solicitações", icone: MapIcon },
  { href: "/painel/organizacao", rotulo: "Organização", icone: Users },
  { href: "/suporte", rotulo: "Suporte", icone: LifeBuoy },
  { href: "/conta", rotulo: "Minha conta", icone: UserRound },
  { href: "/conta/seguranca", rotulo: "Segurança da conta", icone: ShieldCheck },
];

export default function AbasPainel() {
  const caminho = usePathname();
  // a aba mais específica que casa com o caminho é a ativa (/painel não "engole" /painel/novo)
  const ativa = ABAS
    .filter((a) => caminho === a.href || caminho.startsWith(a.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Área do cliente" data-tour="abas-painel">
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ABAS.map(({ href, rotulo, icone: Icone }) => {
          const ativo = href === ativa;
          return (
            <Link key={href} href={href} aria-current={ativo ? "page" : undefined}
              className={
                "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-[0.92rem] transition-colors " +
                (ativo
                  ? "border-[#F2F2EC] bg-[#F2F2EC] text-[#124431] font-semibold"
                  : "border-linha-forte text-texto-3 hover:border-ouro hover:text-texto")
              }>
              <Icone className="size-[17px]" />
              {rotulo}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
