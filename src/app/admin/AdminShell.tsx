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
  Bell, Kanban, CodeXml, Send, TrendingUp, Target, Clock, CalendarClock, Gauge, Search, LineChart, FileText, BookText, Truck, PieChart, ListTree,
  BarChart3, BookOpen, Building2, ChevronDown, ChevronRight, Circle, Crown, Database, ExternalLink, Filter, Grid3x3,
  FileUp, Flag, GitCompareArrows, Handshake, Headset, History, KeyRound, Landmark, Layers, LayoutDashboard,
  LayoutGrid, ListChecks, LogOut, Map as IconeMapa, Megaphone, Menu, Package, Percent, Receipt, Scale, SearchX,
  Settings, Shield, ShieldCheck, UserCheck, UserRound, Users, UsersRound, Wallet, X, Bot, Shuffle, Trophy,
  CalendarDays, Contact, Settings2, MessagesSquare, MessageCircle, ListOrdered, Banknote, KeySquare, Workflow,
} from "lucide-react";
import { Logo } from "@/components/shell/AppShell";
import BotaoTema from "@/components/shell/BotaoTema";
import Sino from "@/components/admin/Sino";
import { SETORES, type ItemMenu, type Setor, type SetorId } from "@/lib/setores";
import Avatar from "@/components/shell/Avatar";
import { useNaoLidosSuporte } from "@/components/suporte/useNaoLidos";
import { supabaseBrowser } from "@/lib/supabase/client";
import { menuCrm, TELAS_CRM, type Painel } from "@/lib/paineis";
import { ArrowLeftRight } from "lucide-react";

/**
 * "Meu dia": o que todo membro da equipe usa todo dia, qualquer que seja o
 * setor. Curto de propósito (áudio do Carlos, 24/11/2026: "muito carregado,
 * muito sortido"). Os setores aparecem abaixo, uma linha cada; as telas de
 * cada setor viram abas no topo da página do setor.
 */
const GERAL: ItemMenu[] = [
  { href: "/admin", rotulo: "Início", icone: "◈" },
  { href: "/admin/atendimento", rotulo: "Atendimento", icone: "✉" },
  { href: "/admin/agenda-setores", rotulo: "Agenda compartilhada", icone: "◷" },
  { href: "/admin/tarefas", rotulo: "Tarefas", icone: "☑" },
  { href: "/admin/chat", rotulo: "Chat da equipe", icone: "✆" },
];

/** Atalhos de uso menos frequente: ficam recolhidos em "Mais". */
const GERAL_MAIS: ItemMenu[] = [
  { href: "/admin/eu", rotulo: "Meu painel", icone: "☺" },
  { href: "/admin/notificacoes", rotulo: "Notificações", icone: "◉" },
  { href: "/admin/ponto", rotulo: "Meu ponto", icone: "◷" },
  { href: "/admin/crm", rotulo: "Todos os funis", icone: "⇉" },
  { href: "/admin/equipe", rotulo: "Equipe e funções", icone: "☺" },
];

/** Telas do setor na ordem de uso: as do dia a dia primeiro. */
const ordemDoDia = (st: Setor) => {
  const pos = (h: string) => (st.principais.includes(h) ? st.principais.indexOf(h) : 99);
  return [...st.itens].sort((a, b) => pos(a.href) - pos(b.href));
};

/** Página de entrada (mesa) de cada setor. */
const mesaDoSetor = (id: SetorId) => `/admin/setor/${id}`;
/** Equipe do setor (o grupo de cada setor; áudio do Carlos, 26/11/2026 22h02). */
const equipeDoSetor = (id: SetorId) => `/admin/setor/${id}/equipe`;

/**
 * Telas do setor no menu, como no CRM da Arini Negócios: o painel primeiro,
 * as telas do dia a dia e, no fim, a equipe do setor.
 */
const telasDoSetor = (st: Setor): ItemMenu[] => [
  { href: mesaDoSetor(st.id), rotulo: "Painel do setor", icone: st.icone },
  ...ordemDoDia(st),
  ...(st.id === "diretoria" ? [] : [{ href: equipeDoSetor(st.id), rotulo: "Equipe do setor", icone: "☺" }]),
];

/**
 * Ícone de cada tela. O registro de setores (lib/setores) guarda um glifo de
 * texto; aqui ele vira um ícone de verdade, pela rota.
 */
