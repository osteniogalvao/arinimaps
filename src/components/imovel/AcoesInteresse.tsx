import Link from "next/link";
import { Flag, Megaphone, Search } from "lucide-react";

/**
 * Faixa com os três pontos de interesse (item 17 do PDF do Carlos, 17/11/2026):
 * comprar, anunciar e "não encontrei o imóvel", sempre ao alcance no fim das
 * páginas de busca e de imóvel.
 */
export default function AcoesInteresse({ titulo = "Não achou o que procurava?" }: { titulo?: string }) {
  const acoes = [
    { href: "/conta/filtros", icone: Search, rotulo: "Quero comprar", texto: "Crie um filtro de interesse e receba os imóveis que combinam com você." },
    { href: "/painel/novo", icone: Megaphone, rotulo: "Quero anunciar", texto: "Coloque seu imóvel no mapa, com a divisa conferida pela Arini." },
    { href: "/cartografia/solicitar", icone: Flag, rotulo: "Não encontrei o imóvel", texto: "Avise a equipe de cartografia sobre um imóvel que falta no mapa." },
  ];
  return (
    <section aria-label="Próximos passos" className="space-y-4">
      <h2 className="lp-display text-2xl text-texto">{titulo}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {acoes.map(({ href, icone: Icone, rotulo, texto }) => (
          <Link key={href} href={href} className="cartao lp-lift flex gap-3 p-5 transition hover:ring-1 hover:ring-[#D9BD6F]">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><Icone className="size-5" /></span>
            <span>
              <span className="block font-semibold text-texto">{rotulo}</span>
              <span className="mt-1 block text-sm leading-relaxed text-texto-2">{texto}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
