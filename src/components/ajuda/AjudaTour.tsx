"use client";

/**
 * Botão "Ajuda" + tour guiado de primeira visita (2ª etapa do cliente, item 14).
 *
 *  · Primeira visita: o tour do perfil abre sozinho (mapa, painel, parceiro,
 *    central). "Pular" ou "Concluir" marca como visto no localStorage
 *    (`arini:tour:<perfil>`) e, logado, na conta (POST /api/conta/tour,
 *    coluna da migration 0062 — sem ela vale só o navegador).
 *  · O botão Ajuda abre o menu: ver o tour de novo, Central de ajuda (/ajuda),
 *    Pergunte à Ari e Suporte.
 *  · `?tour=1` na URL abre o tour mesmo já visto (links da /ajuda).
 *
 * O tour (TourOverlay) só é baixado quando abre: import dinâmico.
 */

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, CircleHelp, LifeBuoy, PlayCircle } from "lucide-react";
import { abrirAssistente } from "@/components/ia/ChatIA";
import MarcaArini from "@/components/marca/MarcaArini";
import { temSessao } from "@/lib/usePreferencias";
import { PASSOS_TOUR, type PerfilTour } from "./passosTour";

const TourOverlay = dynamic(() => import("./TourOverlay"), { ssr: false });

const chave = (perfil: PerfilTour) => `arini:tour:${perfil}`;

function vistoLocal(perfil: PerfilTour) {
  try { return localStorage.getItem(chave(perfil)) === "1"; } catch { return false; }
}
function marcarLocal(perfil: PerfilTour) {
  try { localStorage.setItem(chave(perfil), "1"); } catch { /* storage bloqueado: o tour pode voltar */ }
}

export default function AjudaTour({ perfil, className = "fixed bottom-5 right-5 z-40" }: {
  perfil: PerfilTour;
  /** posição do botão Ajuda na tela */
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [menu, setMenu] = useState(false);
  const caixaMenu = useRef<HTMLDivElement>(null);

  const fim = useCallback(() => {
    setAberto(false);
    marcarLocal(perfil);
    // sem sessão a rota responde 401: o visto fica só no navegador
    if (!temSessao()) return;
    fetch("/api/conta/tour", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tour: perfil }),
    }).catch(() => undefined);
  }, [perfil]);

  // primeira visita (ou ?tour=1)
  useEffect(() => {
    let cancelado = false;
    let timer = 0;
    const abrirDepois = () => { timer = window.setTimeout(() => { if (!cancelado) setAberto(true); }, 1400); };
    const forcar = new URLSearchParams(window.location.search).get("tour") === "1";
    if (forcar) abrirDepois();
    else if (!vistoLocal(perfil) && !temSessao()) abrirDepois();
    else if (!vistoLocal(perfil)) {
      fetch("/api/conta/tour")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { vistos?: string[] } | null) => {
          if (cancelado) return;
          if (d?.vistos?.includes(perfil)) marcarLocal(perfil);
          else abrirDepois();
        })
        .catch(() => abrirDepois());
    }
    return () => { cancelado = true; window.clearTimeout(timer); };
  }, [perfil]);

  // fecha o menu ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!menu) return;
    const fora = (e: MouseEvent) => { if (!caixaMenu.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-texto transition hover:bg-superficie-2";

  return (
    <>
      <div ref={caixaMenu} className={className}>
        {menu && (
          <div role="menu" aria-label="Ajuda"
            className="absolute bottom-full right-0 mb-2 w-64 rounded-2xl border border-linha-forte bg-superficie p-1.5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)]">
            <button type="button" role="menuitem" className={item} onClick={() => { setMenu(false); setAberto(true); }}>
              <PlayCircle className="size-4 shrink-0 text-ouro" /> Ver o tour de novo
            </button>
            <Link href="/ajuda" role="menuitem" className={item} onClick={() => setMenu(false)}>
              <BookOpen className="size-4 shrink-0 text-verde" /> Central de ajuda
            </Link>
            <button type="button" role="menuitem" className={item} onClick={() => { setMenu(false); abrirAssistente(); }}>
              <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
                <MarcaArini variante="radar" titulo="" className="size-4" />
              </span>
              Pergunte à Ari
            </button>
            <Link href="/suporte" role="menuitem" className={item} onClick={() => setMenu(false)}>
              <LifeBuoy className="size-4 shrink-0 text-texto-2" /> Falar com o suporte
            </Link>
          </div>
        )}
        <button type="button" data-tour="ajuda" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu"
          className="inline-flex h-10 items-center gap-1.5 rounded-full border border-linha-forte bg-superficie/95 px-3.5 text-sm font-semibold text-texto shadow-[0_8px_24px_-12px_rgb(0_0_0/0.7)] backdrop-blur-md transition hover:border-verde">
          <CircleHelp className="size-4" /> Ajuda
        </button>
      </div>
      {aberto && <TourOverlay passos={PASSOS_TOUR[perfil]} onFim={fim} />}
    </>
  );
}
