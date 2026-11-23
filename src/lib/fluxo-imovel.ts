/** Fluxo do imóvel captação → Marketing → aprovação da Diretoria (migration 0157). Sem dependência de servidor. */
export const FLUXO_STATUS: Record<string, string> = {
  enviado: "Enviado ao Marketing",
  em_producao: "Em produção",
  aguardando_aprovacao: "Aguardando a Diretoria",
  ajustes: "Ajustes pedidos",
  aprovado: "Aprovado para divulgar",
};
export const FLUXO_ORDEM = ["enviado", "em_producao", "ajustes", "aguardando_aprovacao", "aprovado"];
export type Material = { titulo: string; url: string; em: string; por?: string | null };
