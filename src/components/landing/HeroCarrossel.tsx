"use client";

/**
 * Topo da página inicial: carrossel de tela cheia (100svh) no mesmo molde do
 * site de referência — setas, abas com barra de progresso embaixo, troca
 * automática a cada ~7 s, pausa com o mouse em cima / foco dentro / fora da
 * tela, setas do teclado, título que sobe palavra por palavra de dentro de uma
 * máscara.
 *
 * Fundo de cada slide (MidiaFundo):
 *  · "mapa"  → o mapa-vitrine ao vivo (MapLibre sobre o satélite, malha do
 *              CAR / lotes urbanos) parado numa cena; enquanto ele não chega,
 *              aparece a foto `poster`. Um único mapa atende os slides de mapa:
 *              trocar de um para o outro é um voo de câmera.
 *  · "foto"  → foto com zoom lento (Ken Burns).
 *  · `video` → se informado, um <video> mudo em loop por cima da foto
 *              (BackgroundVideo) — é o encaixe para trocar um slide por vídeo.
 *
 * O mapa só é montado depois que a página terminou de carregar (o LCP é a
 * foto), só em telas ≥ 768 px e nunca com economia de dados.
 */

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Supergrafico } from "@/components/ui/Pagina";
import { EASE } from "./movimento";

const MapaVitrine = dynamic(() => import("@/components/map/MapaVitrine"), { ssr: false });

export type MidiaSlide =
  | { tipo: "mapa"; cena: number; poster: string }
  | { tipo: "foto"; src: string };

export type SlideHero = {
  id: string;
  /** rótulo curto da aba */
  aba: string;
  eyebrow: string;
  titulo: string;
  /** palavras finais do título, na cor de destaque */
  destaque?: string;
  subtitulo: string;
  cta: { rotulo: string; href: string };
  cta2?: { rotulo: string; href: string };
  midia: MidiaSlide;
  /** mp4 opcional que substitui o fundo do slide */
  video?: string;
};

const DURACAO = 7000;

type Conexao = { saveData?: boolean; effectiveType?: string };

function semEconomiaDeDados() {
  const c = (navigator as Navigator & { connection?: Conexao }).connection;
  return !(c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? ""));
}