const ICONE_ITEM: Record<string, LucideIcon> = {
  "/admin": LayoutGrid,
  "/admin/tarefas": ListChecks,
  "/admin/atendimento": MessagesSquare,
  "/admin/chat": MessageCircle,
  "/admin/atendimento/configurar": ListOrdered,
  "/admin/eu": UserRound,
  "/admin/notificacoes": Bell,
  "/admin/ponto": Clock,
  "/admin/crm": Kanban,
  "/admin/agenda-setores": CalendarDays,
  "/admin/equipe": Contact,
  "/admin/ponto/equipe": CalendarClock,
  "/admin/capacidade": Gauge,
  "/admin/busca": Search,
  "/admin/operacoes": LayoutDashboard,
  "/admin/imoveis": Building2,
  "/admin/cadastros": UserCheck,
  "/admin/proprietarios": KeySquare,
  "/admin/consulta-imoveis": Search,
  "/admin/aprovacoes": ListChecks,
  "/admin/comercial": LayoutDashboard,
  "/admin/funil": Filter,
  "/admin/empreendimentos": Grid3x3,
  "/admin/leads": Users,
  "/admin/rodizio": Shuffle,
  "/admin/agenda": CalendarDays,
  "/admin/clientes": Contact,
  "/admin/corretores": Target,
  "/admin/comercial/relatorios": BarChart3,
  "/admin/comercial/configurar": Settings2,
  "/admin/ranking": Trophy,
  "/admin/automacoes": Bot,
  "/admin/demandas": SearchX,
  "/admin/organizacoes": Landmark,
  "/admin/financeiro": LayoutDashboard,
  "/admin/comissoes": Percent,
  "/admin/financeiro/caixa": Banknote,
  "/admin/financeiro/alugueis": KeySquare,
  "/admin/registros/contratos-locacao": KeySquare,
  "/admin/marketing/fluxo": Workflow,
  "/admin/mensalidades": Receipt,
  "/admin/registros/despesas": Wallet,
  "/admin/registros/publicacoes": Send,
  "/admin/marketing/trafego": TrendingUp,
  "/admin/marketing/tags": CodeXml,
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
  "/admin/painel-crm": LayoutGrid,
};

/** Ícone do grupo (setor). */
const ICONE_SETOR: Record<SetorId | "geral", LucideIcon> = {
  geral: LayoutGrid,
  operacoes: Building2,
  comercial: Handshake,
  financeiro: Wallet,
  juridico: Scale,
  marketing: Megaphone,
  marketing_trafego: Megaphone,
  cartografia: IconeMapa,
  suporte: Headset,
  seguranca: ShieldCheck,
  diretoria: Crown,
};

type Grupo = { id: SetorId | "geral"; titulo: string; itens: ItemMenu[] };

const LINK_RODAPE =
  "flex flex-col items-center gap-1 rounded-2xl border border-linha-forte/70 px-2 py-2 text-texto-2 transition-colors hover:border-ouro hover:text-ouro";
const LINK_TOPO =
  "btn-contorno items-center gap-2 px-4 py-2 text-sm";

