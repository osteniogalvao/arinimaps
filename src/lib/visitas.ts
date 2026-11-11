/**
 * Relatório obrigatório depois da visita (Central de CRMs, bloco 1; migration 0065).
 *
 * O corretor preenche ao marcar a visita como realizada. O proprietário vê só a
 * parte que não identifica o interessado (interesse, pontos fortes, objeções,
 * próximo passo e o resumo escrito para ele), e só se o corretor marcar
 * "compartilhar". Arquivo sem "server-only": o formulário usa os mesmos rótulos.
 */

export type RelatorioVisita = {
  interesse: number;            // 1 a 5
  pontos_positivos: string;
  objecoes: string;
  valor_percebido: "abaixo" | "adequado" | "acima" | "nao_informou";
  probabilidade: "baixa" | "media" | "alta";
  proximo_passo: string;
  resumo_proprietario: string;
  compartilhar: boolean;
};

export const VALOR_PERCEBIDO_LABEL: Record<RelatorioVisita["valor_percebido"], string> = {
  abaixo: "Achou o preço abaixo do que vale",
  adequado: "Achou o preço adequado",
  acima: "Achou o preço acima do que vale",
  nao_informou: "Não comentou o preço",
};

export const PROBABILIDADE_LABEL: Record<RelatorioVisita["probabilidade"], string> = {
  baixa: "Baixa", media: "Média", alta: "Alta",
};

export const RELATORIO_VAZIO: RelatorioVisita = {
  interesse: 3, pontos_positivos: "", objecoes: "", valor_percebido: "nao_informou",
  probabilidade: "media", proximo_passo: "", resumo_proprietario: "", compartilhar: true,
};

const corta = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Valida o que veio do formulário. Devolve o relatório limpo ou a mensagem de erro. */
export function validarRelatorio(bruto: unknown): { relatorio: RelatorioVisita } | { erro: string } {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const interesse = Math.round(Number(b.interesse));
  if (!(interesse >= 1 && interesse <= 5)) return { erro: "Dê uma nota de interesse de 1 a 5." };
  const valor = String(b.valor_percebido ?? "nao_informou");
  const prob = String(b.probabilidade ?? "media");
  const relatorio: RelatorioVisita = {
    interesse,
    pontos_positivos: corta(b.pontos_positivos, 1500),
    objecoes: corta(b.objecoes, 1500),
    valor_percebido: (valor in VALOR_PERCEBIDO_LABEL ? valor : "nao_informou") as RelatorioVisita["valor_percebido"],
    probabilidade: (prob in PROBABILIDADE_LABEL ? prob : "media") as RelatorioVisita["probabilidade"],
    proximo_passo: corta(b.proximo_passo, 600),
    resumo_proprietario: corta(b.resumo_proprietario, 1500),
    compartilhar: b.compartilhar !== false,
  };
  if (relatorio.proximo_passo.length < 3) return { erro: "Diga qual é o próximo passo com esse interessado." };
  if (!relatorio.pontos_positivos && !relatorio.objecoes) {
    return { erro: "Conte o que o interessado gostou ou o que o fez hesitar." };
  }
  return { relatorio };
}

/** Texto que o proprietário lê no Acompanhamento. Nunca traz nome ou contato do interessado. */
export function relatorioParaProprietario(r: RelatorioVisita | null | undefined): string | null {
  if (!r || !r.compartilhar) return null;
  const partes = [
    `Interesse ${r.interesse}/5`,
    r.pontos_positivos && `Gostou: ${r.pontos_positivos}`,
    r.objecoes && `Pontos de atenção: ${r.objecoes}`,
    r.valor_percebido !== "nao_informou" && VALOR_PERCEBIDO_LABEL[r.valor_percebido],
    r.proximo_passo && `Próximo passo: ${r.proximo_passo}`,
    r.resumo_proprietario,
  ].filter(Boolean);
  return partes.join(" · ");
}

/** Resumo de uma linha para a Central. */
export function resumoRelatorio(r: RelatorioVisita): string {
  return `interesse ${r.interesse}/5, chance ${PROBABILIDADE_LABEL[r.probabilidade].toLowerCase()}; próximo passo: ${r.proximo_passo}`;
}
