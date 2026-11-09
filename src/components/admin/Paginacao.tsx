import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Rodapé de lista paginada da Central: "Mostrando 51–100 de 340" e os links
 * de página anterior/próxima. Mantém os outros filtros da URL (`params`).
 * Some quando tudo cabe numa página.
 */
export default function Paginacao({
  caminho, pagina, porPagina, total, params = {},
}: {
  caminho: string; pagina: number; porPagina: number; total: number | null;
  params?: Record<string, string | string[] | undefined>;
}) {
  const t = total ?? 0;
  if (t <= porPagina && pagina <= 1) return null;
  const ultima = Math.max(1, Math.ceil(t / porPagina));
  const de = t ? (pagina - 1) * porPagina + 1 : 0;
  const ate = Math.min(t, pagina * porPagina);
  const link = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "pagina" || v == null || v === "") continue;
      q.set(k, Array.isArray(v) ? v[0] : v);
    }
    if (p > 1) q.set("pagina", String(p));
    const s = q.toString();
    return s ? `${caminho}?${s}` : caminho;
  };
  const botao = "inline-flex items-center gap-1 rounded-full border border-linha px-3.5 py-1.5 text-sm font-semibold transition-colors";
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3 text-sm text-texto-2">
      <span className="tabular-nums">Mostrando {de.toLocaleString("pt-BR")}–{ate.toLocaleString("pt-BR")} de {t.toLocaleString("pt-BR")}</span>
      <span className="flex gap-2">
        {pagina > 1 ? (
          <Link href={link(pagina - 1)} className={`${botao} text-texto hover:border-linha-forte`}><ChevronLeft className="size-4" /> Anterior</Link>
        ) : <span className={`${botao} opacity-40`}><ChevronLeft className="size-4" /> Anterior</span>}
        {pagina < ultima ? (
          <Link href={link(pagina + 1)} className={`${botao} text-texto hover:border-linha-forte`}>Próxima <ChevronRight className="size-4" /></Link>
        ) : <span className={`${botao} opacity-40`}>Próxima <ChevronRight className="size-4" /></span>}
      </span>
    </nav>
  );
}
