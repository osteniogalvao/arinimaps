import type { cotarPlano } from "@/lib/planos-catalogo";

export const SITUACOES_PEDIDO = {
  pendente: "Pendente", em_analise: "Em análise", concluido: "Concluído", cancelado: "Cancelado",
} as const;
export type SituacaoPedido = keyof typeof SITUACOES_PEDIDO;
export type SelecaoPedido = Parameters<typeof cotarPlano>[0];
export type PedidoPlano = {
  id: string; status: SituacaoPedido; created_at: string; updated_at: string;
  selecao: SelecaoPedido; cotacao: ReturnType<typeof cotarPlano>;
};
export type PedidoCentral = PedidoPlano & { user_id: string; email_contato: string | null; perfil: { nome: string; telefone: string | null } | null;
  vagas_cofre: { quantidade:number } | null };
