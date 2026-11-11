/**
 * Setores da Matriz (Central Arini).
 *
 * Um setor novo = uma entrada aqui. O menu lateral, o painel da Matriz, a
 * atribuição de equipe e a trava de acesso saem deste registro, então nome,
 * telas e permissão nunca ficam fora de sincronia.
 *
 * Regra de acesso: a diretoria (`admin_central`) entra em tudo; os demais
 * membros da equipe entram só nos setores listados em `profiles.setores`.
 * A trava é no servidor (exigirSetor / temSetor) — esconder o item do menu é
 * só conveniência, não segurança.
 */
export type SetorId =
  | "diretoria" | "operacoes" | "comercial" | "financeiro" | "juridico"
  | "marketing" | "cartografia" | "suporte" | "seguranca";

export type ItemMenu = { href: string; rotulo: string; icone: string };

export type Setor = {
  id: SetorId;
  nome: string;
  descricao: string;
  icone: string;
  /** página inicial do setor */
  href: string;
  itens: ItemMenu[];
};

export const SETORES: Setor[] = [
  {
    id: "operacoes", nome: "Operações", icone: "▦", href: "/admin/operacoes",
    descricao: "Análise de anúncios, conferência de documentos e aprovação de cadastros.",
    itens: [
      { href: "/admin/operacoes", rotulo: "Painel do setor", icone: "◫" },
      { href: "/admin/imoveis", rotulo: "Imóveis", icone: "▦" },
      { href: "/admin/cadastros", rotulo: "Cadastros", icone: "✓" },
    ],
  },
  {
    id: "comercial", nome: "Comercial", icone: "⇉", href: "/admin/comercial",
    descricao: "Leads, funil de negociação, visitas, propostas e parceiros.",
    itens: [
      { href: "/admin/comercial", rotulo: "Painel do setor", icone: "◫" },
      { href: "/admin/funil", rotulo: "Funil comercial", icone: "⇉" },
      { href: "/admin/empreendimentos", rotulo: "Espelho de vendas", icone: "▦" },
      { href: "/admin/leads", rotulo: "Leads", icone: "◎" },
      { href: "/admin/rodizio", rotulo: "Rodízio de leads", icone: "⟳" },
      { href: "/admin/demandas", rotulo: "Demandas sem imóvel", icone: "⌖" },
      { href: "/admin/organizacoes", rotulo: "Organizações", icone: "▣" },
    ],
  },
  {
    id: "financeiro", nome: "Financeiro", icone: "$", href: "/admin/financeiro",
    descricao: "Comissões, mensalidades, faturas e receita por mês.",
    itens: [
      { href: "/admin/financeiro", rotulo: "Painel do setor", icone: "◫" },
      { href: "/admin/comissoes", rotulo: "Comissões", icone: "％" },
      { href: "/admin/mensalidades", rotulo: "Mensalidades", icone: "$" },
    ],
  },
  {
    id: "juridico", nome: "Jurídico", icone: "⚖", href: "/admin/juridico",
    descricao: "Termos e aceites, autorizações de venda, contratos e pedidos de titulares (LGPD).",
    itens: [
      { href: "/admin/juridico", rotulo: "Painel do setor", icone: "◫" },
      { href: "/admin/juridico/lgpd", rotulo: "Pedidos LGPD", icone: "⛨" },
    ],
  },
  {
    id: "marketing", nome: "Marketing", icone: "✦", href: "/admin/marketing",
    descricao: "Origem dos leads, imóveis mais procurados, materiais de divulgação e vitrine do site.",
    itens: [
      { href: "/admin/marketing", rotulo: "Painel do setor", icone: "◫" },
      { href: "/admin/ranking", rotulo: "Ranking de imóveis", icone: "★" },
      { href: "/admin/conhecimento", rotulo: "Conhecimento e IA", icone: "✎" },
    ],
  },
  {
    id: "cartografia", nome: "Cartografia e dados", icone: "🗺", href: "/admin/cartografia",
    descricao: "Plantas urbanas, malha do CAR, municípios e fontes oficiais.",
    itens: [
      { href: "/admin/cartografia", rotulo: "Cartografia", icone: "🗺" },
      { href: "/admin/cartografia/solicitacoes", rotulo: "Solicitações cartográficas", icone: "⚑" },
      { href: "/admin/regioes", rotulo: "Regiões e CAR", icone: "⊕" },
      { href: "/admin/car", rotulo: "CAR: importação e cobertura", icone: "⇪" },
      { href: "/admin/fontes", rotulo: "Fontes oficiais", icone: "⇄" },
    ],
  },
  {
    id: "suporte", nome: "Suporte", icone: "☏", href: "/admin/suporte",
    descricao: "Chamados de usuários e visitantes, com histórico da conversa.",
    itens: [
      { href: "/admin/suporte", rotulo: "Chamados", icone: "☏" },
    ],
  },
  {
    id: "seguranca", nome: "Segurança", icone: "⛨", href: "/admin/seguranca",
    descricao: "Acessos, tentativas de login, segundo fator e trilha de auditoria.",
    itens: [
      { href: "/admin/seguranca", rotulo: "Acessos e eventos", icone: "⛨" },
      { href: "/admin/seguranca/revisao", rotulo: "Revisão de acessos", icone: "☑" },
      { href: "/admin/auditoria", rotulo: "Auditoria", icone: "⧉" },
    ],
  },
  {
    id: "diretoria", nome: "Diretoria", icone: "◈", href: "/admin/relatorios",
    descricao: "Indicadores gerais, equipe, regras comerciais e configurações do sistema.",
    itens: [
      { href: "/admin/relatorios", rotulo: "Relatórios", icone: "▤" },
      { href: "/admin/usuarios", rotulo: "Equipe e usuários", icone: "☺" },
      { href: "/admin/automacoes", rotulo: "Automações", icone: "⚙" },
      { href: "/admin/planos", rotulo: "Planos e nichos", icone: "◧" },
      { href: "/admin/configuracoes", rotulo: "Configurações", icone: "⚙" },
    ],
  },
];

export const SETOR_IDS = SETORES.map((s) => s.id);
export const setorPorId = (id: string) => SETORES.find((s) => s.id === id) ?? null;

/** Setores que o membro enxerga. Diretoria: todos. */
export function setoresDe(role: string, setores: string[] | null | undefined): SetorId[] {
  if (role === "admin_central") return SETOR_IDS;
  return SETOR_IDS.filter((id) => id !== "diretoria" && (setores ?? []).includes(id));
}

export const PRIORIDADE_LABEL: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta" };
export const TAREFA_STATUS_LABEL: Record<string, string> = {
  aberta: "Aberta", andamento: "Em andamento", aguardando: "Aguardando terceiros", bloqueada: "Bloqueada",
  concluida: "Concluída", cancelada: "Cancelada",
};
/** Origem da tarefa (migration 0065): quem a criou. */
export const TAREFA_ORIGEM_LABEL: Record<string, string> = {
  manual: "Criada pela equipe", encaminhada: "Encaminhada por outro setor", automatica: "Gerada pelo sistema",
};
export const TAREFA_STATUS_ABERTOS = ["aberta", "andamento", "aguardando", "bloqueada"];
