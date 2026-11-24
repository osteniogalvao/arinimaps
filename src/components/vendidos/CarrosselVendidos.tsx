"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Carrossel leve: rolagem horizontal nativa com encaixe (no celular é só
 * arrastar com o dedo) e setas no computador. Os cards chegam prontos do
 * servidor; aqui só há o rolar.
 */
export default function CarrosselVendidos({ children, total }: { children: React.ReactNode; total: number }) {
  const trilho = useRef<HTMLUListElement>(null);
  const passo = (dir: 1 | -1) => {
    const el = trilho.current;
    if (!el) return;
    const card = el.querySelector("li");
    const largura = card ? card.getBoundingClientRect().width + 20 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * largura, behavior: "smooth" });
  };
  return (
    <div className="relative">
      <ul
        ref={trilho}
        className="-mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-5 pb-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
        aria-label="Imóveis vendidos"
      >
        {children}
      </ul>
      {total > 1 && (
        <div className="mt-4 hidden justify-end gap-2 md:flex">
          <button type="button" onClick={() => passo(-1)} aria-label="Anterior"
            className="grid size-11 place-items-center rounded-full border border-linha text-texto transition hover:border-verde hover:text-verde">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" onClick={() => passo(1)} aria-label="Próximo"
            className="grid size-11 place-items-center rounded-full border border-linha text-texto transition hover:border-verde hover:text-verde">
            <ChevronRight className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
