import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, BadgeCheck, Box, Mail, MapPinned, MessageCircle, Phone, ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/shell/AppShell";
import { ItemNumerado, PilulaPonto, Supergrafico } from "@/components/ui/Pagina";
import { Reveal, Stagger } from "./movimento";
import { formatarTelefone } from "./telefone";

type Contato = { whatsapp?: string; email?: string; telefone?: string; site?: string };

const wa = (n: string, msg?: string) =>
  `https://wa.me/${n.replace(/\D/g, "")}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;

/**
 * Faixa de fechamento (prancha "Muito mais do que anunciar imóveis"): Verde
 * Profundo com linhas de mapa, o supergráfico do radar cortado à direita,
 * pílulas com ponto dourado e a chamada de venda em vermelho (o único uso do
 * vermelho na página, junto do CTA do cabeçalho).
 */
export function PreRodape({ contato }: { contato: Contato }) {
  const recursos = [
    { icone: MapPinned, titulo: "Localização em destaque", texto: "Apresente seu imóvel com uma visão territorial que valoriza sua localização." },
    { icone: Box, titulo: "Apresentação imersiva", texto: "Explore o imóvel por imagens, vídeos e experiências visuais." },
    { icone: ShieldCheck, titulo: "Atendimento Arini", texto: "Conte com uma equipe imobiliária para acompanhar o contato e a negociação." },
  ];
  return (
    <section className="lp-escuro relative" aria-label="Anuncie na Arini">
      <div className="bg-[#124431]">
        <div className="lp-container flex flex-col items-center justify-between gap-4 py-5 md:flex-row">
          {contato.whatsapp ? (
            <a href={wa(contato.whatsapp)} target="_blank" rel="noopener noreferrer" className="lp-display flex items-center gap-3 text-2xl text-white md:text-3xl">
              <MessageCircle className="size-6 text-ouro" /> {formatarTelefone(contato.whatsapp)}
            </a>
          ) : (
            <p className="lp-display text-2xl text-white md:text-3xl">Central Arini</p>
          )}
          <p className="text-center text-base font-medium text-white/85 md:text-left md:text-lg">Fale com a central: atendimento humano, sem robô.</p>
          <Link href="/suporte" className="lp-btn lp-btn-claro">
            Falar com a Arini <ArrowRight />
          </Link>
        </div>
      </div>

      <div className="fundo-curvas-escuro relative isolate overflow-hidden py-20 md:py-28">
        <Supergrafico className="opacity-40 lg:opacity-60" />
        <div className="lp-container relative grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <Reveal>
            <p className="lp-eyebrow">10 · Para proprietários e corretores</p>
            <h2 className="lp-display mt-4 text-[2.8rem] text-white md:text-[4.4rem]">
              Muito mais do que <span className="text-ouro">anunciar imóveis.</span>
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/80">
              Seu imóvel merece mais do que um anúncio. Na ARINI, ele ganha uma apresentação que conecta localização, informações territoriais e oportunidades, aproximando proprietários, corretores e interessados em uma experiência mais completa.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <PilulaPonto className="!text-white">Inteligência</PilulaPonto>
              <PilulaPonto className="!text-white">Segurança</PilulaPonto>
              <PilulaPonto className="!text-white">Transparência</PilulaPonto>
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/painel/novo" className="lp-btn lp-btn-verde">Anunciar imóvel <ArrowRight /></Link>
              <Link href="/planos" className="lp-btn lp-btn-claro">Ver planos</Link>
            </div>
          </Reveal>
          <Stagger className="grid gap-8 sm:grid-cols-3 lg:grid-cols-1 lg:gap-6" gap={0.12}>
            {recursos.map((r, k) => (
              <ItemNumerado key={r.titulo} numero={k + 1} titulo={r.titulo} className="bg-[#0A2219]/70 lg:pr-24">
                <span className="mb-2 block text-ouro"><r.icone className="size-5" strokeWidth={1.7} /></span>
                <span className="text-white/80">{r.texto}</span>
              </ItemNumerado>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  );
}

const COLUNAS: { titulo: string; links: { rotulo: string; href: string }[] }[] = [
  {
    titulo: "Plataforma",
    links: [
      { rotulo: "Mapa interativo", href: "/mapa" },
      { rotulo: "Buscar imóveis", href: "/imoveis" },
      { rotulo: "Relatórios territoriais", href: "/relatorios" },
      { rotulo: "Planos", href: "/planos" },
    ],
  },
  {
    titulo: "Para você",
    links: [
      { rotulo: "Anunciar imóvel", href: "/painel/novo" },
      { rotulo: "Entrar ou criar conta", href: "/entrar" },
      { rotulo: "Faça parte da Arini", href: "/expansao" },
      { rotulo: "Suporte", href: "/suporte" },
    ],
  },
  {
    titulo: "Institucional",
    links: [
      { rotulo: "A Arini", href: "/#sobre" },
      { rotulo: "Como funciona", href: "/#como-funciona" },
      { rotulo: "Termos de uso", href: "/termos" },
      { rotulo: "Privacidade e LGPD", href: "/termos/privacidade" },
    ],
  },
];

/** Rodapé completo (sempre Verde Profundo, com linhas de mapa e a assinatura negativa). */
export default function RodapeSite({ contato }: { marca?: string; contato: Contato }) {
  const ano = new Date().getFullYear();
  return (
    <footer className="lp-escuro fundo-curvas-escuro relative overflow-hidden text-white/80">
      <div className="lp-container relative grid gap-12 pb-10 pt-16 md:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1fr_1fr]">
        <div className="space-y-6">
          <Logo negativa />
          <p className="max-w-sm text-[17px] leading-relaxed">
            Conectando pessoas, imóveis e oportunidades por meio da tecnologia e do conhecimento imobiliário.
          </p>
          <ul className="space-y-3 text-base">
            {contato.whatsapp && (
              <li>
                <a href={wa(contato.whatsapp)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 transition hover:text-white">
                  <MessageCircle className="size-5 text-ouro" /> {formatarTelefone(contato.whatsapp)}
                </a>
              </li>
            )}
            {contato.telefone && (
              <li className="flex items-center gap-3"><Phone className="size-5 text-ouro" /> {contato.telefone}</li>
            )}
            {contato.email && (
              <li>
                <a href={`mailto:${contato.email}`} className="flex items-center gap-3 transition hover:text-white">
                  <Mail className="size-5 text-ouro" /> {contato.email}
                </a>
              </li>
            )}
            <li className="flex items-center gap-3"><BadgeCheck className="size-5 text-ouro" /> Iturama · MG</li>
          </ul>
        </div>

        {COLUNAS.map((c) => (
          <div key={c.titulo}>
            <p className="lp-eyebrow mb-5">{c.titulo}</p>
            <ul className="space-y-3 text-base">
              {c.links.map((l) => (
                <li key={l.rotulo}>
                  <Link href={l.href} className="group inline-flex items-center gap-1.5 transition hover:text-ouro">
                    {l.rotulo}
                    <ArrowUpRight className="size-4 opacity-0 transition group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
              {c.titulo === "Institucional" && contato.site && (
                <li>
                  <a href={contato.site} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1.5 transition hover:text-ouro">
                    Site da imobiliária <ArrowUpRight className="size-4" />
                  </a>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="lp-container relative pb-8">
        <div className="rodape-prancha !text-[0.8rem] !text-white/65 max-md:flex-col">
          <p>Arini · © {ano} Arini Negócios Imobiliários. Todos os direitos reservados.</p>
          <p>
            Dados pessoais tratados conforme a LGPD ·{" "}
            <Link href="/termos" className="underline-offset-4 hover:text-white hover:underline">Termos e privacidade</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
