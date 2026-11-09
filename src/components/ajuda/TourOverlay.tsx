"use client";

/**
 * Tela do tour guiado: escurece a página, recorta o alvo e mostra o cartão do
 * passo. Sem biblioteca: posição calculada a cada mudança de tamanho/rolagem
 * e conferida a cada 400 ms (o mapa e os menus mudam de lugar ao carregar).
 * Carregado com import dinâmico só quando o tour abre (AjudaTour.tsx).
 */

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { Alvo, PassoTour } from "./passosTour";

type Caixa = { top: number; left: number; width: number; height: number };

/**
 * Parte do elemento que aparece de fato: o retângulo dele cortado pelos pais
 * com overflow (lista lateral recolhida com largura 0, menu fechado) e, no
 * modo `naTela`, também pelos pais com rolagem e pela janela. Null quando
 * quase nada aparece — alvo invisível ou fora da tela nunca é destacado.
 */
function recorte(el: Element, naTela: boolean): Caixa | null {
  const s = getComputedStyle(el);
  if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) <= 0.05) return null;
  const r = el.getBoundingClientRect();
  let top = r.top, left = r.left, right = r.right, bottom = r.bottom;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const ps = getComputedStyle(p);
    if (Number(ps.opacity) <= 0.05 || ps.visibility === "hidden") return null;
    const ov = ps.overflowX + " " + ps.overflowY;
    const corta = /hidden|clip/.test(ov) || (naTela && /auto|scroll/.test(ov));
    if (!corta) continue;
    const pr = p.getBoundingClientRect();
    top = Math.max(top, pr.top); left = Math.max(left, pr.left);
    right = Math.min(right, pr.right); bottom = Math.min(bottom, pr.bottom);
  }
  if (naTela) {
    top = Math.max(top, 0); left = Math.max(left, 0);
    right = Math.min(right, window.innerWidth); bottom = Math.min(bottom, window.innerHeight);
  }
  const width = right - left, height = bottom - top;
  return width >= 8 && height >= 8 ? { top, left, width, height } : null;
}

/**
 * Primeiro alvo visível do passo (data-tour antes; seletores de reserva depois).
 * `naTela`: só vale o que está dentro da janela agora (para destacar); sem ele,
 * vale também o que dá para trazer à tela rolando a página.
 */
export function acharAlvo(alvos: Alvo[], naTela = false): { el: Element; caixa: Caixa } | null {
  for (const a of alvos) {
    try {
      const lista = typeof a === "string"
        ? Array.from(document.querySelectorAll(a))
        : Array.from(document.querySelectorAll(a.seletor)).filter((el) =>
            (el.textContent ?? "").toLowerCase().includes(a.texto.toLowerCase()));
      for (const el of lista) {
        // o próprio cartão do tour (link "Anunciar meu imóvel") não é alvo: piscava destacando a si mesmo
        if (el.closest("[data-tour-overlay]")) continue;
        const caixa = recorte(el, naTela);
        if (caixa) return { el, caixa };
      }
    } catch { /* seletor inválido: tenta o próximo */ }
  }
  return null;
}

const FOLGA = 8;

