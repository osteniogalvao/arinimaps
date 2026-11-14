"use client";

/**
 * Casca da Central Arini (back-office), no mesmo design system do site:
 * sidebar com o logo, grupos por setor (recolhíveis) com ícones, estado
 * ativo em verde, topo com o nome da tela e gaveta no celular.
 *
 * Ferramenta de trabalho: nada de animação, só hover e transição de cor.
 * Separada de AppShell porque o menu, os grupos e o rodapé são outros —
 * mas os tokens, raios e estados de hover são exatamente os mesmos.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Kanban, Send, TrendingUp, Target, Clock, CalendarClock, Gauge, Search, LineChart, FileText, BookText, Truck, PieChart, ListTree,
  BarChart3, BookOpen, Building2, ChevronDown, ChevronRight, Circle, Crown, Database, ExternalLink, Filter, Grid3x3,
  FileUp, Flag, GitCompareArrows, Handshake, Headset, History, KeyRound, Landmark, Layers, LayoutDashboard,
  LayoutGrid, ListChecks, LogOut, Map as IconeMapa, Megaphone, Menu, Package, Percent, Receipt, Scale, SearchX,
  Settings, Shield, ShieldCheck, UserCheck, UserRound, Users, UsersRound, Wallet, X, Bot, Shuffle, Trophy,
} from "lucide-react";
import { Logo } from "@/components/shell/AppShell";
import BotaoTema from "@/components/shell/BotaoTema";
import Sino from "@/components/admin/Sino";
import { SETORES, type ItemMenu, type SetorId } from "@/lib/setores";
import Avatar from "@/components/shell/Avatar";
import { useNaoLidosSuporte } from "@/components/suporte/useNaoLidos";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Itens que todo membro da equipe tem, qualquer que seja o setor. */
const GERAL: ItemMenu[] = [
  { href: "/admin", rotulo: "Matriz", icone: "◈" },
  { href: "/admin/eu", rotulo: "Meu painel", icone: "☺" },
  { href: "/admin/tarefas", rotulo: "Tarefas", icone: "☑" },
  { href: "/admin/ponto", rotulo: "Meu ponto", icone: "◷" },
  { href: "/admin/crm", rotulo: "CRMs dos setores", icone: "⇉" },
];

/**
 * Ícone de cada tela. O registro de setores (lib/setores) guarda um glifo de
 * texto; aqui ele vira um ícone de verdade, pela rota.
 */
const ICONE_ITEM: Record<string, LucideIcon> = {
  "/admin": LayoutGrid,
  "/admin/tarefas": ListChecks,
  "/admin/eu": UserRound,
  "/admin/ponto": Clock,
  "/admin/crm": Kanban,
  "/admin/ponto/equipe": CalendarClock,
  "/admin/capacidade": Gauge,
  "/admin/busca": Search,
  "/admin/operacoes": LayoutDashboard,
  "/admin/imoveis": Building2,
  "/admin/cadastros": UserCheck,
  "/admin/comercial": LayoutDashboard,
  "/admin/funil": Filter,
  "/admin/empreendimentos": Grid3x3,
  "/admin/leads": Users,
  "/admin/rodizio": Shuffle,
  "/admin/ranking": Trophy,
  "/admin/automacoes": Bot,
  "/admin/demandas": SearchX,
  "/admin/organizacoes": Landmark,
  "/admin/financeiro": LayoutDashboard,
  "/admin/comissoes": Percent,
  "/admin/mensalidades": Receipt,
  "/admin/registros/despesas": Wallet,
  "/admin/registros/publicacoes": Send,
  "/admin/marketing/trafego": TrendingUp,
  "/admin/registros/campanhas": Target,
  "/admin/financeiro/resultado": LineChart,
  "/admin/registros/notas-fiscais": FileText,
  "/admin/registros/lancamentos": BookText,
  "/admin/registros/fornecedores": Truck,
  "/admin/registros/centros-custo": PieChart,
  "/admin/registros/plano-contas": ListTree,
  "/admin/juridico": LayoutDashboard,
  "/admin/juridico/lgpd": Shield,
  "/admin/marketing": LayoutDashboard,
  "/admin/conhecimento": BookOpen,
  "/admin/cartografia": IconeMapa,
  "/admin/cartografia/solicitacoes": Flag,
  "/admin/regioes": Layers,
  "/admin/car": FileUp,
  "/admin/fontes": Database,
  "/admin/suporte": Headset,
  "/admin/seguranca": ShieldCheck,
  "/admin/seguranca/revisao": GitCompareArrows,
  "/admin/auditoria": History,
  "/admin/relatorios": BarChart3,
  "/admin/usuarios": UsersRound,
  "/admin/planos": Package,
  "/admin/configuracoes": Settings,
};

/** Ícone do grupo (setor). */
const ICONE_SETOR: Record<SetorId | "geral", LucideIcon> = {
  geral: LayoutGrid,
  operacoes: Building2,
  comercial: Handshake,
  financeiro: Wallet,
  juridico: Scale,
  marketing: Megaphone,
  cartografia: IconeMapa,
  suporte: Headset,
  seguranca: ShieldCheck,
  diretoria: Crown,
};

