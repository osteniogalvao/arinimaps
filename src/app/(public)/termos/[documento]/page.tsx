import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, ChevronRight, ScrollText } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import { CabecalhoPagina, Conteudo, Etiqueta } from "@/components/ui/Pagina";
import { lerConfiguracoes } from "@/lib/settings";
import { documento, documentos, paginasOficiais, versaoAnterior, VERSOES } from "@/lib/juridico";
import BotaoImprimir from "./BotaoImprimir";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/termos/[documento]">): Promise<Metadata> {
  const { documento: id } = await params;
  const doc = documento({}, id);
  return doc ? { title: doc.titulo, description: doc.resumo } : {};
}

export default async function DocumentoJuridico({ params, searchParams }: PageProps<"/termos/[documento]">) {
  const { documento: id } = await params;
  const cfg = await lerConfiguracoes();
  const { meses, versao } = await searchParams;
  if (Array.isArray(versao)) notFound();
  const doc = documento(cfg, id, meses === "6" ? 6 : meses === "12" ? 12 : undefined, versao);
  if (!doc) notFound();
  const arquivo = doc.pdf ? paginasOficiais(doc.id) : null;
  const anterior = versaoAnterior(doc.id);
  const historico = doc.versao !== VERSOES[doc.id];
  const outros = documentos(cfg).filter((d) => d.id !== doc.id);

  return (
    <div className="min-h-screen bg-fundo print:bg-white">
      <div className="print:hidden"><SiteHeader /></div>

      {/* faixa escura na tela; no papel, só o título em preto */}
      <div className="print:hidden">
        <CabecalhoPagina
          variante="faixa"
          eyebrow={doc.paraQuem}
          titulo={doc.titulo}
          subtitulo={doc.resumo}
        >
          <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-sm text-texto-2">
            <Link href="/termos" className="transition hover:text-verde">Termos e políticas</Link>
            <ChevronRight className="size-3.5 opacity-60" />
            <span className="text-texto">{doc.titulo}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2.5">
            <Etiqueta tom="neutro">Versão {doc.versao}</Etiqueta>
            <Etiqueta tom="neutro">{historico ? "Versão histórica" : "Vigente desde " + doc.vigencia}</Etiqueta>
            <BotaoImprimir />
            {doc.pdf && <a className="btn-contorno px-4 py-2 text-sm" href={doc.pdf} download>Baixar PDF original</a>}
            {historico ? <Link href={`/termos/${doc.id}`} className="underline">Consultar versão vigente</Link>
              : anterior && <Link href={`/termos/${doc.id}?versao=${anterior}`} className="underline">Consultar versão {anterior}</Link>}
          </div>
        </CabecalhoPagina>
      </div>

      <main>
        <Conteudo estreito className="space-y-12 py-12 md:py-16 print:space-y-6 print:px-0 print:py-0">
          <header className="hidden space-y-2 print:block">
            <h1 className="text-2xl font-bold text-black">{doc.titulo}</h1>
            <p className="text-gray-700">{doc.resumo}</p>
            <p className="text-xs text-gray-600">Versão {doc.versao} · vigente desde {doc.vigencia} · {doc.paraQuem}</p>
          </header>

          {historico && <p className="text-sm">Modelo histórico. Os campos configuráveis usam as informações atuais da plataforma. Quando disponível, a cópia vinculada ao imóvel fica em <Link className="underline" href="/conta/termos">Termos e contratos aceitos</Link>.</p>}
          <article className="cartao space-y-10 p-6 sm:p-10 print:space-y-6 print:p-6">
            {arquivo ? arquivo.map((blocos, i) => (
              <section key={i} aria-label={`Página ${i+1}`} className="space-y-3 print:break-before-page">
                <h2 className="text-sm font-semibold text-verde">Página {i+1}</h2>
                {blocos.map((b,j) => typeof b === "string" ? <p key={j} className="leading-relaxed">{b}</p> : (
                  <div key={j} className="overflow-auto"><table className="w-full border-collapse text-left text-sm"><tbody>
                    {b.map((linha,k) => <tr key={k}>{linha.map((celula,l) => <td key={l} className="border border-linha p-2 align-top">{celula}</td>)}</tr>)}
                  </tbody></table></div>
                ))}
              </section>
            )) : doc.secoes.map((s, i) => (
              <section key={s.titulo} className="space-y-4">
                <h2 className="lp-display text-xl text-texto md:text-2xl print:text-lg print:text-black">
                  <span className="text-verde print:text-black">{i + 1}.</span> {s.titulo}
                </h2>
                <ol className="space-y-3">
                  {s.itens.map((item, j) => (
                    <li key={j} className="flex gap-3.5 text-base leading-relaxed text-texto-2 print:text-sm print:text-gray-800">
                      <span className="shrink-0 pt-px text-sm font-semibold tabular-nums text-texto print:text-black">{i + 1}.{j + 1}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </article>

          <section className="space-y-5 print:hidden">
            <h2 className="lp-display text-2xl text-texto">Outros documentos</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {outros.map((d) => (
                <Link key={d.id} href={`/termos/${d.id}`}
                  className="cartao cartao-link group flex items-center justify-between gap-3 px-5 py-4">
                  <span className="flex items-center gap-3 font-semibold text-texto transition group-hover:text-verde">
                    <ScrollText className="size-4 shrink-0 text-verde" /> {d.titulo}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-texto-2 transition group-hover:text-verde" />
                </Link>
              ))}
            </div>
          </section>
        </Conteudo>
      </main>
    </div>
  );
}
