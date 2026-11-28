/**
 * Os dois painéis da Central (pedido do Stenio, 27/11/2026): ao entrar, quem
 * é da equipe escolhe entre
 *
 *  - "CRM Arini Brasil": só o CRM, com o menu no jeito do CRM da Arini
 *    Negócios (lista curta e plana, na mesma ordem: Dashboard, Captação,
 *    Marketing, Imóveis, Proprietários…), filtrado pelos setores da pessoa;
 *  - "Sistema completo": o resto da Central, sem as telas do CRM.
 *
 * A escolha fica num cookie e só muda o MENU. A trava de acesso continua em
 * cada página (exigirSetor), então o menu nunca libera o que o setor não pode.
 * Sem dependência de servidor: usado pela casca (cliente) e pelas páginas.
 */

import type { SetorId } from "./setores";

export type Painel = "crm" | "sistema";
export const COOKIE_PAINEL = "arini_painel";
export const painelValido = (v: unknown): Painel | null => (v === "crm" || v === "sistema" ? v : null);

/** Início de cada painel. */
export const INICIO_PAINEL: Record<Painel, string> = { crm: "/admin/painel-crm", sistema: "/admin" };

/**
 * Item do menu do CRM. `setores` vazio = toda a equipe. A Diretoria vê tudo
 * (setoresDe devolve todos os setores para ela).
 */
export type ItemCrm = { href: string; rotulo: string; setores: SetorId[] };

/**
 * Menu do CRM, na ordem do CRM da Arini Negócios (src/lib/permissions.ts do
 * repositório antigo), com cada tela apontando para a equivalente daqui e com
 * os mesmos setores que a página exige.
 */
export const MENU_CRM: ItemCrm[] = [
  { href: "/admin/painel-crm", rotulo: "Dashboard", setores: [] },
  { href: "/admin/imoveis", rotulo: "Captação", setores: ["operacoes"] },
  { href: "/admin/marketing/fluxo", rotulo: "Marketing", setores: ["marketing", "operacoes", "diretoria"] },
  { href: "/admin/consulta-imoveis", rotulo: "Imóveis", setores: ["comercial", "operacoes", "marketing"] },
  { href: "/admin/proprietarios", rotulo: "Proprietários", setores: ["operacoes", "comercial", "juridico"] },
  { href: "/admin/corretores", rotulo: "Corretores", setores: ["comercial", "diretoria"] },
  { href: "/admin/clientes", rotulo: "Clientes", setores: ["comercial"] },
  { href: "/admin/aprovacoes", rotulo: "Aprovações", setores: ["diretoria"] },
  { href: "/admin/juridico", rotulo: "Jurídico", setores: ["juridico"] },
  { href: "/admin/leads", rotulo: "Leads", setores: ["comercial"] },
  { href: "/admin/funil", rotulo: "Funil de leads", setores: ["comercial"] },
  { href: "/admin/atendimento", rotulo: "Atendimento", setores: [] },
  { href: "/admin/agenda", rotulo: "Agenda", setores: ["comercial"] },
  { href: "/admin/financeiro", rotulo: "Financ. Empresa", setores: ["financeiro"] },
  { href: "/admin/comissoes", rotulo: "Comissões", setores: ["financeiro"] },
  { href: "/admin/financeiro/alugueis", rotulo: "Aluguéis", setores: ["financeiro", "diretoria"] },
  { href: "/admin/relatorios", rotulo: "Relatórios", setores: ["diretoria"] },
  { href: "/admin/chat", rotulo: "Chat", setores: [] },
  { href: "/admin/ponto", rotulo: "Ponto", setores: [] },
  { href: "/admin/notificacoes", rotulo: "Notificações", setores: [] },
  { href: "/admin/usuarios", rotulo: "Usuários", setores: ["diretoria"] },
  { href: "/admin/auditoria", rotulo: "Auditoria", setores: ["seguranca", "diretoria"] },
  { href: "/admin/crm-antigo", rotulo: "CRM antigo", setores: ["operacoes", "comercial"] },
];

/** Telas que moram no CRM: somem do menu do Sistema completo. */
export const TELAS_CRM = new Set(
  MENU_CRM.map((i) => i.href).filter((h) => !["/admin/chat", "/admin/ponto", "/admin/notificacoes", "/admin/atendimento"].includes(h))
);

/** Menu do CRM de quem tem estes setores. */
export function menuCrm(setores: SetorId[]): ItemCrm[] {
  return MENU_CRM.filter((i) => i.setores.length === 0 || i.setores.some((s) => setores.includes(s)));
}
