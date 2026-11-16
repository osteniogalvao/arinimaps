/**
 * Tela dividida das portas do sistema (entrar, criar senha, acesso restrito):
 * à esquerda, faixa escura em malha sobre a foto de satélite, com a marca e
 * três benefícios; à direita, o formulário. No celular a faixa vira um topo
 * curto e o formulário vem logo abaixo.
 *
 * Sem "use client": serve em página do servidor e em página cliente.
 */
import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, BadgeCheck, MapPinned, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/shell/AppShell";
import MarcaArini from "@/components/marca/MarcaArini";
import BotaoTema from "@/components/shell/BotaoTema";

export type Beneficio = { icone: LucideIcon; titulo: string; texto: string };

export const BENEFICIOS_PADRAO: Beneficio[] = [
  { icone: MapPinned, titulo: "Divisa no satélite", texto: "Cada imóvel com o polígono real e a área medida no mapa." },
  { icone: ShieldCheck, titulo: "Fontes oficiais", texto: "CAR, embargos, queimadas e mineração cruzados com a área." },
  { icone: BadgeCheck, titulo: "Central Arini", texto: "Nenhum anúncio vai ao ar sem conferência da equipe." },
];

export default function TelaDividida({
  eyebrow = "Inteligência territorial",
  titulo = "Imóveis com a divisa",
  destaque = "no mapa",
  subtitulo = "Encontre, consulte e anuncie com a área conferida e os dados oficiais da região.",
  beneficios = BENEFICIOS_PADRAO,
  linkSite = true,
  children,
}: {
  eyebrow?: string;
  titulo?: string;
  destaque?: string;
  subtitulo?: string;
  beneficios?: Beneficio[];
  /** a porta do site em testes não tem para onde voltar */
  linkSite?: boolean;
  children: React.ReactNode;
}) {
  const marca = linkSite
    ? <Link href="/" aria-label="ARINI — início"><Logo negativa /></Link>
    : <Logo negativa />;

  return (
    <div className="min-h-screen bg-fundo lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------- faixa da marca ---------- */}
      <aside className="lp-escuro relative isolate overflow-hidden bg-[#0A2219]">
        <Image src="/img/aerea-campo.jpg" alt="" fill priority sizes="(min-width: 1024px) 50vw, 100vw"
          className="-z-20 object-cover opacity-35" />
        <div className="lp-malha-escura absolute inset-0 -z-10 opacity-85" aria-hidden />
        <div className="lp-grade pointer-events-none absolute inset-0 -z-10 opacity-60" aria-hidden />

        <div className="relative flex h-full flex-col px-5 py-6 md:px-8 lg:min-h-screen lg:px-14 lg:py-12">
          <MarcaArini variante="radar" titulo=""
            className="pointer-events-none absolute right-5 top-6 hidden w-9 lg:right-14 lg:top-12 lg:block" />
          <div className="flex items-center justify-between gap-3">
            {marca}
            <span className="lg:hidden"><BotaoTema compacto /></span>
          </div>

          <div className="hidden max-w-lg flex-1 flex-col justify-center py-12 lg:flex">
            <p className="lp-eyebrow">{eyebrow}</p>
            <h2 className="lp-display mt-4 text-balance text-[2.75rem] text-texto xl:text-[3.25rem]">
              {titulo} <span className="text-ouro">{destaque}</span>
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-texto-2">{subtitulo}</p>

            <ul className="mt-10 space-y-6">
              {beneficios.map(({ icone: Icone, titulo: t, texto }, i) => (
                <li key={t} className="item-numerado">
                  <span className="numero flex items-center gap-2">
                    {String(i + 1).padStart(2, "0")} <Icone className="size-3.5" aria-hidden />
                  </span>
                  <span className="lp-display mt-1.5 block text-2xl text-texto">{t}</span>
                  <span className="mt-1 block text-[15px] leading-relaxed text-texto-2">{texto}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="hidden text-sm text-texto-2 lg:block">ARINI · Pontal do Triângulo Mineiro</p>
        </div>
      </aside>

      {/* ---------- formulário ---------- */}
      <div className="flex min-h-[calc(100vh-5.5rem)] flex-col lg:min-h-screen">
        <div className="flex items-center justify-between gap-3 px-5 pt-6 md:px-8 lg:px-12">
          {linkSite ? (
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-texto-2 transition hover:text-verde">
              <ArrowLeft className="size-4" /> Voltar ao site
            </Link>
          ) : <span />}
          <span className="hidden lg:block"><BotaoTema compacto /></span>
        </div>
        <main className="flex flex-1 items-center justify-center px-5 py-10 md:px-8 lg:px-12">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
