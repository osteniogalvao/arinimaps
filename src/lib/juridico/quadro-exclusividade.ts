export const camposQuadro = [
  ["titular", "Nome ou razão social, CPF ou CNPJ e endereço do titular do imóvel"],
  ["documento", "CPF ou CNPJ de quem assina pela conta"],
  ["titularidade", "Estado civil, regime de bens e poderes de representação"],
  ["anuentes", "Coproprietários e anuentes, com qualificação, ou declaração de titular único"],
  ["direito", "Natureza do direito, área registral e área levantada"],
  ["cadastro", "CAR, CCIR ou inscrição municipal"],
  ["ocupacao", "Ocupação, arrendamento, ônus, gravames e ações conhecidos"],
  ["entrada", "Entrada, prazo e forma de pagamento aceitos"],
  ["vencimento", "Momento de pagamento da comissão"],
  ["adicionais", "Serviços adicionais contratados, se houver"],
] as const;
export type CampoQuadro = typeof camposQuadro[number][0];
export type QuadroExclusividade = Record<CampoQuadro, string>;
export function validarQuadro(valor: unknown): valor is QuadroExclusividade {
  if (!valor || typeof valor !== "object") return false;
  const dados = valor as Record<string, unknown>;
  return camposQuadro.every(([campo]) => {
    const item = dados[campo];
    return typeof item === "string" && item.trim().length >= 2 && item.length <= 1500;
  });
}