export default function TourOverlay({ passos, onFim }: {
  passos: PassoTour[];
  /** fechou (pulou ou concluiu): marca como visto */
  onFim: () => void;
}) {
  // passos opcionais sem alvo na tela saem do roteiro já na abertura
  const [roteiro] = useState(() => passos.filter((p) => !p.opcional || acharAlvo(p.alvos)));
  const [n, setN] = useState(0);
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [janela, setJanela] = useState({ w: 0, h: 0 });
  const principal = useRef<HTMLButtonElement>(null);
  const passo = roteiro[n];

  const medir = useCallback(() => {
    setJanela({ w: window.innerWidth, h: window.innerHeight });
    const r = passo ? acharAlvo(passo.alvos, true)?.caixa : null;
    if (!r) { setCaixa(null); return; }
    setCaixa((c) => (c && c.top === r.top && c.left === r.left && c.width === r.width && c.height === r.height
      ? c : { top: r.top, left: r.left, width: r.width, height: r.height }));
  }, [passo]);

  // leva o alvo para a tela ao trocar de passo
  useLayoutEffect(() => {
    const el = passo ? acharAlvo(passo.alvos)?.el : null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const quadro = requestAnimationFrame(medir);
    principal.current?.focus();
    return () => cancelAnimationFrame(quadro);
  }, [passo, medir]);

  useEffect(() => {
    const t = window.setInterval(medir, 400);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [medir]);

  const ultimo = n >= roteiro.length - 1;
  const avancar = useCallback(() => (ultimo ? onFim() : setN((x) => x + 1)), [ultimo, onFim]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFim();
      else if (e.key === "ArrowRight") avancar();
      else if (e.key === "ArrowLeft") setN((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [avancar, onFim]);

  if (!passo) return null;

  // cartão: embaixo do alvo se couber, senão em cima; no celular, preso ao rodapé
  const celular = janela.w > 0 && janela.w < 640;
  const LARGURA = 340;
  let estiloCartao: React.CSSProperties;
  if (celular || !caixa) {
    // celular: no rodapé; se o alvo estiver na metade de baixo (Ferramentas, Ari), no topo
    estiloCartao = celular
      ? (caixa && caixa.top + caixa.height / 2 > janela.h / 2 ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 })
      : { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: LARGURA };
  } else {
    const embaixo = caixa.top + caixa.height + FOLGA + 220 < janela.h;
    const left = Math.min(Math.max(12, caixa.left + caixa.width / 2 - LARGURA / 2), janela.w - LARGURA - 12);
    estiloCartao = embaixo
      ? { left, top: caixa.top + caixa.height + FOLGA + 10, width: LARGURA }
      : { left, bottom: janela.h - caixa.top + FOLGA + 10, width: LARGURA };
  }

  return (
    <div data-tour-overlay className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-labelledby="tour-titulo" aria-describedby="tour-texto">
      {/* fundo: o recorte é a sombra enorme da caixa do alvo; sem alvo, só escurece */}
      <div className="absolute inset-0" onClick={onFim} aria-hidden
        style={caixa ? undefined : { background: "rgb(5 20 14 / 0.62)" }} />
      {caixa && (
        <div aria-hidden className="pointer-events-none absolute rounded-xl ring-2 ring-[#D9BD6F] transition-all duration-200"
          style={{
            top: caixa.top - FOLGA, left: caixa.left - FOLGA,
            width: caixa.width + FOLGA * 2, height: caixa.height + FOLGA * 2,
            boxShadow: "0 0 0 9999px rgb(5 20 14 / 0.62)",
          }} />
      )}

      <div className="absolute rounded-2xl border border-linha-forte bg-superficie p-5 text-texto shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)]"
        style={estiloCartao}>
        <div className="flex items-start gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ouro">
            {n + 1} de {roteiro.length}
          </p>
          <button type="button" onClick={onFim} aria-label="Fechar o tour"
            className="-mr-1 -mt-1 ml-auto grid size-8 place-items-center rounded-full text-texto-2 transition hover:bg-superficie-2 hover:text-texto">
            <X className="size-4" />
          </button>
        </div>
        <p id="tour-titulo" className="lp-display mt-1 text-lg text-texto">{passo.titulo}</p>
        <p id="tour-texto" className="mt-1.5 text-[15px] leading-relaxed text-texto-2">{passo.texto}</p>
        {passo.acao && !caixa && (
          <Link href={passo.acao.href} onClick={onFim} className="mt-3 inline-flex text-sm font-semibold text-verde underline underline-offset-2">
            {passo.acao.rotulo}
          </Link>
        )}
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={onFim} className="text-sm font-semibold text-texto-2 transition hover:text-texto">
            Pular
          </button>
          <span className="ml-auto" />
          {n > 0 && (
            <button type="button" onClick={() => setN(n - 1)} aria-label="Passo anterior"
              className="grid size-10 place-items-center rounded-full border border-linha-forte text-texto transition hover:border-verde">
              <ArrowLeft className="size-4" />
            </button>
          )}
          <button ref={principal} type="button" onClick={avancar}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-verde px-4 text-sm font-bold text-fundo transition hover:brightness-110">
            {ultimo ? "Concluir" : <>Próximo <ArrowRight className="size-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
