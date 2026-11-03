"use client";

/**
 * Imagem do cartão que troca sozinha (revisão do Carlos, 29/10, seção 02):
 * em vez de uma foto fixa, o cartão passa por uma lista de quadros com
 * transição suave. Um quadro pode ser foto (com link e legenda, ex.: imóvel
 * de menor preço) ou um recorte do mapa (satélite ou relevo).
 *
 * Pausa com o mouse em cima e fica no primeiro quadro com
 * prefers-reduced-motion.
 */

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import MosaicoSatelite from "./MosaicoSatelite";
import { EASE } from "./movimento";

export type Quadro =
  | { tipo: "foto"; src: string; alt: string; legenda?: string; href?: string; externa?: boolean }
  | { tipo: "mapa"; lng: number; lat: number; z: number; camada: "satelite" | "relevo"; legenda?: string };

export default function CartaoRotativo({ quadros, intervalo = 4200, atraso = 0 }: {
  quadros: Quadro[]; intervalo?: number; atraso?: number;
}) {
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || pausa || quadros.length < 2) return;
    let t: ReturnType<typeof setInterval> | undefined;
    // os três cartões não trocam juntos: cada um começa com um atraso
    const inicio = setTimeout(() => { t = setInterval(() => setI((v) => (v + 1) % quadros.length), intervalo); }, atraso);
    return () => { clearTimeout(inicio); if (t) clearInterval(t); };
  }, [reduce, pausa, quadros.length, intervalo, atraso]);

  const q = quadros[i] ?? quadros[0];
  if (!q) return null;
  const corpo = (
    <>
      {q.tipo === "foto" ? (
        q.externa ? (
          // foto enviada pelo anunciante (Storage do Supabase)
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.src} alt={q.alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <Image src={q.src} alt={q.alt} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
        )
      ) : (
        <MosaicoSatelite lng={q.lng} lat={q.lat} z={q.z} camada={q.camada} alt={q.legenda ?? ""} />
      )}
      {q.legenda && (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-8 text-sm font-semibold text-white">
          {q.legenda}
        </span>
      )}
    </>
  );

  return (
    <div
      className="relative aspect-[16/10] shrink-0 overflow-hidden bg-[#124431]"
      onMouseEnter={() => setPausa(true)}
      onMouseLeave={() => setPausa(false)}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={i}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          {q.tipo === "foto" && q.href ? <Link href={q.href} className="absolute inset-0">{corpo}</Link> : corpo}
        </motion.div>
      </AnimatePresence>
      {quadros.length > 1 && (
        <div className="absolute right-3 top-3 z-10 flex gap-1" aria-hidden="true">
          {quadros.map((_, k) => (
            <span key={k} className={`h-1.5 rounded-full transition-all duration-500 ${k === i ? "w-4 bg-[#D9BD6F]" : "w-1.5 bg-white/60"}`} />
          ))}
        </div>
      )}
    </div>
  );
}
