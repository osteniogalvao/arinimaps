"use client";

/**
 * Unidades de um prédio, por andar (pedido do Carlos, áudio de 18/11/2026
 * 16h57): "naquele prédio há três apartamentos disponíveis, a pessoa clica lá e
 * já abre os três". Abre quando o clique no mapa cai num prédio com
 * apartamentos à venda. No celular é uma folha que sobe de baixo (o mapa
 * continua visível em cima); da tela média para cima, uma coluna à direita.
 */

import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { BotaoFechar } from "@/components/map/UiMapa";
import { formatArea, formatBRL } from "@/lib/format";
import { agruparPorAndar, rotuloAndar, rotuloUnidade, type SubtipoUnidade } from "@/lib/imovel/unidade";

export type UnidadeNoPredio = {
  id: string;
  codigo: string;
  titulo: string;
  status: string;
  valor: number | null;
  area_m2: number | null;
  capa: string | null;
  andar: number | null;
  unidade: string | null;
  subtipo: SubtipoUnidade | null;
};

export type Predio = {
  /** código do imóvel pai (o prédio), quando as unidades apontam para um */
  codigo: string | null;
  titulo: string;
  unidades: UnidadeNoPredio[];
};

function mediaUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

export default function PainelPredio({ predio, onFechar }: { predio: Predio; onFechar: () => void }) {
  const andares = agruparPorAndar(predio.unidades);
  const total = predio.unidades.length;
  return (
    <aside
      role="dialog" aria-label={`Unidades à venda em ${predio.titulo}`}
      className={
        // celular: folha de baixo, até 72% da tela; sm+: coluna como o painel do imóvel
        "absolute inset-x-0 bottom-0 z-30 flex max-h-[72dvh] flex-col rounded-t-3xl border-t border-linha bg-superficie shadow-2xl " +
        "sm:relative sm:inset-auto sm:z-auto sm:h-full sm:max-h-none sm:w-[340px] sm:shrink-0 sm:rounded-none sm:border-t-0 sm:border-l sm:shadow-none"
      }>
      <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-linha-forte sm:hidden" aria-hidden />
      <div className="flex items-start gap-3 border-b border-linha px-5 pb-4 pt-3 sm:pt-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-verde/10 text-verde">
          <Building2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="lp-eyebrow !text-[11px] !text-ouro">Prédio</p>
          <h2 className="lp-display text-xl leading-tight text-verde text-balance">{predio.titulo}</h2>
          <p className="mt-1 text-sm text-texto-2">
            {total} {total === 1 ? "unidade à venda" : "unidades à venda"} · {andares.length} {andares.length === 1 ? "andar" : "andares"}
          </p>
        </div>
        <BotaoFechar onClick={onFechar} rotulo="Fechar prédio" />
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
        {andares.map((g) => (
          <section key={String(g.andar)}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-texto-2">
              {rotuloAndar(g.andar)}
              <span className="h-px flex-1 bg-linha" aria-hidden />
              <span className="tabular-nums normal-case tracking-normal">{g.unidades.length}</span>
            </h3>
            <ul className="space-y-2">
              {g.unidades.map((u) => (
                <li key={u.id}>
                  <Link href={`/imovel/${u.codigo}`}
                    className="group flex min-h-16 items-center gap-3 rounded-2xl border border-linha bg-superficie p-2.5 transition hover:border-verde active:bg-superficie-2">
                    {u.capa ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(u.capa)} alt="" loading="lazy" decoding="async" className="size-14 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-superficie-2 text-texto-2">
                        <Building2 className="size-5" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-texto group-hover:text-verde">
                        {rotuloUnidade(u) ?? u.titulo}
                      </span>
                      <span className="block truncate text-xs text-texto-2">
                        {[u.area_m2 ? formatArea(u.area_m2, "urbano") : null, rotuloUnidade(u) ? u.titulo : u.codigo]
                          .filter(Boolean).join(" · ")}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="text-sm font-bold tabular-nums text-verde">{u.valor ? formatBRL(u.valor) : "Sob consulta"}</span>
                        {u.status === "em_negociacao" && (
                          <span className="rounded-full bg-alerta/10 px-2 py-0.5 text-[11px] font-semibold text-alerta">Em negociação</span>
                        )}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-texto-2 transition group-hover:translate-x-0.5 group-hover:text-verde" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {predio.codigo && (
        <div className="border-t border-linha px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Link href={`/imovel/${predio.codigo}`}
            className="flex items-center justify-between rounded-full border border-linha-forte px-5 py-3 text-sm font-semibold text-texto transition hover:border-verde hover:text-verde">
            Ver a página do prédio <ChevronRight className="size-4" />
          </Link>
        </div>
      )}
    </aside>
  );
}
