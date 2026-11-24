import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, MapPin, Ruler } from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { Conteudo } from "@/components/ui/Pagina";
import { BTN_ACAO } from "@/components/landing/Titulo";
import CartaoVendido, { fotoDoVendido, LINK_ANUNCIE, TEXTO_ANUNCIE } from "@/components/vendidos/CartaoVendido";
import { listarVendidos, ondeTexto, rotuloTipo, textoDias, vendidoPorId } from "@/lib/vendidos";
import { linkWhatsApp, OG_NOME_SITE, urlDoSite } from "@/lib/compartilhar";

export const dynamic = "force-dynamic";

function titulo(v: NonNullable<Awaited<ReturnType<typeof vendidoPorId>>>, minusculo = false) {
  const onde = ondeTexto(v);
  const tipo = minusculo ? rotuloTipo(v).toLowerCase() : rotuloTipo(v);
  return `${tipo}${onde ? ` em ${onde}` : ""}`;
}

export async function generateMetadata({ params }: PageProps<"/vendidos/[id]">): Promise<Metadata> {
  const { id } = await params;
  const v = await vendidoPorId(id);
  if (!v) return { title: "Vendido não encontrado", robots: { index: false } };
  const t = `${textoDias(v.dias)}: ${titulo(v, true)}`;
  const desc = `${titulo(v)}${v.area ? `, ${v.area}` : ""}. Quer vender seu imóvel assim? Anuncie na ARINI.`;
  return {
    title: t,
    description: desc,
    alternates: { canonical: `/vendidos/${v.id}` },
    openGraph: {
      type: "website", siteName: OG_NOME_SITE, locale: "pt_BR", url: `/vendidos/${v.id}`,
      title: `${textoDias(v.dias)} · ${OG_NOME_SITE}`, description: desc,
      images: [{ url: `/og/vendidos/${v.id}`, width: 1200, height: 630, alt: titulo(v) }],
    },
    twitter: { card: "summary_large_image" },
  };
}

/** Página própria de um vendido: o link que se manda no WhatsApp. */
export default async function PaginaVendido({ params }: PageProps<"/vendidos/[id]">) {
  const { id } = await params;
  const [v, outros] = await Promise.all([vendidoPorId(id), listarVendidos(4)]);
  if (!v) notFound();
  const onde = ondeTexto(v);
  const mais = outros.filter((o) => o.id !== v.id).slice(0, 3);
  const url = `${urlDoSite()}/vendidos/${v.id}`;
  const msg = `${textoDias(v.dias)}: ${titulo(v, true)}, pela ARINI. ${url}`;

  return (
    <Moldura usuario={null} site>
      <Conteudo className="py-8 md:py-12">
        <Link href="/vendidos" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-verde hover:underline">
          <ArrowLeft className="size-4" /> Todos os vendidos
        </Link>
        <article className="mt-5 grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-superficie-2 ring-1 ring-linha">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fotoDoVendido(v)} alt="" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-[#D9BD6F] px-3.5 py-1.5 text-sm font-bold uppercase tracking-[0.12em] text-[#124431]">
              <BadgeCheck className="size-4" aria-hidden="true" /> Vendido
            </span>
          </div>
          <div>
            <p className="lp-eyebrow">Vendido pela ARINI</p>
            <h1 className="lp-display mt-3 text-4xl text-texto md:text-5xl">{textoDias(v.dias)}</h1>
            <p className="mt-4 text-xl font-semibold text-texto">{rotuloTipo(v)}</p>
            <ul className="mt-3 space-y-2 text-lg text-texto-2">
              {onde && <li className="flex items-center gap-2"><MapPin className="size-5 text-verde" aria-hidden="true" /> {onde}</li>}
              {v.area && <li className="flex items-center gap-2"><Ruler className="size-5 text-verde" aria-hidden="true" /> {v.area}</li>}
              <li className="flex items-center gap-2"><CalendarDays className="size-5 text-verde" aria-hidden="true" /> Venda em {v.mes}</li>
            </ul>
            <div className="mt-8 rounded-2xl bg-superficie p-6 ring-1 ring-linha">
              <p className="lp-display text-2xl text-texto">{TEXTO_ANUNCIE}</p>
              <p className="mt-1 text-base text-texto-2">Anuncie na ARINI e receba interessados qualificados pela nossa central.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href={LINK_ANUNCIE} className={BTN_ACAO}>Anuncie na ARINI <ArrowRight /></Link>
                <a href={linkWhatsApp(msg)} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-contorno">
                  Enviar pelo WhatsApp
                </a>
              </div>
            </div>
          </div>
        </article>

        {mais.length > 0 && (
          <section aria-labelledby="titulo-mais" className="mt-16">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <h2 id="titulo-mais" className="lp-display text-3xl text-texto">Outros vendidos</h2>
              <Link href="/vendidos" className="inline-flex items-center gap-1.5 font-semibold text-verde hover:underline">
                Ver todos os vendidos <ArrowRight className="size-4" />
              </Link>
            </div>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {mais.map((o) => <li key={o.id}><CartaoVendido v={o} /></li>)}
            </ul>
          </section>
        )}
        <p className="mt-10 text-sm text-texto-3">
          Para proteger compradores e vendedores, mostramos só o município e a área aproximada, sem nomes nem valores, e cada venda aparece pelo menos um dia depois de fechada.
        </p>
      </Conteudo>
    </Moldura>
  );
}
