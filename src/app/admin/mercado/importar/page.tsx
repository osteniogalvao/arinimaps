import Link from "next/link";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import Formulario from "./Formulario";

export default async function ImportarCotacoes({ searchParams }: PageProps<"/admin/mercado/importar">) {
  await exigirSetor("operacoes", "diretoria");
  const sp = await searchParams,
    pagina = Math.max(1, Math.min(10000, Math.trunc(Number(sp.pagina) || 1))),
    inicio = (pagina - 1) * 20;
  const id =
    typeof sp.lote === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sp.lote)
      ? sp.lote
      : null;
  const db = supabaseAdmin();
  const [lista, detalhe, lote] = await Promise.all([
    db
      .from("cotacoes_importacoes")
      .select(
        "id,fonte,arquivo,autorizacao,referencia,novas,corrigidas,criadas_em,cotacoes_series(nome,slug),profiles(nome)",
      )
      .order("criadas_em", { ascending: false })
      .order("id")
      .range(inicio, inicio + 20),
    id
      ? db
          .from("cotacoes_importacao_itens")
          .select("data,anterior,valor")
          .eq("importacao", id)
          .order("data")
          .limit(1000)
      : { data: [], error: null },
    id
      ? db.from("cotacoes_importacoes").select("arquivo,fonte,autorizacao").eq("id", id).maybeSingle()
      : { data: null, error: null },
  ]);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CabecalhoPagina eyebrow="Central · Operações" titulo="Importar cotações regionais" />
      <Formulario />
      {(lista.error || detalhe.error || lote.error) && (
        <p role="alert">Não foi possível consultar o histórico.</p>
      )}
      {lote.data && (
        <details open className="cartao p-4">
          <summary className="font-semibold">
            {lote.data.arquivo} · {lote.data.fonte}
          </summary>
          <p>{lote.data.autorizacao}</p>
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Data</th>
                <th>Anterior</th>
                <th>Importado</th>
              </tr>
            </thead>
            <tbody>
              {detalhe.data?.map((p) => (
                <tr key={p.data}>
                  <td>{p.data}</td>
                  <td>{p.anterior ?? "—"}</td>
                  <td>{p.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Histórico de importações</h2>
        {lista.data?.length === 0 && <p>Nenhuma importação nesta página.</p>}
        {lista.data?.slice(0, 20).map((l) => {
          const serie = l.cotacoes_series as unknown as { nome: string; slug: string },
            ator = l.profiles as unknown as { nome: string };
          return (
            <article key={l.id} className="cartao space-y-1 p-4">
              <p className="font-semibold">
                {serie.nome} · {l.fonte}
              </p>
              <p>
                {new Date(l.criadas_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} ·{" "}
                {ator.nome} · {l.arquivo}
              </p>
              <p>
                {l.novas} datas novas e {l.corrigidas} correções. {l.autorizacao}
              </p>
              <Link className="mr-4 underline" href={"?pagina=" + pagina + "&lote=" + l.id}>
                Ver valores importados
              </Link>
              <Link className="underline" href={"/mercado?serie=" + serie.slug}>
                Abrir série publicada
              </Link>
            </article>
          );
        })}
        <nav className="flex gap-4" aria-label="Páginas do histórico">
          {pagina > 1 && (
            <Link className="underline" href={"?pagina=" + (pagina - 1)}>
              Anterior
            </Link>
          )}
          {(lista.data?.length ?? 0) > 20 && (
            <Link className="underline" href={"?pagina=" + (pagina + 1)}>
              Próxima
            </Link>
          )}
        </nav>
      </section>
    </div>
  );
}
