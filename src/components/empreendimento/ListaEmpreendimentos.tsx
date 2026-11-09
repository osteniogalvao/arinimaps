import Link from "next/link";
import { LandPlot, MapPin } from "lucide-react";
import { Etiqueta, Vazio } from "@/components/ui/Pagina";
import { STATUS_LABEL } from "@/lib/format";
import { COR_ESPELHO } from "@/lib/empreendimento/tipos";
import type { ResumoEmpreendimento } from "@/lib/empreendimento/espelho";

/** Cartões dos empreendimentos com a barra de situação (disponível/reservado/vendido). */
export default function ListaEmpreendimentos({ itens, base }: { itens: ResumoEmpreendimento[]; base: "/painel" | "/admin" }) {
  if (!itens.length) {
    return (
      <Vazio icone={LandPlot} titulo="Nenhum loteamento com unidades"
        texto="Quando um empreendimento for cadastrado com vários lotes de uma vez, o espelho de vendas dele aparece aqui." />
    );
  }
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {itens.map((e) => {
        const disp = Math.max(0, e.unidades - e.reservado - e.vendido);
        const pct = (n: number) => `${e.unidades ? (n / e.unidades) * 100 : 0}%`;
        return (
          <Link key={e.id} href={`${base}/empreendimentos/${e.id}`} className="cartao cartao-link group block p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-xs text-texto-2">{e.codigo}</span>
              <Etiqueta className="ml-auto">{STATUS_LABEL[e.status] ?? e.status}</Etiqueta>
            </div>
            <p className="lp-display mt-3 text-xl text-texto transition-colors group-hover:text-verde">{e.titulo}</p>
            {e.municipio && <p className="mt-1.5 flex items-center gap-2 text-base text-texto-2"><MapPin className="size-4" /> {e.municipio}</p>}
            <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-superficie-2" aria-hidden>
              <span style={{ width: pct(disp), background: COR_ESPELHO.disponivel }} />
              <span style={{ width: pct(e.reservado), background: COR_ESPELHO.reservado }} />
              <span style={{ width: pct(e.vendido), background: COR_ESPELHO.vendido }} />
            </div>
            <p className="mt-2 text-sm tabular-nums text-texto-2">
              {e.unidades} lotes · {disp} disponíveis · {e.reservado} reservados · {e.vendido} vendidos
            </p>
          </Link>
        );
      })}
    </div>
  );
}