/** Vídeo de fundo leve: baixa depois do load, pausa fora da tela, entra com fade. */
export function BackgroundVideo({ src, className = "" }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [liberado, setLiberado] = useState(false);
  const [tocando, setTocando] = useState(false);

  useEffect(() => {
    if (!semEconomiaDeDados()) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let t = 0;
    const libera = () => { t = window.setTimeout(() => setLiberado(true), 300); };
    if (document.readyState === "complete") libera();
    else window.addEventListener("load", libera, { once: true });
    return () => { window.removeEventListener("load", libera); window.clearTimeout(t); };
  }, [src]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !liberado) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !document.hidden) v.play().catch(() => {}); else v.pause();
    }, { threshold: 0.05 });
    io.observe(v);
    return () => io.disconnect();
  }, [liberado]);

  if (!liberado) return null;
  return (
    <video
      ref={ref} src={src} muted loop playsInline autoPlay preload="auto" aria-hidden
      onPlaying={() => setTocando(true)}
      className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${tocando ? "opacity-100" : "opacity-0"} ${className}`}
    />
  );
}

/** Foto (ou vídeo) do slide. O mapa é uma camada à parte, compartilhada. */
function MidiaFundo({ slide, primeiro }: { slide: SlideHero; primeiro: boolean }) {
  const src = slide.midia.tipo === "mapa" ? slide.midia.poster : slide.midia.src;
  return (
    <>
      <Image
        src={src} alt="" fill sizes="100vw" preload={primeiro}
        className={`object-cover ${slide.midia.tipo === "foto" ? "lp-kenburns" : ""}`}
      />
      {slide.video && <BackgroundVideo src={slide.video} />}
    </>
  );
}

export default function HeroCarrossel({ slides, h1 }: { slides: SlideHero[]; h1: string }) {
  const n = slides.length;
  const [i, setI] = useState(0);
  const [mudou, setMudou] = useState(false); // o 1º título já nasce visível (LCP)
  const [hover, setHover] = useState(false);
  const [foco, setFoco] = useState(false);
  const [foraDaTela, setForaDaTela] = useState(false);
  const [montarMapa, setMontarMapa] = useState(false);
  const [mapaPronto, setMapaPronto] = useState(false);
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const textoY = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["0%", "-22%"]);
  const textoOpacidade = useTransform(scrollYProgress, [0, 0.65], reduce ? [1, 1] : [1, 0]);
  const midiaY = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["0%", "14%"]);

  const ir = useCallback((para: number) => { setMudou(true); setI(((para % n) + n) % n); }, [n]);

  const slide = slides[i];
  const slideDeMapa = slide.midia.tipo === "mapa" && !slide.video;
  // a última cena de mapa visitada: o mapa fica nela enquanto os slides de foto passam
  const [cenaMapa, setCenaMapa] = useState(() => {
    const m = slides.find((s) => s.midia.tipo === "mapa")?.midia;
    return m && m.tipo === "mapa" ? m.cena : 0;
  });
  if (slide.midia.tipo === "mapa" && slide.midia.cena !== cenaMapa) setCenaMapa(slide.midia.cena);

  // monta o mapa depois do load, em ociosidade; só em tela larga e sem economia de dados
  useEffect(() => {
    if (!slides.some((s) => s.midia.tipo === "mapa")) return;
    if (!semEconomiaDeDados() || window.innerWidth < 768) return;
    let ocioso = 0;
    const inicia = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      ocioso = ric ? ric(() => setMontarMapa(true), { timeout: 2000 }) : window.setTimeout(() => setMontarMapa(true), 600);
    };
    if (document.readyState === "complete") inicia();
    else window.addEventListener("load", inicia, { once: true });
    return () => { window.removeEventListener("load", inicia); window.clearTimeout(ocioso); };
  }, [slides]);

  // fora da tela: pausa o carrossel (e o teclado deixa de responder)
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setForaDaTela(!e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // setas do teclado
  useEffect(() => {
    if (n < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (foraDaTela || e.altKey || e.ctrlKey || e.metaKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight") ir(i + 1);
      else if (e.key === "ArrowLeft") ir(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, n, ir, foraDaTela]);

  const pausado = hover || foco || foraDaTela;

  return (
    <section
      ref={ref}
      id="inicio"
      aria-roledescription="carrossel"
      aria-label="Destaques"
      data-pausado={pausado}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // só o foco de teclado pausa (clicar numa aba não deve travar o carrossel)
      onFocusCapture={(e) => setFoco(!!(e.target as HTMLElement).matches?.(":focus-visible"))}
      onBlurCapture={() => setFoco(false)}
      className="lp-escuro relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#07110D]"
      style={{ ["--lp-slide-dur" as string]: `${DURACAO}ms` }}
    >
      <h1 className="sr-only">{h1}</h1>

      {/* ---------- fundo (parallax) ---------- */}
      <motion.div style={{ y: midiaY }} className="absolute inset-x-0 top-0 -z-20 h-[115%]">
        <AnimatePresence initial={false}>
          <motion.div
            key={slide.id}
            className="absolute inset-0 overflow-hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: EASE }}
          >
            <MidiaFundo slide={slide} primeiro={i === 0 && !mudou} />
          </motion.div>
        </AnimatePresence>

        {montarMapa && (
          <div
            aria-hidden="true"
            className={`absolute inset-0 transition-opacity duration-1000 ${slideDeMapa && mapaPronto ? "opacity-100" : "opacity-0"}`}
          >
            <MapaVitrine cena={cenaMapa} ativo={slideDeMapa && !foraDaTela} onPronto={() => setMapaPronto(true)} />
          </div>
        )}
      </motion.div>

      {/* escurece onde fica o texto: de baixo sempre, da esquerda no desktop */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(7,17,13,.45)_0%,rgba(7,17,13,.15)_28%,rgba(7,17,13,.72)_66%,rgba(7,17,13,.96)_100%)]" />
      <div className="absolute inset-0 -z-10 hidden bg-[linear-gradient(90deg,rgba(7,17,13,.8)_0%,rgba(7,17,13,.45)_45%,rgba(7,17,13,0)_75%)] md:block" />

      {/* linhas de mapa e supergráfico do radar (capa do manual) por cima da foto */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[url('/img/marca/curvas-nivel.svg')] bg-cover bg-center opacity-35 mix-blend-screen" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden opacity-30 lg:block"><Supergrafico /></div>

      {/* ---------- setas ---------- */}
      {n > 1 && (
        <>
          <button
            type="button" onClick={() => ir(i - 1)} aria-label="Destaque anterior"
            className="absolute left-3 top-1/2 z-[4] hidden size-14 -translate-y-1/2 place-items-center rounded-full border-2 border-white/50 text-white transition hover:border-white hover:bg-white hover:text-[#124431] md:grid xl:left-6"
          >
            <ChevronLeft className="size-7" />
          </button>
          <button
            type="button" onClick={() => ir(i + 1)} aria-label="Próximo destaque"
            className="absolute right-3 top-1/2 z-[4] hidden size-14 -translate-y-1/2 place-items-center rounded-full border-2 border-white/50 text-white transition hover:border-white hover:bg-white hover:text-[#124431] md:grid xl:right-6"
          >
            <ChevronRight className="size-7" />
          </button>
        </>
      )}

      {/* ---------- texto ---------- */}
      <motion.div
        style={{ y: textoY, opacity: textoOpacidade }}
        className="lp-container relative z-[2] flex min-h-[100svh] flex-1 flex-col justify-end pb-10 pt-32 md:px-24 md:pb-12 md:pt-44 xl:px-8"
      >
        {/* todos os slides empilhados na mesma célula: a área reserva a altura do maior (sem salto) */}
        <div className="grid">
          {slides.map((s) => (
            <div key={s.id} aria-hidden className="invisible hidden [grid-area:1/1] md:block">
              <TextoSlide s={s} animar={false} />
            </div>
          ))}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={slide.id}
              className="[grid-area:1/1]"
              aria-live={pausado ? "polite" : "off"}
              exit={{ opacity: 0, y: -18, transition: { duration: 0.3 } }}
            >
              <TextoSlide s={slide} animar={mudou && !reduce} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* os botões trocam junto com o texto: com mode="wait" o título antigo ainda
            está saindo, e um botão já do slide seguinte ficaria descasado dele */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={slide.id}
            className="mt-8 flex flex-wrap gap-3"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.45, delay: reduce ? 0 : 0.35 } }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.3 } }}
          >
            <Link href={slide.cta.href} className="lp-btn lp-btn-verde">
              {slide.cta.rotulo} <ArrowRight />
            </Link>
            {slide.cta2 && (
              <Link href={slide.cta2.href} className="lp-btn lp-btn-claro">{slide.cta2.rotulo}</Link>
            )}
          </motion.div>
        </AnimatePresence>

        {/* ---------- abas com progresso (o fim da barra passa o slide) ---------- */}
        {n > 1 && (
          <div
            className="mt-10 grid gap-2 md:mt-14 md:flex md:flex-wrap md:gap-x-7 md:gap-y-3"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
          >
            {slides.map((s, k) => (
              <button
                key={s.id} type="button" onClick={() => ir(k)}
                aria-label={s.aba} aria-current={k === i ? "true" : undefined}
                className={`py-2 text-left text-[15px] font-semibold transition ${k === i ? "text-white" : "text-white/60 hover:text-white"}`}
              >
                <span className="mb-2.5 block h-[3px] w-full overflow-hidden rounded bg-white/25 md:w-28">
                  {k === i && (
                    <span
                      key={`${s.id}-${i}`}
                      className="lp-progresso block h-full bg-[#6FB08F]"
                      onAnimationEnd={() => { if (!reduce) ir(i + 1); }}
                    />
                  )}
                </span>
                <span className="hidden max-w-[11rem] truncate md:block">{s.aba}</span>
              </button>
            ))}
          </div>
        )}
      </motion.div>

      {slideDeMapa && mapaPronto && (
        <p className="pointer-events-none absolute bottom-2 right-4 z-[3] hidden text-[11px] text-white/55 md:block">
          Imagem de satélite © ESA WorldCover / Copernicus e Esri · malha do CAR e lotes sobre o satélite
        </p>
      )}
    </section>
  );
}

function TextoSlide({ s, animar }: { s: SlideHero; animar: boolean }) {
  const palavras = s.titulo.split(" ").filter(Boolean);
  const destaque = (s.destaque ?? "").split(" ").filter(Boolean);
  const todas = [...palavras.map((p) => ({ p, d: false })), ...destaque.map((p) => ({ p, d: true }))];
  return (
    <div className="max-w-4xl">
      <p className="lp-eyebrow">{s.eyebrow}</p>
      <h2
        className="lp-display mt-4 text-[clamp(2.4rem,5.6vw,4.9rem)] text-white"
        aria-label={`${s.titulo} ${s.destaque ?? ""}`.trim()}
      >
        {todas.map(({ p, d }, k) => (
          <span key={k} className="inline-block overflow-hidden pb-[0.1em] align-bottom" aria-hidden>
            <motion.span
              className={`inline-block ${d ? "text-ouro" : ""}`}
              initial={animar ? { y: "110%" } : false}
              animate={{ y: "0%" }}
              transition={{ duration: 0.8, delay: k * 0.05, ease: EASE }}
            >
              {p}{k < todas.length - 1 ? " " : ""}
            </motion.span>
          </span>
        ))}
      </h2>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/90 md:text-xl">{s.subtitulo}</p>
    </div>
  );
}
