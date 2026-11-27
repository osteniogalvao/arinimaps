import Link from "next/link";

/**
 * Faixa de números no topo das telas, como no CRM da Arini Negócios: cada
 * cartão mostra um total e, quando tem `href`, abre a lista filtrada.
 */
export type ItemResumo = { rotulo: string; valor: number | string; href?: string; tom?: "verde" | "ouro" | "alerta" | "critico" | "neutro"; ativo?: boolean };

const COR: Record<NonNullable<ItemResumo["tom"]>, string> = {
  verde: "text-verde", ouro: "text-ouro", alerta: "text-alerta", critico: "text-critico", neutro: "text-texto",
};

export default function Resumo({ itens }: { itens: ItemResumo[] }) {
  return (
    <div className={"grid gap-3 grid-cols-2 " + (itens.length >= 5 ? "md:grid-cols-5" : itens.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3")}>
      {itens.map((i) => {
        const corpo = (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-texto-2">{i.rotulo}</p>
            <p className={"mt-1 lp-display text-3xl tabular-nums " + COR[i.tom ?? "neutro"]}>{i.valor}</p>
          </>
        );
        const base = "cartao block px-5 py-4 transition-colors " + (i.ativo ? "ring-2 ring-verde/60" : "");
        return i.href
          ? <Link key={i.rotulo} href={i.href} className={base + " hover:border-verde/50"}>{corpo}</Link>
          : <div key={i.rotulo} className={base}>{corpo}</div>;
      })}
    </div>
  );
}
