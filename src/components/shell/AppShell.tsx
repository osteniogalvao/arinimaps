"use client";

/**
 * Casca da aplicação, com a cara da página inicial:
 *  - desktop: sidebar fixa à esquerda (logo, navegação em Quicksand, atalhos
 *    e um convite em faixa escura) + topbar com busca, tema e avatar
 *  - mobile: conteúdo em tela cheia + barra inferior com botão de ação central
 *
 * Todas as telas do produto passam por aqui, então a navegação é a mesma
 * no desktop e no celular — muda só a forma.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight, Bell, Building2, ChevronRight, CreditCard, FileText, House,
  LayoutDashboard, Map as Mapa, Menu, Plus, Search, X,
} from "lucide-react";
import BotaoTema from "./BotaoTema";
import MarcaArini from "@/components/marca/MarcaArini";
import ChatIA, { abrirAssistente } from "@/components/ia/ChatIA";
import Avatar from "./Avatar";
import { usePreferencias } from "@/lib/usePreferencias";

/** avatar: foto do perfil (4.6); ausente = o cabeçalho busca na conta */
export type Usuario = { nome: string; papel: string; avatar?: string | null } | null;

type ItemMenu = { href: string; rotulo: string; icone: LucideIcon };

/**
 * "-19.73, -50.19", "-19,73 -50,19" ou "-19.73;-50.19" → [lat, lng]. Aceita
 * vírgula decimal (como se escreve no Brasil) quando o separador é espaço ou ";".
 */
export function lerCoordenada(texto: string): [number, number] | null {
  const t = texto.trim();
  const m = t.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/)
    ?? t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", ".")), lng = Number(m[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

const MENU: ItemMenu[] = [
  { href: "/", rotulo: "Início", icone: House },
  { href: "/mapa", rotulo: "Mapa Interativo", icone: Mapa },
  { href: "/imoveis", rotulo: "Buscar Imóveis", icone: Search },
  { href: "/relatorios", rotulo: "Relatórios", icone: FileText },
  { href: "/planos", rotulo: "Planos", icone: CreditCard },
  { href: "/painel", rotulo: "Meu Painel", icone: LayoutDashboard },
];

const ATALHOS = [
  { rotulo: "Consultar CAR", href: "/mapa?camada=car" },
  { rotulo: "Embargos Ambientais", href: "/mapa?camada=ibama_embargos" },
  { rotulo: "Focos de Queimadas", href: "/mapa?camada=inpe_queimadas" },
  { rotulo: "Processos Minerários", href: "/mapa?camada=anm" },
];

const NAV_MOBILE: ItemMenu[] = [
  { href: "/", rotulo: "Início", icone: House },
  { href: "/mapa", rotulo: "Mapas", icone: Mapa },
  { href: "/imoveis", rotulo: "Imóveis", icone: Building2 },
  { href: "/painel", rotulo: "Menu", icone: Menu },
];

/**
 * Marca (brandbook v1.0, out/2026): assinatura completa; no compacto, o
 * símbolo (o A com o radar). Altura escolhida para respeitar o mínimo do
 * manual: 120 px de largura na assinatura, 32 px no símbolo.
 */
export function Logo({ compacto = false, negativa = false }: {
  compacto?: boolean;
  /** sobre foto ou faixa escura em qualquer tema: letras em off-white */
  negativa?: boolean;
}) {
  const cor = negativa ? "text-[#F2F2EC]" : "text-marca";
  return compacto
    ? <MarcaArini variante="simbolo" className={`h-[46px] w-auto shrink-0 ${cor}`} />
    : <MarcaArini className={`h-[42px] w-auto shrink-0 ${cor}`} titulo="Arini Imóveis Brasil" />;
}

