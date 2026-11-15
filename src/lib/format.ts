export function formatBRL(v: number | null | undefined) {
  if (v == null) return "Sob consulta";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function formatBRLFinanceiro(valor: number) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Área amigável: rural em ha (e alqueires), urbano em m². */
export function formatArea(areaM2: number | null | undefined, tipo: "urbano" | "rural") {
  if (!areaM2) return "—";
  if (tipo === "rural") {
    const ha = areaM2 / 10000;
    const alq = ha / 4.84; // alqueire mineiro
    return `${ha.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha (${alq.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} alq.)`;
  }
  return `${areaM2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²`;
}

export const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho", pendente: "Pendente", em_analise: "Em análise",
  correcao: "Aguardando correção", aprovado: "Aprovado", publicado: "Publicado",
  em_negociacao: "Em negociação", vendido: "Vendido", historico: "Histórico",
  suspenso: "Suspenso", inativo: "Inativo", reprovado: "Reprovado", leilao: "Leilão",
};

/**
 * "1 registro" / "3 registros" — no lugar do "registro(s)" que aparecia na tela.
 * O plural padrão é singular + "s"; passe o plural quando for irregular.
 */
export function plural(n: number, singular: string, pluralForma = `${singular}s`): string {
  return `${n.toLocaleString("pt-BR")} ${Math.abs(n) === 1 ? singular : pluralForma}`;
}
