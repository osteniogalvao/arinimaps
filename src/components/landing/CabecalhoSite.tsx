"use client";

/**
 * Cabeçalho do site institucional, no molde do site de referência:
 *  · barra fina de contato no topo (some ao rolar);
 *  · barra principal transparente sobre o hero, que vira sólida com blur ao
 *    rolar (`sobreHero`); nas outras páginas ela já nasce sólida e "grudada";
 *  · menu com a seção visível em destaque (na home);
 *  · Entrar + Anunciar imóvel; gaveta no celular; botão de tema.
 *
 * Enquanto transparente, o cabeçalho usa `.lp-escuro` (variáveis do tema
 * escuro) e a assinatura negativa, porque o fundo é sempre a foto/mapa escuro
 * do hero. Depois de rolar (ou fora da home) ele é chapado: off-white com a
 * assinatura positiva no tema claro, como nas pranchas do manual.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { ArrowRight, LogIn, Mail, Menu, MessageCircle, UserPlus, UserRound, X } from "lucide-react";
import { Logo } from "@/components/shell/AppShell";
import BotaoTema from "@/components/shell/BotaoTema";
import { formatarTelefone } from "./telefone";

export type ItemNav = { href: string; rotulo: string; secao?: string };

export const NAV_SITE: ItemNav[] = [
  { href: "/#ferramenta", rotulo: "Recursos", secao: "ferramenta" },
  { href: "/#consultas", rotulo: "Consultas", secao: "consultas" },
  { href: "/#imoveis", rotulo: "Imóveis", secao: "imoveis" },
  { href: "/planos", rotulo: "Planos" },
  { href: "/#sobre", rotulo: "A Arini", secao: "sobre" },
];

type Props = {
  sobreHero?: boolean;
  whatsapp?: string;
  email?: string;
  usuario?: { nome: string; href: string } | null;
};

export default function CabecalhoSite({ sobreHero = false, whatsapp, email, usuario }: Props) {
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  const [rolou, setRolou] = useState(false);
  const [secao, setSecao] = useState<string | null>(null);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setRolou(y > 40));

  // trava a rolagem da página com a gaveta aberta
  useEffect(() => {
    const html = document.documentElement;
    html.style.overflow = aberto ? "hidden" : "";
    return () => { html.style.overflow = ""; };
  }, [aberto]);

  // seção visível → item do menu em destaque (só na home)
  useEffect(() => {
    if (caminho !== "/" || !("IntersectionObserver" in window)) return;
    const alvos = NAV_SITE.flatMap((n) => (n.secao ? [document.getElementById(n.secao)] : [])).filter(
      (el): el is HTMLElement => !!el,
    );
    if (!alvos.length) return;
    const io = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        const id = e.target.id;
        if (e.isIntersecting) setSecao(id);
        else setSecao((s) => (s === id ? null : s));
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    alvos.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [caminho]);

  const transparente = sobreHero && !rolou && !aberto;
  const ativo = (n: ItemNav) =>
    n.secao ? caminho === "/" && secao === n.secao : caminho.startsWith(n.href);
  const fechar = () => setAberto(false);
  const wa = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, "")}` : null;

  return (
    <header className={`${sobreHero ? "fixed" : "sticky"} inset-x-0 top-0 z-50 ${transparente ? "lp-escuro" : ""}`}>
      {/* ---------- barra de contato ---------- */}
      {(wa || email) && (
        <motion.div
          initial={false}
          animate={{ height: rolou ? 0 : 40 }}
          transition={{ duration: 0.3 }}
          className={`hidden overflow-hidden text-sm md:block ${transparente ? "bg-black/35 text-white/85" : "lp-escuro bg-[#0A2219] text-white/85"}`}
        >
          <div className="lp-container flex h-10 items-center gap-6">
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 transition hover:text-white">
                <MessageCircle className="size-4 text-[#6FB08F]" /> WhatsApp da central · {formatarTelefone(whatsapp!)}
              </a>
            )}
            {email && (
              <a href={`mailto:${email}`} className="flex items-center gap-2 transition hover:text-white">
                <Mail className="size-4 text-[#6FB08F]" /> {email}
              </a>
            )}
            <span className="ml-auto text-white/60">Pontal do Triângulo Mineiro</span>
          </div>
        </motion.div>
      )}

      {/* ---------- barra principal ---------- */}
      <div
        className={`transition-[background-color,box-shadow,border-color] duration-300 ${
          transparente
            ? "border-b border-white/10 bg-transparent"
            : "border-b border-linha bg-fundo shadow-[0_6px_18px_-14px_rgba(10,34,25,.35)]"
        }`}
      >
        <div className="lp-container flex h-16 items-center gap-4 lg:h-20">
          <Link href="/" onClick={fechar} aria-label="Arini Imóveis Brasil — início" className="shrink-0">
            <Logo negativa={transparente} />
          </Link>

          <nav aria-label="Principal" className="ml-auto hidden lg:block">
            <ul className="flex items-center gap-1">
              {NAV_SITE.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={ativo(n) ? "true" : undefined}
                    className={`relative block px-3 py-2 text-[15px] font-semibold transition ${
                      ativo(n) ? "text-verde" : "text-texto-3 hover:text-texto"
                    }`}
                  >
                    {n.rotulo}
                    <span
                      className={`absolute inset-x-3 -bottom-0.5 h-0.5 origin-left rounded bg-[#D9BD6F] transition-transform duration-300 ${
                        ativo(n) ? "scale-x-100" : "scale-x-0"
                      }`}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-4">
            <BotaoTema compacto />
            <Link
              href={usuario?.href ?? "/entrar"}
              className="hidden items-center gap-2 rounded-full border-[1.5px] border-current px-4 py-2.5 text-[15px] font-semibold text-texto transition hover:border-verde hover:text-verde sm:inline-flex"
            >
              {usuario ? <UserRound className="size-4" /> : <LogIn className="size-4" />}{" "}
              {/* entre lg e xl o menu divide a linha com o "Cadastre-se": o rótulo do visitante cede */}
              <span className={usuario ? "" : "lg:sr-only xl:not-sr-only"}>{usuario?.nome ?? "Entrar"}</span>
            </Link>
            {/* Revisão do Carlos (29/10): "Cadastre-se" leva aos perfis dos planos */}
            {!usuario && (
              <Link href="/planos#perfis" className="lp-btn lp-btn-ouro hidden px-4 py-3 text-[15px] sm:inline-flex">
                <UserPlus className="size-4" /> Cadastre-se
              </Link>
            )}
            <Link href="/painel/novo" className="lp-btn lp-btn-verde hidden px-4 py-3 text-[15px] md:inline-flex">
              Anunciar imóvel
            </Link>
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full border border-linha-forte text-texto transition hover:border-verde lg:hidden"
              aria-label={aberto ? "Fechar menu" : "Abrir menu"}
              aria-expanded={aberto}
              onClick={() => setAberto((v) => !v)}
            >
              {aberto ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* ---------- gaveta (celular/tablet) ---------- */}
      <AnimatePresence>
        {aberto && (
          <motion.nav
            aria-label="Menu"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-full h-[calc(100dvh-100%)] overflow-y-auto overscroll-contain bg-fundo lg:hidden"
          >
            <ul className="lp-container divide-y divide-linha">
              {NAV_SITE.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={fechar}
                    className={`lp-display flex items-center justify-between py-4 text-3xl ${ativo(n) ? "text-verde" : "text-texto"}`}
                  >
                    {n.rotulo} <ArrowRight className="size-5 text-verde" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="lp-container space-y-3 pb-10 pt-6">
              {!usuario && (
                <Link href="/planos#perfis" onClick={fechar} className="lp-btn lp-btn-ouro w-full">
                  <UserPlus /> Cadastre-se
                </Link>
              )}
              <Link href="/painel/novo" onClick={fechar} className="lp-btn lp-btn-verde w-full">
                Anunciar imóvel <ArrowRight />
              </Link>
              <Link href={usuario?.href ?? "/entrar"} onClick={fechar} className="lp-btn lp-btn-contorno w-full">
                {usuario ? <UserRound /> : <LogIn />} {usuario?.nome ?? "Entrar"}
              </Link>
              <div className="space-y-3 pt-4 text-base text-texto-2">
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3">
                    <MessageCircle className="size-5 text-verde" /> {formatarTelefone(whatsapp!)}
                  </a>
                )}
                {email && (
                  <a href={`mailto:${email}`} className="flex items-center gap-3">
                    <Mail className="size-5 text-verde" /> {email}
                  </a>
                )}
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