export default function AppShell({
  children, usuario, semPadding = false, busca = true, cheia = false,
}: {
  children: React.ReactNode;
  usuario?: Usuario;
  /** telas de mapa ocupam tudo; as demais recebem respiro */
  semPadding?: boolean;
  busca?: boolean;
  /**
   * Tela cheia (mapa): a moldura trava na altura da janela. Sem isso, um painel
   * comprido dentro do mapa (lista com dezenas de imóveis) esticava a página e
   * o mapa junto — o centro do mapa ia parar milhares de pixels abaixo da tela.
   */
  cheia?: boolean;
}) {
  const caminho = usePathname();
  const router = useRouter();
  const [menuAberto, setMenuAberto] = useState(false);

  // a busca do topo era só desenho: digitava e nada acontecia (QA 19/10/2026).
  // Coordenada → mapa no ponto (o mapa segue o #pos= da URL, inclusive já aberto);
  // o resto → busca de imóveis, que procura em título, código e município.
  function buscar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const termo = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    if (!termo) return;
    const ponto = lerCoordenada(termo);
    if (ponto) {
      const destino = `/mapa#pos=17/${ponto[0]}/${ponto[1]}`;
      if (caminho === "/mapa") window.location.hash = `pos=17/${ponto[0]}/${ponto[1]}`;
      else router.push(destino);
      return;
    }
    router.push(`/imoveis?q=${encodeURIComponent(termo)}`);
  }
  // a maioria das páginas não passa a foto: vem do mesmo pedido das preferências
  const { conta } = usePreferencias();
  const avatar = usuario?.avatar !== undefined ? usuario.avatar : conta?.avatar_url ?? null;
  const ativo = (href: string) => (href === "/" ? caminho === "/" : caminho.startsWith(href));

  return (
    <div className={`${cheia ? "h-dvh overflow-hidden" : "min-h-screen"} bg-fundo flex`}>
      {/* ---------- sidebar (desktop) ---------- */}
      <aside className={`lp-escuro lp-malha-escura hidden lg:flex w-64 shrink-0 flex-col ${cheia ? "overflow-y-auto" : ""}`}>
        <Link href="/" aria-label="Arini Imóveis Brasil — início" className="flex h-[4.5rem] items-center border-b border-linha-forte/60 px-6">
          <Logo negativa />
        </Link>

        <nav aria-label="Principal" className="space-y-1 px-3 pt-5">
          {MENU.map((m) => {
            const on = ativo(m.href);
            const Icone = m.icone;
            return (
              <Link key={m.href} href={m.href} aria-current={on ? "page" : undefined}
                className={
                  "relative flex items-center gap-3 rounded-full px-4 py-2.5 text-[15px] font-semibold transition " +
                  (on
                    ? "bg-texto/12 text-texto"
                    : "text-texto-3 hover:bg-texto/8 hover:text-texto")
                }>
                {on && <span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-ouro" aria-hidden />}
                <Icone className={"size-[18px] shrink-0 " + (on ? "text-ouro" : "")} />
                {m.rotulo}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pt-8">
          <p className="lp-eyebrow mb-2 px-3.5 !text-[11px]">Acesso rápido</p>
          <div className="space-y-0.5">
            {ATALHOS.map((a) => (
              <Link key={a.rotulo} href={a.href}
                className="group flex items-center justify-between rounded-full px-4 py-2 text-sm text-texto-2 transition hover:bg-texto/8 hover:text-texto">
                {a.rotulo}
                <ChevronRight className="size-4 text-texto-2/60 transition group-hover:text-ouro" />
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-auto p-4">
          <div className="relative overflow-hidden rounded-2xl border border-linha-forte/70 bg-fundo/40 p-5">
            <MarcaArini variante="radar" titulo=""
              className="pointer-events-none absolute right-3.5 top-3.5 w-7" />
            <p className="lp-eyebrow !text-[11px]">Arini</p>
            <p className="lp-display mt-3 text-xl leading-snug text-texto">
              Dados em <span className="text-ouro">boas decisões</span>
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-texto-2">Inteligência territorial para o seu negócio.</p>
            <Link href="/entrar" className="lp-btn lp-btn-ouro mt-4 !px-4 !py-2.5 text-sm">
              Saiba mais <ArrowRight />
            </Link>
          </div>
        </div>
      </aside>

      {/* ---------- coluna principal ---------- */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-linha bg-superficie px-4 lg:h-[4.5rem] lg:px-6">
          <button onClick={() => setMenuAberto(!menuAberto)} type="button"
            className="lg:hidden grid size-10 place-items-center rounded-full border border-linha-forte text-texto transition hover:border-verde"
            aria-label={menuAberto ? "Fechar menu" : "Abrir menu"} aria-expanded={menuAberto}>
            {menuAberto ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>

          <Link href="/" className="lg:hidden" aria-label="Início"><Logo compacto /></Link>

          {busca && (
            <form role="search" onSubmit={buscar} className="relative hidden max-w-xl flex-1 sm:block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-texto-2" aria-hidden />
              <input
                name="q"
                type="search"
                enterKeyHint="search"
                placeholder="Buscar imóvel, código, município ou coordenada"
                aria-label="Buscar imóvel, código, município ou coordenada"
                title="Ex.: AIB-000029, Iturama, -19.73, -50.19 — Enter para buscar"
                className="w-full rounded-full border border-linha-forte bg-superficie-2 py-2.5 pl-10 pr-4 text-[15px] text-texto placeholder:text-texto-2/70 transition focus:border-verde focus:outline-none focus:ring-2 focus:ring-verde/30"
              />
            </form>
          )}

          <nav aria-label="Atalhos" className="ml-2 hidden items-center gap-1 xl:flex">
            {MENU.slice(0, 4).map((m) => {
              const on = ativo(m.href);
              return (
                <Link key={m.href} href={m.href}
                  className={
                    "relative px-3 py-2 font-display text-[15px] font-semibold transition " +
                    (on ? "text-verde" : "text-texto-3 hover:text-texto")
                  }>
                  {m.rotulo.replace("Mapa Interativo", "Mapas").replace("Buscar Imóveis", "Imóveis")}
                  {on && <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded bg-verde" aria-hidden />}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <BotaoTema />
            <button type="button" onClick={abrirAssistente}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#124431] pl-1.5 pr-2 text-[#F2F2EC] ring-2 ring-[#D9BD6F]/60 transition hover:ring-[#D9BD6F] sm:pr-3.5"
              data-tour="ari" aria-label="Pergunte à Ari (assistente de IA)" title="Pergunte à Ari, a assistente de IA da Arini">
              <span className="grid size-7 place-items-center rounded-full bg-[#0B2A1E]" aria-hidden>
                <MarcaArini variante="radar" titulo="" className="size-4" />
              </span>
              <span className="hidden text-sm font-bold sm:inline">Pergunte à Ari</span>
            </button>
            <button type="button"
              className="relative grid size-10 place-items-center rounded-[10px] text-texto-2 transition hover:bg-superficie-2 hover:text-texto"
              aria-label="Notificações">
              <Bell className="size-[18px]" />
              <span className="absolute right-2 top-2 size-2 rounded-full bg-[#D9BD6F] ring-2 ring-superficie" />
            </button>
            {usuario ? (
              <Link href="/painel" className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-superficie-2">
                <Avatar nome={usuario.nome} url={avatar} tamanho={36} />
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-sm font-semibold text-texto">{usuario.nome.split(" ")[0]}</span>
                  <span className="block text-xs text-texto-2">{usuario.papel}</span>
                </span>
              </Link>
            ) : (
              <Link href="/entrar" className="lp-btn lp-btn-ouro !px-4 !py-2.5 text-sm">Entrar</Link>
            )}
          </div>
        </header>

        {/* menu mobile */}
        {menuAberto && (
          <nav aria-label="Menu" className="lg:hidden border-b border-linha bg-superficie px-3 py-3">
            {MENU.map((m) => {
              const on = ativo(m.href);
              const Icone = m.icone;
              return (
                <Link key={m.href} href={m.href} onClick={() => setMenuAberto(false)}
                  className={
                    "flex items-center gap-3 rounded-[10px] px-3.5 py-3 font-display text-base font-semibold " +
                    (on ? "bg-verde/12 text-verde" : "text-texto")
                  }>
                  <Icone className={"size-5 " + (on ? "" : "text-verde")} /> {m.rotulo}
                </Link>
              );
            })}
          </nav>
        )}

        <main className={"flex-1 min-h-0 flex flex-col pb-16 lg:pb-0 " + (semPadding ? "" : "p-4 lg:p-6")}>
          {children}
        </main>
      </div>

      {/* ---------- barra inferior (mobile) ---------- */}
      <nav aria-label="Navegação" className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex h-16 items-center justify-around border-t border-linha bg-superficie px-2">
        {NAV_MOBILE.slice(0, 2).map((m) => <ItemInferior key={m.href} item={m} ativo={ativo(m.href)} />)}

        {/* círculo: não usa .btn-verde porque o raio daquela classe venceria o rounded-full */}
        <Link href="/painel/novo"
          aria-label="Anunciar imóvel"
          className="-mt-7 grid size-14 shrink-0 place-items-center rounded-full border-4 border-superficie text-[#124431] shadow-xl"
          style={{ background: "#D9BD6F" }}>
          <Plus className="size-6" strokeWidth={2.5} />
        </Link>

        {NAV_MOBILE.slice(2).map((m) => <ItemInferior key={m.href} item={m} ativo={ativo(m.href)} />)}
      </nav>

      {/* assistente de IA (5.1): abre pelo botão do topo; inerte sem ANTHROPIC_API_KEY */}
      <ChatIA />
    </div>
  );
}

function ItemInferior({ item, ativo }: { item: ItemMenu; ativo: boolean }) {
  const Icone = item.icone;
  return (
    <Link href={item.href}
      className={"flex min-w-14 flex-col items-center gap-1 text-[11px] font-semibold " + (ativo ? "text-verde" : "text-texto-2")}>
      <Icone className="size-5" />{item.rotulo}
    </Link>
  );
}
