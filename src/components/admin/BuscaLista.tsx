import { Search } from "lucide-react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

/**
 * Busca das listas paginadas da Central: formulário GET simples (funciona sem
 * JavaScript). Mantém os outros filtros da URL e volta para a página 1.
 */
export default function BuscaLista({
  caminho, valor, placeholder, manter = {},
}: {
  caminho: string; valor?: string; placeholder: string;
  manter?: Record<string, string | string[] | undefined>;
}) {
  return (
    <form action={caminho} method="get" role="search" className="flex flex-wrap items-center gap-2">
      {Object.entries(manter).map(([k, v]) => {
        const s = Array.isArray(v) ? v[0] : v;
        return k !== "q" && k !== "pagina" && s ? <input key={k} type="hidden" name={k} value={s} /> : null;
      })}
      <label className="relative">
        <span className="sr-only">{placeholder}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-2" />
        <input type="search" name="q" defaultValue={valor ?? ""} placeholder={placeholder} maxLength={80}
          className={CAMPO_COMPACTO + " w-72 max-w-full pl-9"} />
      </label>
      <button className="btn-contorno px-4 py-2 text-sm">Buscar</button>
    </form>
  );
}

/** Texto da busca pronto para `ilike` (sem curingas nem vírgula, que quebram o `.or()`). */
export function termoBusca(q: string | string[] | undefined) {
  const s = (Array.isArray(q) ? q[0] : q ?? "").trim().slice(0, 80);
  return s.replace(/[%_,()\\*]/g, " ").replace(/\s+/g, " ").trim();
}