export default function AdminShell({
  children, userId, nome, papel, setores, avatar = null, painel = null,
}: {
  children: React.ReactNode; userId: string; nome: string; papel: string; setores: SetorId[]; avatar?: string | null;
  /** painel escolhido ao entrar: "crm" mostra o menu do CRM; "sistema" (ou nada), o resto da Central */
  painel?: Painel | null;
}) {
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
  // "Mais" do menu geral fica fechado até a pessoa abrir (ou estar numa dessas telas)
  const [maisAberto, setMaisAberto] = useState(false);
  // setores abertos à mão no menu (o setor da tela atual já vem aberto)
  const [abertosMao, setAbertosMao] = useState<Record<string, boolean>>({});
  // 10.2: selo de chamados esperando a equipe (só para quem atua no Suporte)
  const naoLidos = useNaoLidosSuporte(setores.includes("suporte"));
  const selo: Record<string, number> = { "/admin/suporte": naoLidos };
  // "/admin" só fica ativo na raiz; os demais casam por prefixo
  const ativo = (href: string) => (href === "/admin" ? caminho === "/admin" : caminho === href || caminho.startsWith(href + "/"));

  // o menu mostra só os setores do membro; a trava de verdade é no servidor
  const noCrm = painel === "crm";
  // Sistema completo: as telas do CRM saem do menu (moram no painel do CRM);
  // setor que fica sem nenhuma tela além do painel e da equipe some do menu
  const semCrm = (itens: ItemMenu[]) => itens.filter((i) => !TELAS_CRM.has(i.href));
  const telasSistema = (st: Setor) => telasDoSetor(st).filter((i) => !TELAS_CRM.has(i.href));
  const meusSetores = SETORES.filter((st) => setores.includes(st.id))
    .filter((st) => semCrm(st.itens).length > 0);
  const menuDoCrm: ItemMenu[] = [
    ...menuCrm(setores).map((i) => ({ href: i.href, rotulo: i.rotulo, icone: "" })),
    // gestor de setor: a equipe do setor no lugar de "Usuários" (que é da Diretoria)
    ...(setores.includes("diretoria") ? [] : setores.slice(0, 1).map((id) => ({ href: equipeDoSetor(id), rotulo: "Equipe do setor", icone: "" }))),
  ];
  const GRUPOS: Grupo[] = noCrm
    ? [{ id: "geral", titulo: "CRM Arini Brasil", itens: menuDoCrm }]
    : [
      { id: "geral", titulo: "Meu dia", itens: semCrm([...GERAL, ...GERAL_MAIS]) },
      ...meusSetores.map((st) => ({ id: st.id, titulo: st.nome, itens: telasSistema(st) })),
    ];
  // o item mais específico vence: "/admin/juridico/lgpd" não acende "/admin/juridico"
  const todos = GRUPOS.flatMap((g) => g.itens);
  const maisEspecifico = todos
    .filter((i) => ativo(i.href))
    .sort((x, y) => y.href.length - x.href.length)[0];
  const aceso = (href: string) => maisEspecifico?.href === href;
  // setor da tela atual: o primeiro setor do membro que tem a tela (telas
  // compartilhadas, como Tags e pixels, ficam no primeiro da lista)
  const grupoAtual = GRUPOS.find((g) => g.itens.some((i) => i.href === maisEspecifico?.href));
  const setorAtual = grupoAtual && grupoAtual.id !== "geral" ? meusSetores.find((st) => st.id === grupoAtual.id) ?? null : null;

  const titulo = maisEspecifico?.rotulo ?? "Central Arini";
  const TituloIcone = (maisEspecifico && (ICONE_ITEM[maisEspecifico.href] ?? (setorAtual && aceso(mesaDoSetor(setorAtual.id)) ? ICONE_SETOR[setorAtual.id] : undefined))) || LayoutGrid;
  // Menu como no CRM da Arini Negócios: as telas do setor ficam direto no
  // menu lateral, sem abas no topo nem "Mais" (áudio do Carlos, 25/11/2026:
  // "tá muito bagunçada a visualização, o modo operacional").
  const setorAberto = (id: SetorId) =>
    abertosMao[id] ?? (meusSetores.length === 1 || setorAtual?.id === id);
  const alternarSetor = (id: SetorId) => setAbertosMao((m) => ({ ...m, [id]: !setorAberto(id) }));
  const mostrarMais = maisAberto || GERAL_MAIS.some((i) => aceso(i.href));

  const iconeDe = (href: string, id: SetorId): LucideIcon =>
    ICONE_ITEM[href] ?? (href === mesaDoSetor(id) ? LayoutGrid : href === equipeDoSetor(id) ? UsersRound : Circle);

  const linkMenu = (i: ItemMenu, chave: string, Icone: LucideIcon, ligado: boolean, contagem = 0) => (
    <Link key={chave} href={i.href} onClick={() => setAberto(false)}
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
      {contagem > 0 && (
        <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-ouro text-[#124431] text-[10px] font-bold grid place-items-center tabular-nums"
          title="Chamados com mensagem nova do cliente">
          {contagem > 99 ? "99+" : contagem}
        </span>
      )}
    </Link>
  );
  const tituloBloco = (texto: string) => (
    <p className="px-3 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-texto-2">{texto}</p>
  );

  // botão para voltar à escolha entre o CRM e o sistema completo
  const trocarPainel = (
    <Link href="/admin/escolher" onClick={() => setAberto(false)}
      className="mb-2 flex items-center gap-2 rounded-2xl border border-ouro/50 px-3.5 py-2 text-[0.85rem] font-semibold text-ouro transition-colors hover:bg-ouro/10">
      <ArrowLeftRight className="size-4 shrink-0" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate">{noCrm ? "CRM Arini Brasil" : "Sistema completo"}</span>
        <span className="block text-[11px] font-medium text-texto-2">Trocar painel</span>
      </span>
    </Link>
  );

  // no menu do CRM cada tela tem o seu ícone (no sistema, "Indicadores" de cada setor usa o mesmo)
  const ICONE_CRM: Record<string, LucideIcon> = {
    "/admin/juridico": Scale, "/admin/financeiro": Wallet, "/admin/financeiro/alugueis": Landmark,
    "/admin/marketing/fluxo": Megaphone, "/admin/consulta-imoveis": Search,
    "/admin/financeiro/imovel": Receipt, "/admin/movimentacoes": History,
  };
  // Menu do CRM: lista curta e plana, como no CRM da Arini Negócios
  const navegacaoCrm = (
    <div className="space-y-0.5">
      {trocarPainel}
      {menuDoCrm.map((i) => linkMenu(i, "c" + i.href, ICONE_CRM[i.href] ?? ICONE_ITEM[i.href] ?? (i.rotulo === "Equipe do setor" ? UsersRound : Circle), aceso(i.href)))}
    </div>
  );

  const navegacaoSistema = (
    <div className="space-y-1">
      {trocarPainel}
      {tituloBloco("Meu dia")}
      <div className="space-y-0.5">
        {semCrm(GERAL).map((i) => linkMenu(i, "g" + i.href, ICONE_ITEM[i.href] ?? Circle, aceso(i.href)))}
        <button type="button" aria-expanded={mostrarMais} onClick={() => setMaisAberto((v) => !v)}
          className="flex w-full items-center gap-3 rounded-full px-3.5 py-2 text-left text-[0.92rem] font-medium text-texto-2 transition-colors hover:bg-texto/8 hover:text-texto">
          {mostrarMais ? <ChevronDown className="size-[18px] shrink-0" /> : <ChevronRight className="size-[18px] shrink-0" />}
          <span>{mostrarMais ? "Menos" : "Mais"}</span>
        </button>
        {mostrarMais && semCrm(GERAL_MAIS).map((i) => linkMenu(i, "m" + i.href, ICONE_ITEM[i.href] ?? Circle, aceso(i.href)))}
      </div>
      {/* um setor só: lista simples das telas, como no CRM da Arini Negócios */}
      {meusSetores.length === 1 && (<>
        {tituloBloco(meusSetores[0].nome)}
        <div className="space-y-0.5">
          {telasSistema(meusSetores[0]).map((i) =>
            linkMenu(i, "u" + i.href, iconeDe(i.href, meusSetores[0].id), aceso(i.href), selo[i.href] ?? 0))}
        </div>
      </>)}
      {meusSetores.length > 1 && tituloBloco("Setores")}
      <div className="space-y-0.5">
        {meusSetores.length > 1 && meusSetores.map((st) => {
          const contagem = st.itens.reduce((n, i) => n + (selo[i.href] ?? 0), 0);
          const Icone = ICONE_SETOR[st.id];
          const expandido = setorAberto(st.id);
          const doSetor = setorAtual?.id === st.id;
          return (
            <div key={"s" + st.id}>
              <button type="button" aria-expanded={expandido} onClick={() => alternarSetor(st.id)}
                className={
                  "relative flex w-full items-center gap-3 rounded-full px-3.5 py-2 text-left text-[0.92rem] transition-colors " +
                  (doSetor ? "text-texto font-semibold" : "text-texto-2 font-medium hover:text-texto hover:bg-texto/8")
                }>
                <Icone className={"size-[18px] shrink-0 " + (doSetor ? "text-ouro" : "")} />
                <span className="truncate">{st.nome}</span>
                {contagem > 0 && !expandido && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-ouro text-[#124431] text-[10px] font-bold grid place-items-center tabular-nums">
                    {contagem > 99 ? "99+" : contagem}
                  </span>
                )}
                {expandido ? <ChevronDown className="ml-auto size-4 shrink-0" /> : <ChevronRight className="ml-auto size-4 shrink-0" />}
              </button>
              {expandido && (
                <div className="ml-4 mt-0.5 mb-1.5 space-y-0.5 border-l border-linha-forte/50 pl-2">
                  {telasSistema(st).map((i) =>
                    linkMenu(i, st.id + i.href, iconeDe(i.href, st.id), doSetor && aceso(i.href), selo[i.href] ?? 0))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
  const navegacao = noCrm ? navegacaoCrm : navegacaoSistema;

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
        {noCrm ? "CRM" : "Central"}
      </span>
    </Link>
  );

  // tela de escolha do painel: sem menu, só a marca e a escolha
  if (caminho === "/admin/escolher") {
    return (
      <div className="min-h-screen bg-fundo">
        <header className="lp-escuro lp-malha-escura flex h-[72px] items-center gap-4 px-5 md:px-8">
          <div className="w-56">{marca}</div>
          <button type="button" onClick={sair} disabled={saindo}
            className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-texto-2 hover:text-ouro">
            <LogOut className="size-4" /> {saindo ? "Saindo…" : "Sair"}
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1280px] px-5 py-10 md:px-8">{children}</main>
      </div>
    );
  }

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
                <span className="shrink-0">{noCrm ? "CRM Arini Brasil" : "Central Arini"}</span>
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