type Grupo = { id: SetorId | "geral"; titulo: string; itens: ItemMenu[] };

const LINK_RODAPE =
  "flex flex-col items-center gap-1 rounded-2xl border border-linha-forte/70 px-2 py-2 text-texto-2 transition-colors hover:border-ouro hover:text-ouro";
const LINK_TOPO =
  "items-center gap-2 rounded-full border border-linha-forte px-4 py-2 text-sm font-semibold text-texto-2 transition-colors hover:border-verde hover:text-verde";

export default function AdminShell({
  children, userId, nome, papel, setores, avatar = null,
}: { children: React.ReactNode; userId: string; nome: string; papel: string; setores: SetorId[]; avatar?: string | null }) {
  const caminho = usePathname();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);

  // Sair da conta: registra no histórico de segurança (como em /conta/seguranca)
  // e encerra a sessão deste aparelho.
  async function sair() {
    setSaindo(true);
    await fetch("/api/auth/evento", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evento: "logout" }),
    }).catch(() => undefined);
    await supabaseBrowser().auth.signOut();
    router.push("/entrar");
    router.refresh();
  }
  // grupos recolhidos pela pessoa (o grupo da tela atual nunca some)
  const [recolhidos, setRecolhidos] = useState<Record<string, boolean>>({});
  // 10.2: selo de chamados esperando a equipe (só para quem atua no Suporte)
  const naoLidos = useNaoLidosSuporte(setores.includes("suporte"));
  const selo: Record<string, number> = { "/admin/suporte": naoLidos };
  // "/admin" só fica ativo na raiz; os demais casam por prefixo
  const ativo = (href: string) => (href === "/admin" ? caminho === "/admin" : caminho.startsWith(href));

  // o menu mostra só os setores do membro; a trava de verdade é no servidor
  const GRUPOS: Grupo[] = [
    { id: "geral", titulo: "Geral", itens: GERAL },
    ...SETORES.filter((st) => setores.includes(st.id)).map((st) => ({ id: st.id, titulo: st.nome, itens: st.itens })),
  ];
  // o item mais específico vence: "/admin/juridico/lgpd" não acende "/admin/juridico"
  const todos = GRUPOS.flatMap((g) => g.itens);
  const maisEspecifico = todos
    .filter((i) => ativo(i.href))
    .sort((x, y) => y.href.length - x.href.length)[0];
  const aceso = (href: string) => maisEspecifico?.href === href;
  const grupoAtual = GRUPOS.find((g) => g.itens.some((i) => i.href === maisEspecifico?.href));

  const titulo = maisEspecifico?.rotulo ?? "Central Arini";
  const TituloIcone = (maisEspecifico && ICONE_ITEM[maisEspecifico.href]) || LayoutGrid;

  const navegacao = (
    <div className="space-y-1">
      {GRUPOS.map((g) => {
        const temAtivo = g.id === grupoAtual?.id;
        const fechado = !!recolhidos[g.id] && !temAtivo;
        const IconeGrupo = ICONE_SETOR[g.id];
        const pendencias = g.itens.reduce((s, i) => s + (selo[i.href] ?? 0), 0);
        return (
          <div key={g.id} className="pb-1">
            <button type="button" aria-expanded={!fechado}
              onClick={() => setRecolhidos((r) => ({ ...r, [g.id]: !r[g.id] }))}
              className={"flex w-full items-center gap-2.5 rounded-lg px-3 pt-4 pb-1.5 text-left text-[11px] font-bold uppercase tracking-[0.22em] transition-colors " +
                (temAtivo ? "text-ouro" : "text-texto-2 hover:text-texto")}>
              <IconeGrupo className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">{g.titulo}</span>
              {fechado && pendencias > 0 && <span className="size-2 rounded-full bg-ouro" aria-label="Há pendências" />}
              {fechado ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {!fechado && (
              <div className="mt-0.5 space-y-0.5">
                {g.itens.map((i) => {
                  const Icone = ICONE_ITEM[i.href] ?? Circle;
                  const ligado = aceso(i.href);
                  return (
                    <Link key={g.id + i.href} href={i.href} onClick={() => setAberto(false)}
                      aria-current={ligado ? "page" : undefined}
                      className={
                        "relative flex items-center gap-3 rounded-full px-3.5 py-2 text-[0.92rem] transition-colors " +
                        (ligado
                          ? "bg-texto/12 text-texto font-semibold"
                          : "text-texto-2 font-medium hover:text-texto hover:bg-texto/8")
                      }>
                      {ligado && <span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-ouro" aria-hidden />}
                      <Icone className={"size-[18px] shrink-0 " + (ligado ? "text-ouro" : "")} />
                      <span className="truncate">{i.rotulo}</span>
                      {!!selo[i.href] && (
                        <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-ouro text-[#124431] text-[10px] font-bold grid place-items-center tabular-nums"
                          title="Chamados com mensagem nova do cliente">
                          {selo[i.href] > 99 ? "99+" : selo[i.href]}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const rodape = (
    <div className="border-t border-linha-forte/60 p-4">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar nome={nome} url={avatar} tamanho={38} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-texto truncate">{nome || "Equipe Arini"}</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ouro">{papel}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-[11px] font-semibold">
        <Link href="/conta" onClick={() => setAberto(false)} className={LINK_RODAPE} title="Minha conta">
          <UserRound className="size-4" /> Conta
        </Link>
        <Link href="/conta/seguranca" onClick={() => setAberto(false)} className={LINK_RODAPE} title="Minha segurança">
          <KeyRound className="size-4" /> Segurança
        </Link>
        <Link href="/" onClick={() => setAberto(false)} className={LINK_RODAPE} title="Ir para o site">
          <ExternalLink className="size-4" /> Site
        </Link>
      </div>
      <button type="button" onClick={sair} disabled={saindo}
        className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-2xl border border-linha-forte/70 px-2 py-2 text-[11px] font-semibold text-texto-2 transition-colors hover:border-ouro hover:text-ouro disabled:opacity-60">
        <LogOut className="size-4" /> {saindo ? "Saindo…" : "Sair da conta"}
      </button>
    </div>
  );

  const marca = (
    <Link href="/" className="flex w-full items-center gap-3 min-w-0">
      <Logo negativa />
      <span className="ml-auto rounded-full border border-ouro/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ouro">
        Central
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen bg-fundo flex">
      <aside className="lp-escuro lp-malha-escura hidden lg:flex w-[264px] shrink-0 flex-col sticky top-0 h-screen">
        <div className="px-5 h-[72px] flex items-center border-b border-linha-forte/60">{marca}</div>
        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Menu da Central" data-tour="menu-central">{navegacao}</nav>
        {rodape}
      </aside>

      {/* gaveta no celular */}
      {aberto && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setAberto(false)} />
          <aside className="lp-escuro lp-malha-escura relative w-[284px] max-w-[85vw] flex flex-col">
            <div className="px-5 h-16 flex items-center gap-2 border-b border-linha-forte/60">
              <div className="flex-1 min-w-0">{marca}</div>
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar menu"
                className="grid size-9 place-items-center rounded-lg text-texto-2 hover:text-texto hover:bg-texto/8 transition-colors">
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Menu da Central" data-tour="menu-central">{navegacao}</nav>
            {rodape}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 lg:h-[72px] shrink-0 border-b border-linha bg-superficie flex items-center gap-3 px-4 md:px-8">
          <button type="button" onClick={() => setAberto(true)} aria-label="Abrir menu"
            className="lg:hidden grid size-10 place-items-center rounded-lg text-texto-2 hover:text-texto hover:bg-superficie-2 transition-colors">
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <span className="hidden sm:grid size-10 shrink-0 place-items-center rounded-full border border-linha-forte text-verde">
              <TituloIcone className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-texto-2 min-w-0">
                <span className="shrink-0">Central Arini</span>
                {grupoAtual && grupoAtual.id !== "geral" && (
                  <><ChevronRight className="size-3 shrink-0" /><span className="text-ouro truncate">{grupoAtual.titulo}</span></>
                )}
              </p>
              <p className="lp-display text-xl md:text-2xl text-texto truncate">{titulo}</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <form action="/admin/busca" className="hidden md:block" role="search">
              <input name="q" placeholder="Buscar em tudo…" aria-label="Busca universal"
                className="w-44 rounded-full border border-linha-forte bg-superficie-2 px-4 py-2 text-sm text-texto placeholder:text-texto-2/70 focus:w-64 focus:border-verde focus:outline-none transition-all" />
            </form>
            <Link href="/admin/busca" aria-label="Buscar" className="md:hidden grid size-10 place-items-center rounded-full border border-linha-forte text-texto-2"><Search className="size-[18px]" /></Link>
            <Sino userId={userId} />
            <BotaoTema />
            <Link href="/mapa" title="Ver mapa público" className={"hidden md:inline-flex " + LINK_TOPO}>
              <IconeMapa className="size-4" /> Mapa
            </Link>
            <Link href="/" title="Ver site" className={"hidden sm:inline-flex " + LINK_TOPO}>
              <ExternalLink className="size-4" /> Ver site
            </Link>
            <Link href="/conta" aria-label="Minha conta" title="Minha conta" className="lg:hidden">
              {avatar ? <Avatar nome={nome} url={avatar} tamanho={36} /> : (
                <span className="w-9 h-9 rounded-full bg-[#124431] ring-1 ring-[#D9BD6F]/70 grid place-items-center text-xs font-bold text-[#F2F2EC]">
                  {(nome || "A").slice(0, 1).toUpperCase()}
                </span>
              )}
            </Link>
          </div>
        </header>
        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-[1280px] px-5 py-8 md:px-8 md:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
