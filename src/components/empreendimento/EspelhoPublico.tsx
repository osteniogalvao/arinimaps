"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, LayoutGrid, Map as IconeMapa, X } from "lucide-react";
import { Etiqueta } from "@/components/ui/Pagina";
import { COR_ESPELHO, compararLote, rotuloLote, type UnidadePublica } from "@/lib/empreendimento/tipos";

const MapaEspelho = dynamic(() => import("./MapaEspelho"), {
  ssr: false,
  loading: () => <div className="grid h-[420px] place-items-center rounded-2xl border border-linha bg-superficie-2 text-sm text-texto-2">Carregando mapa…</div>,
});

const brl = (v: number | null) =>
  v == null ? "Sob consulta" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Espelho público do loteamento: só disponível ou indisponível. Sem cliente,
 * sem reserva, sem negociação — o servidor já entrega os dados reduzidos.
 */
export default function EspelhoPublico({ unidades, geometrias }: { unidades: UnidadePublica[]; geometrias: GeoJSON.FeatureCollection }) {
  const [vista, setVista] = useState<"mapa" | "grade">(geometrias.features.length ? "mapa" : "grade");
  const [selId, setSelId] = useState<string | null>(null);
  const sel = unidades.find((u) => u.id === selId) ?? null;
  const disponiveis = unidades.filter((u) => u.disponivel).length;

  const quadras = useMemo(() => {
    const m = new Map<string, UnidadePublica[]>();
    for (const u of [...unidades].sort(compararLote)) {
      const k = u.quadra ?? "Sem quadra";
      m.set(k, [...(m.get(k) ?? []), u]);
    }
    return [...m.entries()];
  }, [unidades]);
  const cores = useMemo(() => Object.fromEntries(unidades.map((u) => [u.id, u.disponivel ? COR_ESPELHO.disponivel : COR_ESPELHO.indisponivel])), [unidades]);
  const rotulos = useMemo(() => Object.fromEntries(unidades.map((u) => [u.id, u.numero ?? ""])), [unidades]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="inline-flex items-center gap-2 text-base text-texto">
          <span className="size-4 rounded-[5px]" style={{ background: COR_ESPELHO.disponivel }} aria-hidden />
          Disponível <strong className="tabular-nums">{disponiveis}</strong>
        </span>
        <span className="inline-flex items-center gap-2 text-base text-texto">
          <span className="size-4 rounded-[5px]" style={{ background: COR_ESPELHO.indisponivel }} aria-hidden />
          Indisponível <strong className="tabular-nums">{unidades.length - disponiveis}</strong>
        </span>
        {!!geometrias.features.length && (
          <div className="ml-auto inline-flex rounded-xl border border-linha bg-superficie-2 p-1" role="tablist" aria-label="Vista">
            {([["mapa", "Mapa", IconeMapa], ["grade", "Quadras", LayoutGrid]] as const).map(([v, r, I]) => (
              <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold ${vista === v ? "bg-superficie text-texto shadow-sm" : "text-texto-2"}`}>
                <I className="size-4" /> {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {vista === "mapa" ? (
        <MapaEspelho geometrias={geometrias} cores={cores} rotulos={rotulos} selecionado={selId} onSelecionar={setSelId}
          className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-linha" />
      ) : (
        <div className="space-y-4">
          {quadras.map(([q, lotes]) => (
            <section key={q} className="cartao p-4 md:p-5">
              <h3 className="mb-3 text-base font-semibold text-texto">{q === "Sem quadra" ? q : `Quadra ${q}`}</h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                {lotes.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => setSelId(u.id)} aria-label={`${rotuloLote(u)}: ${u.disponivel ? "disponível" : "indisponível"}`}
                      className={`h-14 w-full rounded-xl border-2 text-sm font-semibold tabular-nums text-[#10241B] active:scale-95 ${selId === u.id ? "border-ouro" : "border-transparent"}`}
                      style={{ background: u.disponivel ? COR_ESPELHO.disponivel : COR_ESPELHO.indisponivel }}>
                      {u.numero ?? u.codigo.slice(-4)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {sel && (
        <div className="cartao flex flex-wrap items-center gap-4 p-5" role="status">
          <div className="min-w-0 flex-1">
            <p className="lp-display text-xl text-texto">{rotuloLote(sel)}</p>
            <p className="mt-1 text-base text-texto-2">
              {sel.area_m2 ? `${Math.round(sel.area_m2).toLocaleString("pt-BR")} m²` : ""}
              {sel.disponivel ? ` · ${brl(sel.valor)}` : ""}
            </p>
          </div>
          <Etiqueta tom={sel.disponivel ? "verde" : "neutro"}>{sel.disponivel ? "Disponível" : "Indisponível"}</Etiqueta>
          {sel.disponivel && (
            <Link href={`/imovel/${sel.codigo}`} className="lp-btn lp-btn-verde !px-5 !py-3 text-[0.95rem]">Ver lote <ArrowRight /></Link>
          )}
          <button type="button" onClick={() => setSelId(null)} aria-label="Fechar" className="grid size-11 place-items-center rounded-xl text-texto-2 hover:bg-superficie-2">
            <X className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
