"use client";

/**
 * Abas do setor, presas no topo das telas de um setor da Central.
 *
 * Pedido do Carlos (áudio de 24/11/2026): "juntar em blocos de operação: o
 * setor, e dentro dele o CRM do setor, a agenda, o agendamento", no jeito do
 * CRM da Arini Negócios Imobiliários, onde cada setor tem poucas telas. Aqui:
 * "Visão geral" (a mesa do setor) + as telas do dia a dia do setor
 * (`principais` em lib/setores) + "Mais" com o restante.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Setor } from "@/lib/setores";

const ABA = "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors";
const ABA_LIGADA = "bg-verde text-fundo";
const ABA_DESLIGADA = "text-texto-2 hover:bg-superficie-2 hover:text-texto";

export default function AbasSetor({ setor, mesa, aceso, selo }: {
  setor: Setor;
  mesa: string;
  aceso: (href: string) => boolean;
  selo: Record<string, number>;
}) {
  const [mais, setMais] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  // fecha o "Mais" ao clicar fora
  useEffect(() => {
    if (!mais) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setMais(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [mais]);

  const porHref = new Map(setor.itens.map((i) => [i.href, i]));
  const principais = setor.principais.map((h) => porHref.get(h)).filter((i) => !!i);
  const resto = setor.itens.filter((i) => !setor.principais.includes(i.href));
  const ligadaNoMais = resto.find((i) => aceso(i.href));

  const aba = (href: string, rotulo: string) => {
    const ligada = aceso(href);
    const n = selo[href] ?? 0;
    return (
      <li key={href}>
        <Link href={href} aria-current={ligada ? "page" : undefined} className={`${ABA} ${ligada ? ABA_LIGADA : ABA_DESLIGADA}`}>
          {rotulo}
          {n > 0 && <span className="min-w-5 rounded-full bg-ouro px-1.5 text-[10px] font-bold leading-5 text-[#124431] tabular-nums">{n > 99 ? "99+" : n}</span>}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label={`Telas do setor ${setor.nome}`}
      className="relative z-20 border-b border-linha bg-superficie">
      <div className="mx-auto flex w-full max-w-[1280px] items-center gap-3 px-5 md:px-8">
        <span className="hidden md:block shrink-0 text-[11px] font-bold uppercase tracking-[0.22em] text-ouro">{setor.nome}</span>
        <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-2.5">
          {aba(mesa, "Visão geral")}
          {principais.map((i) => aba(i.href, i.rotulo))}
        </ul>
        {resto.length > 0 && (
          <div ref={caixa} className="relative shrink-0 py-2.5">
            <button type="button" aria-expanded={mais} aria-haspopup="menu" onClick={() => setMais((v) => !v)}
              className={`${ABA} ${ligadaNoMais ? ABA_LIGADA : ABA_DESLIGADA}`}>
              {ligadaNoMais ? ligadaNoMais.rotulo : "Mais"}
              <ChevronDown className="size-4" />
            </button>
            {mais && (
              <ul role="menu" className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-2xl border border-linha bg-superficie p-1.5 shadow-lg">
                {resto.map((i) => (
                  <li key={i.href} role="none">
                    <Link role="menuitem" href={i.href} onClick={() => setMais(false)}
                      className={`block rounded-xl px-3 py-2 text-sm transition-colors ${aceso(i.href) ? "bg-verde/12 font-semibold text-texto" : "text-texto-2 hover:bg-superficie-2 hover:text-texto"}`}>
                      {i.rotulo}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
