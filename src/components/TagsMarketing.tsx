"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { tagValeEm, type TagAtiva } from "@/lib/tags-marketing";

/**
 * Coloca na página os códigos de Marketing > Tags e pixels (migration 0172).
 *
 * Os códigos entram depois que a página carrega (não atrasam a primeira
 * pintura) e a cada troca de página o componente confere quais passam a
 * valer: um pixel restrito a /imovel/** carrega quando a pessoa chega num
 * imóvel, mesmo navegando sem recarregar. Cada código entra uma vez só por
 * visita; um script já carregado não tem como ser "descarregado" ao sair da
 * página (igual em qualquer site de navegação sem recarga).
 *
 * O painel da equipe (/admin) nunca recebe código de terceiros.
 */

/** Ids já colocados nesta aba (sobrevive à navegação entre páginas). */
const colocadas = new Set<string>();

/** Script criado por innerHTML não roda; recria cada <script> para o navegador executá-lo. */
function recriar(no: Node): Node {
  if (no instanceof HTMLScriptElement) {
    const s = document.createElement("script");
    for (const a of Array.from(no.attributes)) s.setAttribute(a.name, a.value);
    s.text = no.text;
    // sem async declarado, mantém a ordem do código (biblioteca antes do uso)
    if (!no.hasAttribute("async")) s.async = false;
    return s;
  }
  if (no instanceof Element) {
    const copia = no.cloneNode(false);
    for (const filho of Array.from(no.childNodes)) copia.appendChild(recriar(filho));
    return copia;
  }
  return no.cloneNode(true);
}

/** Espera um script externo sem async carregar antes de seguir (como no HTML normal). */
function aguardar(no: Node) {
  if (!(no instanceof HTMLScriptElement) || !no.src || no.hasAttribute("async") || no.hasAttribute("defer")) return null;
  return new Promise<void>((ok) => {
    no.addEventListener("load", () => ok(), { once: true });
    no.addEventListener("error", () => ok(), { once: true });
    setTimeout(ok, 8000);
  });
}

async function colocar(tag: TagAtiva) {
  const molde = document.createElement("template");
  molde.innerHTML = tag.codigo;
  // marcador no ponto de entrada: os nós vão antes dele, na ordem do código
  const marca = document.createComment(` marketing:${tag.id} `);
  if (tag.posicao === "head") document.head.appendChild(marca);
  else if (tag.posicao === "body_inicio") document.body.insertBefore(marca, document.body.firstChild);
  else document.body.appendChild(marca);
  for (const no of Array.from(molde.content.childNodes)) {
    try {
      const novo = recriar(no);
      marca.parentNode?.insertBefore(novo, marca);
      const espera = aguardar(novo);
      if (espera) await espera;
    } catch (e) {
      console.error("código de marketing falhou:", e);
    }
  }
}

export default function TagsMarketing({ tags }: { tags: TagAtiva[] }) {
  const caminho = usePathname() ?? "/";
  useEffect(() => {
    if (!tags.length) return;
    for (const tag of tags) {
      if (colocadas.has(tag.id) || !tagValeEm(tag, caminho)) continue;
      colocadas.add(tag.id);
      void colocar(tag);
    }
  }, [tags, caminho]);
  return null;
}
