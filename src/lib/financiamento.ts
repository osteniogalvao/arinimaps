export const AVISO_SIMULACAO = "Simulação ilustrativa, a oferta oficial é do banco.";
export const MOTIVOS_PERDA = ["Desistência", "Sem retorno", "Crédito incompatível", "Imóvel indisponível", "Outro"];
export type LinhaCredito = {
  id: string; banco: string; nome: string; prazo_max: number; percentual_max: number; sistemas: string[];
  taxa_nominal_aa: number; cet_aa: number; seguro_mensal: number; tarifa_inicial: number; fonte: string; inicio: string; fim: string;
};
export type Espelho = {
  codigo: string; titulo: string; valor: number; financiado: number; entrada: number; prazo: number; sistema: string;
  banco: string; linha: string; parcela_inicial: number; total: number; taxa_nominal_aa: number;
  seguro_mensal: number; tarifa_inicial: number; cet_aa: number; fonte: string; versao: string;
};
export type VagaPublica = { id: string; identificacao: string; banco: string };
export const estadoLegivel = (estado: string) => estado.toLocaleLowerCase("pt-BR").replaceAll("_", " ");
export function termoCredito(vaga: VagaPublica) {
  return `Autorizo compartilhar meu contato, esta simulação e os dados opcionais informados com ${vaga.identificacao} para atendimento do banco ${vaga.banco}. Versão 1.`;
}

