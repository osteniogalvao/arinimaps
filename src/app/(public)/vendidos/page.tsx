import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { BTN_ACAO } from "@/components/landing/Titulo";
import CartaoVendido, { LINK_ANUNCIE, TEXTO_ANUNCIE } from "@/components/vendidos/CartaoVendido";
import { listarVendidos, numerosVendas } from "@/lib/vendidos";
import { OG_NOME_SITE } from "@/lib/compartilhar";

export const dynamic = "force-dynamic";

const DESCRICAO = "Imóveis rurais e urbanos vendidos pela ARINI na região, com o tempo real até a venda. Quer vender o seu assim? Anuncie na ARINI.";

export const metadata: Metadata = {
  title: "Vendidos pela ARINI",
  description: DESCRICAO,
  alternates: { canonical: "/vendidos" },
  openGraph: {
    type: "website", siteName: OG_NOME_SITE, locale: "pt_BR", url: "/vendidos",
    title: "Vendidos pela ARINI", description: DESCRICAO,
    images: [{ url: "/og/vendidos", width: 1200, height: 630, alt: "Vendidos pela ARINI" }],
  },
  twitter: { card: "summary_large_image" },
};

/**
 * Página pública dos vendidos (sem login, sem sessão: abre rápido no
 * celular). Só dados reais, com um dia de atraso e sem nome, valor ou
 * localização exata (regras em src/lib/vendidos.ts).
 */
export default async function PaginaVendidos() {
  const [vendidos, nv] = await Promise.all([listarVendidos(60), numerosVendas()]);
  const resumo = [
    nv.vendidos > 0 && `${nv.vendidos.toLocaleString("pt-BR")} imóveis vendidos`,
    nv.mediaDias > 0 && `em média ${nv.mediaDias.toLocaleString("pt-BR")} dias até a venda`,
  ].filter(Boolean).join(", ");

  return (
    <Moldura usuario={null} site>
      <CabecalhoPagina
        variante="faixa"
        compacta
        eyebrow="Resultados reais"
        titulo="Vendidos pela"
        destaque="ARINI"
        subtitulo={resumo ? `${resumo[0].toUpperCase()}${resumo.slice(1)}.` : "Imóveis da região que encontraram comprador pela ARINI."}
        acoes={<Link href={LINK_ANUNCIE} className={BTN_ACAO}>Anunciar meu imóvel <ArrowRight /></Link>}
      />
      <Conteudo className="py-10 md:py-14">
        {vendidos.length > 0 ? (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {vendidos.map((v, k) => (
              <li key={v.id}><CartaoVendido v={v} prioridade={k < 2} /></li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-linha p-10 text-center text-lg text-texto-2">
            As vendas fechadas pela ARINI aparecem aqui. Enquanto isso,{" "}
            <Link href="/imoveis" className="font-semibold text-verde hover:underline">veja os imóveis à venda</Link>.
          </p>
        )}
        <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl bg-superficie p-6 ring-1 ring-linha sm:flex-row sm:items-center sm:justify-between md:p-8">
          <div>
            <p className="lp-display text-2xl text-texto md:text-3xl">{TEXTO_ANUNCIE}</p>
            <p className="mt-1 text-lg text-texto-2">Anuncie na ARINI: divisa no satélite, tour 3D e interessados qualificados pela nossa central.</p>
          </div>
          <Link href={LINK_ANUNCIE} className={BTN_ACAO}>Anuncie na ARINI <ArrowRight /></Link>
        </div>
        <p className="mt-6 text-sm text-texto-3">
          Para proteger compradores e vendedores, mostramos só o município e a área aproximada, sem nomes nem valores, e cada venda aparece aqui pelo menos um dia depois de fechada.
        </p>
      </Conteudo>
    </Moldura>
  );
}
