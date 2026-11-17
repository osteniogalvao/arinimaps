"use client";

/**
 * Alterna entre o tema escuro e o claro.
 *
 * Sem escolha salva, vale o tema do aparelho (prefers-color-scheme) e o site
 * acompanha se a pessoa mudar o aparelho com a página aberta. Clicar no botão
 * grava a escolha no localStorage, e ela passa a valer por cima do aparelho.
 * O tema vira `data-tema` no <html>. Quem aplica o
 * tema ANTES da pintura é o script de `TEMA_SCRIPT` (no <head>), senão a tela
 * piscaria escura antes de virar clara a cada navegação.
 */

import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { usePreferencias } from "@/lib/usePreferencias";
import type { TemaPreferido } from "@/lib/preferencias";

export type Tema = "escuro" | "claro";

export const CHAVE_TEMA = "arini:tema";

/**
 * Roda antes do primeiro paint, no <head>. Precisa ser pequeno, síncrono e
 * tolerante: navegador com storage bloqueado não pode derrubar a página.
 */
export const TEMA_SCRIPT = `
try {
  var h = document.documentElement, t = null;
  try { t = localStorage.getItem("${CHAVE_TEMA}"); } catch (e) {}
  var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)");
  var aplica = function (claro) {
    if (claro) h.setAttribute("data-tema", "claro"); else h.removeAttribute("data-tema");
  };
  // sem escolha salva: claro. O manual (v1.0) faz do off-white o fundo
  // principal; o escuro fica como opção da pessoa (botão ou conta).
  if (t === "escuro") aplica(false);
  else if (t === "claro") aplica(true);
  else if (t === "sistema" && mq) {
    aplica(mq.matches);
    var segue = function (e) {
      var s = null;
      try { s = localStorage.getItem("${CHAVE_TEMA}"); } catch (x) {}
      if (s === "sistema") aplica(e.matches);
    };
    if (mq.addEventListener) mq.addEventListener("change", segue); else if (mq.addListener) mq.addListener(segue);
  } else aplica(true);
} catch (e) {}
`;

function lerTema(): Tema {
  if (typeof document === "undefined") return "escuro";
  return document.documentElement.getAttribute("data-tema") === "claro" ? "claro" : "escuro";
}

/**
 * Tema atual, para o que não é resolvido só por CSS — hoje, a base do mapa.
 *
 * Observa o atributo no <html> em vez de um contexto React porque quem escreve
 * o tema no primeiro carregamento é o script do <head>, fora do React.
 * Devolve "escuro" no primeiro render (servidor e cliente) e corrige no efeito,
 * senão a hidratação diverge.
 */
export function useTema(): Tema {
  const [tema, setTema] = useState<Tema>("escuro");
  useEffect(() => {
    setTema(lerTema());
    const obs = new MutationObserver(() => setTema(lerTema()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    return () => obs.disconnect();
  }, []);
  return tema;
}

/**
 * Aplica a preferência de tema da conta (5.10). "sistema" grava "sistema" e
 * volta a seguir o aparelho (sem chave nenhuma, o padrão agora é o claro do
 * manual) — o script do <head> liga o ouvinte do prefers-color-scheme no
 * próximo carregamento.
 */
export function aplicarTemaPreferido(t: TemaPreferido) {
  const h = document.documentElement;
  if (t === "sistema") {
    try { localStorage.setItem(CHAVE_TEMA, "sistema"); } catch { /* storage bloqueado */ }
    const claro = !!window.matchMedia?.("(prefers-color-scheme: light)").matches;
    if (claro) h.setAttribute("data-tema", "claro"); else h.removeAttribute("data-tema");
    return;
  }
  if (t === "claro") h.setAttribute("data-tema", "claro"); else h.removeAttribute("data-tema");
  try { localStorage.setItem(CHAVE_TEMA, t); } catch { /* storage bloqueado: vale só nesta aba */ }
}

export default function BotaoTema({ compacto = false }: { compacto?: boolean }) {
  // começa no escuro no servidor e no primeiro render do cliente para não dar
  // divergência de hidratação; o efeito abaixo corrige com o valor real.
  // acompanha o <html>: o tema pode mudar sozinho quando segue o aparelho
  const tema = useTema();
  const [montado, setMontado] = useState(false);
  // 5.10: com sessão, o tema salvo na conta vale em qualquer aparelho;
  // sem sessão, segue valendo o localStorage
  const { prefs, logado, carregado, salvar } = usePreferencias();
  const aplicado = useRef(false);

  useEffect(() => { setMontado(true); }, []);

  useEffect(() => {
    if (!carregado || !logado || aplicado.current) return;
    aplicado.current = true;
    aplicarTemaPreferido(prefs.tema);
  }, [carregado, logado, prefs.tema]);

  function alternar() {
    const novo: Tema = tema === "claro" ? "escuro" : "claro";
    aplicarTemaPreferido(novo);
    aplicado.current = true;
    void salvar({ tema: novo });
  }

  const vaiPara = tema === "claro" ? "escuro" : "claro";

  return (
    <button
      onClick={alternar}
      type="button"
      aria-label={`Mudar para o tema ${vaiPara}`}
      title={`Mudar para o tema ${vaiPara}`}
      className={
        "shrink-0 rounded-full text-verde hover:bg-verde/12 transition grid place-items-center " +
        (compacto ? "size-10" : "size-10 sm:w-auto sm:px-3 sm:gap-2 sm:flex sm:items-center")
      }
    >
      {/* enquanto não montou, mostra o ícone do tema escuro (o do servidor) */}
      {montado && tema === "claro"
        ? <Moon aria-hidden className="size-[18px]" />
        : <Sun aria-hidden className="size-[18px]" />}
      {!compacto && (
        <span className="hidden sm:inline text-sm font-semibold">
          {montado && tema === "claro" ? "Escuro" : "Claro"}
        </span>
      )}
    </button>
  );
}
