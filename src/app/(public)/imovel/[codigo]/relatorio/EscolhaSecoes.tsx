"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";
import { escreverSecoes, type SecaoId } from "@/lib/relatorio/secoes";

export type OpcaoSecao = { id: SecaoId; rotulo: string; descricao: string; disponivel: boolean; motivo?: string };

/**
 * "Completo" ou "Básico, só o que me interessa" (item 5). A escolha muda a URL
 * (?secoes=…), o servidor redesenha o relatório só com as seções marcadas, e o
 * mesmo link pode ser impresso ou enviado.
 */
export default function EscolhaSecoes({ opcoes, selecionadas, completo }: {
  opcoes: OpcaoSecao[]; selecionadas: SecaoId[]; completo: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendente, iniciar] = useTransition();
  const [modo, setModo] = useState<"completo" | "basico">(completo ? "completo" : "basico");
  const [marcadas, setMarcadas] = useState<Set<SecaoId>>(new Set(selecionadas));

  const aplicar = (m: "completo" | "basico", ids: Set<SecaoId>) => {
    const q = m === "completo" ? "" : `?secoes=${escreverSecoes(ids)}`;
    iniciar(() => router.replace(`${pathname}${q}`, { scroll: false }));
  };

  const disponiveis = opcoes.filter((o) => o.disponivel);

  return (
    <section aria-label="Seções do relatório" className="cartao mb-10 space-y-4 p-5 md:p-6 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="lp-display text-2xl text-texto">O que entra no relatório</p>
        {pendente && <span className="flex items-center gap-1.5 text-xs text-texto-2"><LoaderCircle className="size-3.5 animate-spin" /> Atualizando…</span>}
      </div>

      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {([
          ["completo", "Completo", "Tudo o que está disponível para este imóvel e liberado no seu plano."],
          ["basico", "Básico, só o que me interessa", "Escolha as seções abaixo."],
        ] as const).map(([id, rotulo, ajuda]) => (
          <label key={id}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border-[1.5px] p-4 transition ${modo === id ? "border-verde" : "border-linha hover:border-linha-forte"}`}>
            <input type="radio" name="modo-relatorio" value={id} checked={modo === id} className="mt-1 accent-[var(--verde)]"
              onChange={() => {
                setModo(id);
                if (id === "completo") aplicar("completo", marcadas);
                else {
                  // ao passar para o básico, começa com tudo o que está disponível marcado
                  const ids = marcadas.size ? marcadas : new Set(disponiveis.map((o) => o.id));
                  setMarcadas(ids);
                  aplicar("basico", ids);
                }
              }} />
            <span><span className="block font-semibold text-texto">{rotulo}</span>
              <span className="block text-sm text-texto-2">{ajuda}</span></span>
          </label>
        ))}
      </div>

      {modo === "basico" && (
        <fieldset className="grid gap-x-6 sm:grid-cols-2">
          <legend className="sr-only">Seções</legend>
          {opcoes.map((o) => {
            const marcada = marcadas.has(o.id) && o.disponivel;
            // pelo menos uma seção fica marcada
            const ultima = marcada && [...marcadas].filter((id) => disponiveis.some((d) => d.id === id)).length === 1;
            return (
              <label key={o.id}
                className={`flex items-start gap-3 border-t border-linha py-3 ${o.disponivel ? "cursor-pointer" : "cursor-not-allowed opacity-55"}`}>
                <input type="checkbox" className="peer sr-only" checked={marcada} disabled={!o.disponivel || ultima}
                  onChange={(e) => {
                    const ids = new Set(marcadas);
                    if (e.target.checked) ids.add(o.id); else ids.delete(o.id);
                    setMarcadas(ids);
                    aplicar("basico", ids);
                  }} />
                <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-[1.5px] peer-focus-visible:ring-2 peer-focus-visible:ring-verde ${marcada ? "border-verde bg-verde text-fundo" : "border-linha-forte"}`}>
                  {marcada && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-texto">{o.rotulo}</span>
                  <span className="block text-xs leading-relaxed text-texto-2">{o.disponivel ? o.descricao : o.motivo ?? "Indisponível para este imóvel."}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
    </section>
  );
}
