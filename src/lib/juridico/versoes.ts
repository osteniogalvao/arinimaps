export const VERSAO_PDFS = "2026.11.15";
export const VERSOES = {
  "termos-de-uso": VERSAO_PDFS, privacidade: VERSAO_PDFS, autorizacao: "1.0",
  exclusividade: VERSAO_PDFS, remuneracao: VERSAO_PDFS, parceiros: VERSAO_PDFS,
} as const;
export type DocId = keyof typeof VERSOES;
export function assinatura(...ids: DocId[]) {
  return ids.map(id => `${id}@${VERSOES[id]}`).join(",");
}
export function linkTermo(id: DocId) {
  return `/termos/${id}?versao=${VERSOES[id]}`;
}
export const clausulasDestacadas = [
  ["3.2", "Renovação automática por igual prazo, salvo manifestação até a data de término."],
  ["5.3", "Recusa de proposta que atenda a todas as condições de aceite e pagamento da comissão."],
  ["6", "Comissão de 1,9% na venda direta durante a exclusividade, com as ressalvas previstas no Termo."],
  ["7", "Janela de proteção de até dois anos contados do registro de interesse de cada interessado."],
  ["10", "Encerramento antecipado sem justo motivo obriga ao pagamento da comissão sobre o preço anunciado. A cláusula 10 prevê as hipóteses de encerramento e análise de justo motivo."],
] as const;
export function prazoExclusividade(meses: 6 | 12) {
  return meses === 6 ? "180 dias" : "12 meses";
}
