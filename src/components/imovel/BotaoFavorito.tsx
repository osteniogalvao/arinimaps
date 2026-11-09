"use client";

import { useEffect, useSyncExternalStore, useState } from "react";
import Link from "next/link";
import { Heart, LogIn, X } from "lucide-react";

/**
 * Coração de favorito (cartão da busca e ficha do imóvel). Todos os botões da
 * página compartilham o mesmo estado: marcar num lugar acende nos outros.
 * O servidor manda o estado inicial (sem piscar); a rota /api/favoritos
 * grava na conta ou, sem conta, num cookie.
 */
let codigos: Set<string> | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

function definir(lista: string[]) {
  codigos = new Set(lista);
  avisar();
  window.dispatchEvent(new CustomEvent("arini:favoritos", { detail: lista.length }));
}

export default function BotaoFavorito({ codigo, inicial, variante = "cartao" }: {
  codigo: string;
  inicial: boolean;
  variante?: "cartao" | "ficha";
}) {
  const marcado = useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    () => (codigos ? codigos.has(codigo) : inicial),
    () => inicial,
  );
  const [enviando, setEnviando] = useState(false);
  // retorno quando a rota recusa: antes o coração só voltava atrás, calado
  const [aviso, setAviso] = useState<{ tipo: "entrar" | "erro"; volta: string } | null>(null);

  // o aviso some sozinho depois de um tempo
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 8000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  async function alternar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (enviando) return;
    const novo = !marcado;
    // otimista: acende na hora e desfaz se a rota falhar
    const antes = codigos ? [...codigos] : (inicial ? [codigo] : []);
    definir(novo ? [...antes.filter((c) => c !== codigo), codigo] : antes.filter((c) => c !== codigo));
    setEnviando(true);
    setAviso(null);
    const volta = window.location.pathname + window.location.search;
    try {
      const r = await fetch("/api/favoritos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, favorito: novo }),
      });
      if (r.status === 401) {
        definir(antes);
        setAviso({ tipo: "entrar", volta });
        return;
      }
      if (!r.ok) throw new Error();
      const j = await r.json() as { codigos: string[] };
      definir(j.codigos);
    } catch {
      definir(antes);
      setAviso({ tipo: "erro", volta });
    } finally {
      setEnviando(false);
    }
  }

  const rotulo = marcado ? "Remover dos favoritos" : "Salvar nos favoritos";
  const balao = aviso && (
    <div role="status"
      className={`z-20 flex items-start gap-2 rounded-xl border border-linha bg-superficie p-3 text-left text-sm text-texto shadow-[0_10px_30px_-12px_rgba(10,34,25,.45)] ${
        variante === "ficha" ? "mt-2" : "absolute right-0 top-12 w-64"}`}>
      <p className="min-w-0 flex-1 leading-snug">
        {aviso.tipo === "entrar" ? (
          <>
            Entre para salvar favoritos.{" "}
            <Link href={`/entrar?volta=${encodeURIComponent(aviso.volta)}`}
              className="inline-flex items-center gap-1 font-semibold text-verde underline-offset-4 hover:underline">
              <LogIn className="size-3.5" aria-hidden /> Entrar
            </Link>
          </>
        ) : (
          "Não foi possível salvar o favorito. Tente de novo."
        )}
      </p>
      <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso"
        className="-m-1 grid size-6 shrink-0 place-items-center rounded-full text-texto-2 hover:bg-superficie-2 hover:text-texto">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );

  if (variante === "ficha") {
    return (
      <div>
      <button type="button" onClick={alternar} aria-pressed={marcado} title={rotulo}
        className={`flex w-full items-center justify-center gap-2 rounded-full border-[1.5px] py-3 text-sm font-bold transition ${marcado
          ? "border-critico/60 bg-critico/10 text-critico"
          : "border-linha-forte bg-superficie text-texto hover:border-critico/60 hover:text-critico"}`}>
        <Heart className={`size-4 ${marcado ? "fill-current" : ""}`} />
        {marcado ? "Salvo nos favoritos" : "Favoritar"}
      </button>
      {balao}
      </div>
    );
  }
  return (
    <div className="relative">
    <button type="button" onClick={alternar} aria-pressed={marcado} aria-label={rotulo} title={rotulo}
      className={`grid size-10 place-items-center rounded-full backdrop-blur transition active:scale-90 ${marcado
        ? "bg-[#F2F2EC] text-[#D80B0B]"
        : "bg-[#0A2219]/60 text-[#F2F2EC] hover:bg-[#0A2219]/80"}`}>
      <Heart className={`size-5 ${marcado ? "fill-current" : ""}`} />
    </button>
    {balao}
    </div>
  );
}
