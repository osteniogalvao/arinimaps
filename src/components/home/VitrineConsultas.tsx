"use client";

/**
 * Seção "Consultas" da página inicial: uma faixa com o mapa-vitrine ao vivo
 * de fundo, o texto e o botão à esquerda e os atalhos das consultas em
 * cartões de vidro à direita. No celular empilha: mapa em cima (com a
 * legenda), cartões embaixo.
 *
 * O mapa só é importado quando a faixa chega a 600px da tela — antes disso a
 * home não carrega nem o chunk do componente, nem o MapLibre.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { CENAS } from "@/components/map/cenasVitrine";
import { BTN_ACAO } from "@/components/landing/Titulo";

const MapaVitrine = dynamic(() => import("@/components/map/MapaVitrine"), { ssr: false });

export type IconeConsulta = "mapa" | "car" | "embargo" | "fogo" | "mineracao" | "busca" | "relatorio";

export type Consulta = {
  rotulo: string;
  desc: string;
  href: string;
  icone: IconeConsulta;
  destaque?: boolean;
};

/** Ícones de linha, 20px, desenhados aqui mesmo (sem emoji, sem biblioteca). */
const ICONES: Record<IconeConsulta, ReactNode> = {
  mapa: (
    <>
      <path d="M10 18s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10Z" />
      <circle cx="10" cy="8" r="2.2" />
    </>
  ),
  car: (
    <>
      <path d="M3 6.5 11 3l6 4-2 9.5-9.5 1Z" />
      <path d="M3 6.5l8.5 4.5L17 7" strokeDasharray="2.2 1.8" />
      <path d="M11.5 11v6.5" strokeDasharray="2.2 1.8" />
    </>
  ),
  embargo: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M5.2 5.2l9.6 9.6" />
    </>
  ),
  fogo: (
    <path d="M10 17.5c-3.2 0-5.3-2.1-5.3-5 0-2.7 2.2-4.2 2.8-6.6 1 .9 1.5 2 1.5 3.1C10.3 7.8 11.2 5.8 10.8 3.5c2.9 1.7 4.7 4.3 4.7 7.2 0 3.6-2.3 6.8-5.5 6.8Z" />
  ),
  mineracao: (
    <>
      <path d="M3.5 16.5 11.5 8.5" />
      <path d="M7 6.5c3.2-2.8 7.8-2.8 10.5-.3" />
      <path d="M11.5 8.5 9.8 6.8" />
    </>
  ),
  busca: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.3 12.3 17 17" />
    </>
  ),
  relatorio: (
    <>
      <path d="M5 2.5h7l4 4v11H5Z" />
      <path d="M12 2.5v4h4" />
      <path d="M7.5 10.5h5M7.5 13.5h5" />
    </>
  ),
};

function Icone({ nome }: { nome: IconeConsulta }) {
  return (
    <svg
      viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {ICONES[nome]}
    </svg>
  );
}

type Props = { consultas: Consulta[] };

export default function VitrineConsultas({ consultas }: Props) {
  const faixaRef = useRef<HTMLDivElement>(null);
  const [montarMapa, setMontarMapa] = useState(false);
  const [mapaPronto, setMapaPronto] = useState(false);
  const [cena, setCena] = useState(0);

  // importa o mapa só quando a faixa está a 600px de aparecer
  useEffect(() => {
    const el = faixaRef.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      // navegador sem IntersectionObserver: monta logo, fora do corpo do efeito
      const t = setTimeout(() => setMontarMapa(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) { setMontarMapa(true); io.disconnect(); }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const legenda = CENAS[cena]?.legenda ?? CENAS[0].legenda;

  return (
    // faixa escura fixa (malha verde + grade): `.lp-escuro` mantém as cores do
    // tema escuro aqui dentro, com o site em qualquer tema
    <section id="consultas" className="lp-escuro lp-malha-escura relative isolate overflow-hidden scroll-mt-20">
      <div className="lp-grade pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div className="lp-container py-20 md:py-28">
        {/* a faixa é sempre escura: o fundo dela é o satélite, em qualquer tema */}
        <div
          ref={faixaRef}
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0A2219] text-white"
        >
          {/* ---------- mapa (bloco de 260px no celular; fundo inteiro no desktop) ---------- */}
          <div className="relative h-[260px] lg:absolute lg:inset-0 lg:h-auto">
            {montarMapa && <MapaVitrine onPronto={() => setMapaPronto(true)} onCena={setCena} />}

            {/* espera animada até o satélite aparecer */}
            <div
              aria-hidden="true"
              className={
                "vitrine-espera pointer-events-none absolute inset-0 z-10 transition-opacity duration-1000 " +
                (mapaPronto ? "opacity-0" : "opacity-100")
              }
            />

            {/* escurece para o texto ler: de baixo no celular, da esquerda no desktop */}
            <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-[#0A2219]/90 via-[#0A2219]/25 to-transparent lg:bg-gradient-to-r lg:from-[#0A2219]/95 lg:via-[#0A2219]/55 lg:to-[#0A2219]/15" />

            {/* legenda da cena */}
            <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex items-center gap-3 sm:left-6 lg:bottom-6 lg:left-10">
              <div
                key={cena}
                className="vitrine-legenda inline-flex items-center gap-2 rounded-full border border-white/20 bg-[#0A2219]/90 px-3 py-1.5 text-xs text-white"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6FB08F] opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#6FB08F]" />
                </span>
                {legenda}
              </div>
              <div className="flex gap-1.5" aria-hidden="true">
                {CENAS.map((c, i) => (
                  <span
                    key={c.id}
                    className={
                      "h-1.5 rounded-full transition-all duration-500 " +
                      (i === cena ? "w-5 bg-[#6FB08F]" : "w-1.5 bg-white/40")
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ---------- conteúdo (sobre o mapa no desktop) ---------- */}
          <div className="relative z-10 grid lg:min-h-[520px] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:pointer-events-none">
            <div className="flex flex-col justify-center p-6 sm:p-8 lg:p-12 lg:pb-20 lg:pointer-events-auto">
              <p className="lp-eyebrow">05 · Consultas</p>
              <h2 className="lp-display mt-3 text-[2.6rem] text-balance md:text-[3.4rem]">
                Entre na Área de <span className="text-ouro">Consultas</span>
              </h2>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-white/85">
                Acesse mapas, informações ambientais, dados imobiliários e consultas territoriais e muito mais em uma única plataforma.
              </p>
              <div className="mt-7">
                <Link href="/mapa" className={BTN_ACAO}>Abrir o mapa</Link>
              </div>
            </div>

            <div className="grid gap-3 p-4 pt-0 sm:p-6 sm:pt-0 lg:content-center lg:grid-cols-2 lg:p-8 lg:pl-0 lg:pointer-events-auto">
              {consultas.map((c) => (
                <Link
                  key={c.rotulo}
                  href={c.href}
                  className={
                    "group flex items-center gap-3 rounded-2xl border p-3.5 text-texto transition duration-200 " +
                    "hover:-translate-y-0.5 hover:border-verde " +
                    (c.destaque
                      ? "border-verde/60 bg-superficie lg:col-span-2"
                      : "border-linha bg-superficie")
                  }
                >
                  <span
                    className={
                      "inline-grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors " +
                      (c.destaque ? "bg-verde text-fundo" : "bg-verde/12 text-verde group-hover:bg-verde/20")
                    }
                  >
                    <Icone nome={c.icone} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-base font-semibold">
                      {c.rotulo}
                      <span className="text-verde transition-transform duration-200 group-hover:translate-x-1">›</span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
