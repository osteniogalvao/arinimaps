export const ETAPAS_CRM_PRIVADO = {
  triagem: "Triagem", em_atendimento: "Em atendimento", aguardando_retorno: "Aguardando retorno", concluido: "Concluído",
} as const;
export type EtapaPrivada = keyof typeof ETAPAS_CRM_PRIVADO;
export type ContatoPrivado = { id: string; nome: string; email: string | null; telefone: string | null };
export type CampoSetorial = { nome: string; tipo: "texto" | "data" | "numero" };
export type ModeloSetorial = { nome: string; categorias: Record<string,string>; campos: Record<string,CampoSetorial> };
export type ConfiguracaoSetorial = { profissao: string | null; modelos: Record<string,ModeloSetorial> };
export type ServicoPrivado = { modelo_nome: string; categoria_nome: string; campos: Record<string,CampoSetorial & { valor: string }> };
export type AtendimentoPrivado = {
  id: string; assunto: string; etapa: EtapaPrivada; proximo_retorno: string | null;
  versao: number; atualizado_em: string; contato: ContatoPrivado;
};
export type EventoPrivado = {
  versao: number; etapa_anterior: EtapaPrivada | null; etapa: EtapaPrivada; proximo_retorno: string | null;
  nota: string | null; criado_em: string;
};
export const UUID_CRM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TAM_PAGINA_CRM = 25;
export function paginaCrm(texto: string | null | undefined) {
  const n = Number(texto);
  return Number.isSafeInteger(n) && n > 0 && n < 1000000 ? n : 1;
}
