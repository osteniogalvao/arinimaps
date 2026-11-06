"use client";

/**
 * "Como você usa a Arini": abas à esquerda (perfis de uso) e um cartão grande
 * à direita, com foto ou satélite, que troca com movimento. Mesma ideia do
 * service-showcase do site de referência, em formato de abas.
 */

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, BrainCircuit, Megaphone, Rocket, ScanSearch, Search } from "lucide-react";
import MosaicoSatelite from "./MosaicoSatelite";
import { EASE } from "./movimento";
import { BTN_ACAO } from "./Titulo";

type Aba = {
  id: string;
  rotulo: string;
  /** gatilho: a frase curta embaixo do rótulo da aba */
  frase: string;
  /** título do cartão grande */
  titulo: string;
  texto: string;
  link: { rotulo: string; href: string };
  icone: typeof Search;
  imagem: { tipo: "foto"; src: string } | { tipo: "satelite" | "relevo"; lng: number; lat: number; z: number };
  pontos: string[];
};

const ABAS: Aba[] = [
  {
    id: "comprar", rotulo: "Comprar", icone: Search,
    frase: "Explore antes de decidir.",
    titulo: "Encontre pelo mapa.",
    texto: "Explore imóveis urbanos e rurais pelo mapa, conheça sua localização, consulte informações territoriais e descubra oportunidades com mais clareza e segurança.",
    pontos: ["Explore novos lugares", "Descubra oportunidades", "Decida com confiança"],
    link: { rotulo: "Buscar imóveis", href: "/imoveis?vista=mapa" },
    imagem: { tipo: "satelite", lng: -50.196, lat: -19.728, z: 15 },
  },
  {
    id: "anunciar", rotulo: "Anunciar", icone: Megaphone,
    frase: "O anúncio certo garante a venda.",
    titulo: "Seu imóvel no mapa, do jeito certo.",
    texto: "Dê visibilidade ao seu imóvel, valorize seu potencial territorial e conecte sua propriedade às oportunidades certas de negócio.",
    pontos: ["Anunciar ficou fácil", "Com segurança em cada etapa", "Conectando oportunidades"],
    link: { rotulo: "Anunciar imóvel", href: "/painel/novo" },
    imagem: { tipo: "foto", src: "/img/aerea-interior.jpg" },
  },
  {
    id: "consultar", rotulo: "Consultar área", icone: ScanSearch,
    frase: "Saiba o que faz a diferença.",
    titulo: "Saiba o que faz a diferença.",
    texto: "Explore a área pelo mapa, consulte medidas, divisas e informações territoriais para compreender melhor cada propriedade e o que existe ao seu redor.",
    pontos: ["Fontes oficiais ao vivo", "Raio de cada incidência", "Relatório em PDF"],
    link: { rotulo: "Ver relatórios territoriais", href: "/relatorios" },
    imagem: { tipo: "relevo", lng: -50.32, lat: -19.78, z: 12 },
  },
  {
    id: "inteligencia", rotulo: "Inteligência territorial", icone: BrainCircuit,
    frase: "Uma visão além do imóvel.",
    titulo: "Uma visão além do imóvel.",
    texto: "Conectamos dados, informações territoriais e inteligência artificial em uma plataforma que evolui continuamente, ampliando a compreensão do território e revelando novas possibilidades de análise e decisão.",
    pontos: ["Dados conectados", "Inteligência em evolução", "Conhecimento territorial"],
    link: { rotulo: "Pacotes de serviço", href: "/planos" },
    imagem: { tipo: "satelite", lng: -50.27, lat: -19.70, z: 13 },
  },
  {
    id: "expansao", rotulo: "Expansão Arini", icone: Rocket,
    frase: "Invista com a Arini.",
    titulo: "Invista com a Arini.",
    texto: "Conecte seu negócio à tecnologia ARINI e descubra novas possibilidades de expansão.",
    pontos: ["Oportunidade de investimento", "Desenvolvimento regional", "Construindo parceria"],
    link: { rotulo: "Faça parte da Arini", href: "/expansao" },
    imagem: { tipo: "foto", src: "/img/fazenda-gado.jpg" },
  },
];

export default function ComoUsar() {
  const [ativa, setAtiva] = useState(0);
  const reduce = useReducedMotion();
  const aba = ABAS[ativa];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12">
      {/* ---------- abas ---------- */}
      <div role="tablist" aria-label="Como usar a Arini" aria-orientation="vertical" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {ABAS.map((a, k) => {
          const sel = k === ativa;
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              id={`aba-${a.id}`}
              aria-selected={sel}
              aria-controls="painel-como-usar"
              onClick={() => setAtiva(k)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setAtiva((ativa + 1) % ABAS.length); }
                if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setAtiva((ativa - 1 + ABAS.length) % ABAS.length); }
              }}
              className={`group relative flex shrink-0 items-center gap-4 rounded-xl px-4 py-3.5 text-left transition lg:px-5 lg:py-5 ${
                sel ? "bg-superficie shadow-sm ring-1 ring-linha" : "hover:bg-superficie/60"
              }`}
            >
              {sel && (
                <motion.span
                  layoutId="como-usar-marca"
                  className="absolute inset-y-3 left-0 w-1 rounded-full bg-[#D9BD6F]"
                  transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
                />
              )}
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-lg transition ${
                  sel ? "bg-verde text-fundo" : "bg-verde/10 text-verde group-hover:bg-verde/20"
                }`}
              >
                <a.icone className="size-5" strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <span className={`lp-display block text-lg lg:text-2xl ${sel ? "text-texto" : "text-texto-3"}`}>{a.rotulo}</span>
                <span className="hidden text-base text-texto-2 lg:block">{a.frase}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ---------- cartão ---------- */}
      <div
        id="painel-como-usar" role="tabpanel" aria-labelledby={`aba-${aba.id}`}
        className="spotlight lp-escuro relative isolate min-h-[30rem] overflow-hidden rounded-2xl bg-[#07110D] lg:min-h-[36rem]"
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={aba.id}
            className="absolute inset-0 -z-20"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: EASE }}
          >
            {aba.imagem.tipo === "foto" ? (
              <Image src={aba.imagem.src} alt="" fill sizes="(max-width: 1024px) 100vw, 55vw" className="object-cover" />
            ) : (
              <MosaicoSatelite lng={aba.imagem.lng} lat={aba.imagem.lat} z={aba.imagem.z} camada={aba.imagem.tipo} />
            )}
          </motion.div>
        </AnimatePresence>
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(7,17,13,.1)_0%,rgba(7,17,13,.45)_45%,rgba(7,17,13,.95)_100%)]" />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={aba.id}
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
            className="absolute inset-x-0 bottom-0 p-6 text-white md:p-10"
          >
            <p className="lp-eyebrow">{String(ativa + 1).padStart(2, "0")} · {aba.rotulo}</p>
            <h3 className="lp-display mt-3 text-3xl md:text-[2.6rem]">{aba.titulo}</h3>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/90">{aba.texto}</p>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-base text-white/85">
              {aba.pontos.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-[#6FB08F]" aria-hidden="true" /> {p}
                </li>
              ))}
            </ul>
            <Link href={aba.link.href} className={`${BTN_ACAO} mt-7`}>
              {aba.link.rotulo} <ArrowRight />
            </Link>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
