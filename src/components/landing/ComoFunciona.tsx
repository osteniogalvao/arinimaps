"use client";

/**
 * Como funciona: linha do tempo em 5 passos. A linha se preenche conforme a
 * rolagem e cada passo acende quando a linha chega nele. Horizontal no
 * desktop, vertical no celular.
 */

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { Compass, Handshake, Lightbulb, Link2, Sparkles } from "lucide-react";
import { EASE } from "./movimento";

const PASSOS = [
  { icone: Compass, titulo: "Exploração", texto: "Uma nova perspectiva sobre imóveis e territórios." },
  { icone: Lightbulb, titulo: "Informação", texto: "Conhecimento para compreender cada oportunidade." },
  { icone: Sparkles, titulo: "Oportunidade", texto: "Novas possibilidades para encontrar o imóvel ideal." },
  { icone: Link2, titulo: "Conexão", texto: "Aproximando pessoas, propriedades e negócios." },
  { icone: Handshake, titulo: "Negociação", texto: "O caminho para transformar oportunidades em negócios." },
];

export default function ComoFunciona() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 55%"] });
  const progresso = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });
  const escala = useTransform(progresso, [0, 1], [0, 1]);
  const [aceso, setAceso] = useState(reduce ? PASSOS.length : 0);

  useMotionValueEvent(progresso, "change", (p) => {
    const n = Math.min(PASSOS.length, Math.floor(p * (PASSOS.length - 1) + 1.0001));
    if (n !== aceso) setAceso(n);
  });

  const acesos = reduce ? PASSOS.length : aceso;

  return (
    <div ref={ref} className="relative">
      {/* trilho + preenchimento: horizontal (lg) / vertical (celular) */}
      <div aria-hidden="true" className="absolute left-[22px] top-0 h-full w-[3px] rounded bg-white/12 lg:left-0 lg:top-[22px] lg:h-[3px] lg:w-full">
        <motion.div
          style={reduce ? undefined : { scaleY: escala }}
          className="h-full w-full origin-top rounded bg-[#6FB08F] lg:hidden"
        />
        <motion.div
          style={reduce ? undefined : { scaleX: escala }}
          className="hidden h-full w-full origin-left rounded bg-[#6FB08F] lg:block"
        />
      </div>

      <ol className="relative grid gap-10 lg:grid-cols-5 lg:gap-8">
        {PASSOS.map((p, k) => {
          const on = k < acesos;
          return (
            <motion.li
              key={p.titulo}
              initial={reduce ? false : { opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.7, delay: k * 0.08, ease: EASE }}
              className="relative pl-16 lg:pl-0"
            >
              <span
                className={`absolute left-0 top-0 grid size-[47px] place-items-center rounded-full border-2 transition-colors duration-500 lg:relative ${
                  on ? "border-[#6FB08F] bg-[#6FB08F] text-[#124431]" : "border-white/25 bg-[#0A2219] text-white/70"
                }`}
              >
                <p.icone className="size-5" strokeWidth={1.9} />
              </span>
              <p className="mt-0 border-t border-white/20 pt-3 text-xs font-semibold tabular-nums tracking-[0.08em] text-ouro lg:mt-6">{String(k + 1).padStart(2, "0")}</p>
              <h3 className="lp-display mt-2 text-[1.7rem] text-white">{p.titulo}</h3>
              <p className="mt-3 text-[17px] leading-relaxed text-white/80">{p.texto}</p>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
