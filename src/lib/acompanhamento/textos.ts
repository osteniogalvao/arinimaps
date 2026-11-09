/**
 * Acompanhamento do proprietário (item 28, referência Quave.imob): rótulos,
 * prazos das pendências e o link do WhatsApp com a mensagem pronta.
 *
 * Sem a WhatsApp Business API, o WhatsApp é só um link `wa.me` que a pessoa
 * abre e envia. O envio automático entra em `enviarAvisoProprietario`
 * (src/lib/acompanhamento/servidor.ts), que hoje só manda e-mail.
 *
 * Compartilhado entre servidor e navegador.
 */

export const VISITA_LABEL: Record<string, string> = {
  agendada: "Visita agendada",
  realizada: "Visita realizada",
  remarcada: "Visita remarcada",
  nao_compareceu: "Interessado não compareceu",
  cancelada: "Visita cancelada",
};

export const PROPOSTA_STATUS_LABEL: Record<string, string> = {
  enviada: "Em análise", aceita: "Aceita", contraproposta: "Respondida com contraproposta", recusada: "Recusada",
};

/** Visita realizada sem feedback depois deste prazo vira pendência do intermediador. */
export const HORAS_SEM_FEEDBACK = 48;
/** Proprietário sem nenhuma atualização há este tempo vira pendência do intermediador. */
export const DIAS_SEM_ATUALIZACAO = 7;

export const dataBR = (d: string | Date) =>
  new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
export const dataHoraBR = (d: string | Date) =>
  new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/**
 * Link do WhatsApp com a mensagem pronta. Número brasileiro sem DDI ganha 55.
 * null quando não há número utilizável.
 */
export function linkWhatsApp(telefone: string | null | undefined, texto: string): string | null {
  let n = String(telefone ?? "").replace(/\D/g, "");
  if (n.length < 10) return null;
  if (n.length <= 11) n = "55" + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}
