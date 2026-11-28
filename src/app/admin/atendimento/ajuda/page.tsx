import Link from "next/link";
import { BookOpen, FilePen, Search } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { acessoAtendimento } from "@/lib/atendimento-acesso";
import { temSetor } from "@/lib/authz";
import NavAtendimento from "@/components/atendimento/NavAtendimento";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

export const metadata = { title: "Central de Ajuda" };

const STATUS: Record<string, string> = { publicado: "Publicado", rascunho: "Rascunho", arquivado: "Arquivado" };

/**
 * Central de Ajuda (porte do CRM da Arini Negócios): os artigos que a equipe
 * usa para responder e que a Ari consulta (base de conhecimento, kb_artigos).
 * Todos leem; quem é do Marketing ou da Diretoria edita na Base de conhecimento.
 */
export default async function CentralAjuda({ searchParams }: PageProps<"/admin/atendimento/ajuda">) {
  const { a, triagem, diretoria } = await acessoAtendimento();
  const sp = await searchParams;
  const busca = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const aberto = typeof sp.artigo === "string" && /^[0-9a-f-]{36}$/i.test(sp.artigo) ? sp.artigo : null;
  const edita = temSetor(a, "marketing");
  const admin = supabaseAdmin();

  let q = admin.from("kb_artigos").select("id, titulo, fonte, status, data_referencia, updated_at")
    .order("updated_at", { ascending: false }).limit(200);
  if (!edita) q = q.eq("status", "publicado");
  else q = q.neq("status", "arquivado");
  if (busca) q = q.textSearch("busca", busca, { type: "websearch", config: "portuguese" });
  const [{ data: artigos, error }, { data: artigo }] = await Promise.all([
    q,
    aberto ? admin.from("kb_artigos").select("id, titulo, conteudo, fonte, status, data_referencia, updated_at").eq("id", aberto).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const visivel = artigo && (edita || artigo.status === "publicado") ? artigo : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="lp-display text-2xl text-texto">Central de Ajuda</h1>
        {edita && <Link href="/admin/conhecimento" className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline underline-offset-4"><FilePen className="size-4" /> Escrever ou editar artigos</Link>}
      </div>
      <NavAtendimento atual="ajuda" triagem={triagem} diretoria={diretoria} />

      <div className="cartao grid min-h-[60vh] overflow-hidden !p-0 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="border-linha lg:border-r">
          <form className="border-b border-linha p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-texto-2" />
              <input name="q" defaultValue={busca} placeholder="Buscar nos artigos…" aria-label="Buscar nos artigos" className={CAMPO_COMPACTO + " w-full !pl-8"} />
            </label>
          </form>
          <ul className="max-h-[65vh] divide-y divide-linha overflow-y-auto">
            {(artigos ?? []).map((x) => (
              <li key={x.id}>
                <Link href={`?${new URLSearchParams({ ...(busca ? { q: busca } : {}), artigo: x.id })}`}
                  className={"block px-4 py-3 transition-colors " + (x.id === aberto ? "bg-verde/12" : "hover:bg-superficie-2")}>
                  <span className="block text-sm font-medium text-texto">{x.titulo}</span>
                  <span className="mt-0.5 block text-xs text-texto-2">
                    {x.status !== "publicado" && <span className="mr-1 rounded bg-ouro/15 px-1.5 font-semibold text-ouro">{STATUS[x.status] ?? x.status}</span>}
                    atualizado em {new Date(x.updated_at).toLocaleDateString("pt-BR")}
                  </span>
                </Link>
              </li>
            ))}
            {!artigos?.length && <li className="px-4 py-10 text-center text-sm text-texto-2">{error ? "Falha ao carregar os artigos." : busca ? "Nada encontrado." : "Nenhum artigo publicado ainda."}</li>}
          </ul>
        </aside>
        <article className="p-6">
          {visivel ? (
            <>
              <h2 className="text-xl font-semibold text-texto">{visivel.titulo}</h2>
              <p className="mt-1 text-xs text-texto-2">
                {STATUS[visivel.status] ?? visivel.status} · referência {new Date(visivel.data_referencia + "T12:00:00").toLocaleDateString("pt-BR")}
                {visivel.fonte ? ` · fonte: ${visivel.fonte}` : ""}
              </p>
              <div className="mt-5 max-w-3xl whitespace-pre-wrap text-[0.95rem] leading-relaxed text-texto">{visivel.conteudo}</div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-texto-2">
              <div><BookOpen className="mx-auto mb-3 size-8 opacity-40" />Escolha um artigo à esquerda.<br />A Ari usa estes mesmos artigos para responder os clientes.</div>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
