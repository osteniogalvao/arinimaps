/**
 * CRM do escritório (migration 0173): carteira de imóveis, clientes e
 * proprietários, funil de negócios, agenda e histórico, nos moldes do CRM da
 * Arini Negócios Imobiliários. Serve corretor/imobiliária e profissional
 * técnico (nicho "engenheiro"), com rótulos próprios de cada um.
 *
 * Essencial: espaço da própria conta. Profissional e Premium (recurso
 * crm_equipe): espaço da organização, compartilhado com a equipe.
 * Premium (crm_auditoria): trilha de alterações do escritório.
 */

export type EspacoEscritorio = {
  chave: string; nome: string; nicho: string;
  equipe: boolean; gestor: boolean; auditoria: boolean;
};
export type Membro = { user_id: string; nome: string; gestor: boolean };

export const ETAPAS_NEGOCIO = {
  novo: "Novo", contato: "Em contato", visita: "Visita", proposta: "Proposta", fechado: "Fechado", perdido: "Perdido",
} as const;
export type EtapaNegocio = keyof typeof ETAPAS_NEGOCIO;
export const ETAPA_IDS = Object.keys(ETAPAS_NEGOCIO) as EtapaNegocio[];

/** Rótulos do funil para o profissional técnico (projetos e serviços). */
export const ETAPAS_TECNICO: Record<EtapaNegocio, string> = {
  novo: "Pedido", contato: "Orçamento", visita: "Vistoria / campo", proposta: "Proposta enviada", fechado: "Contratado", perdido: "Não fechou",
};

export const TIPOS_IMOVEL = {
  casa: "Casa", apartamento: "Apartamento", terreno: "Terreno", lote: "Lote", rural: "Rural",
  comercial: "Comercial", galpao: "Galpão", sala: "Sala", outro: "Outro",
} as const;
export const FINALIDADES = { venda: "Venda", locacao: "Locação", venda_locacao: "Venda e locação" } as const;
export const STATUS_IMOVEL = {
  captacao: "Em captação", disponivel: "Disponível", reservado: "Reservado", vendido: "Vendido", alugado: "Alugado", inativo: "Inativo",
} as const;
export const UNIDADES_AREA = { m2: "m²", ha: "ha", alqueire: "alqueire" } as const;

export const TIPOS_PESSOA = { cliente: "Cliente", proprietario: "Proprietário", lead: "Lead", parceiro: "Parceiro" } as const;

export const TIPOS_COMPROMISSO = {
  visita: "Visita", reuniao: "Reunião", ligacao: "Ligação", tarefa: "Tarefa", prazo: "Prazo", outro: "Outro",
} as const;
export const STATUS_COMPROMISSO = { agendado: "Agendado", feito: "Feito", cancelado: "Cancelado" } as const;

export const ORIGENS = ["Indicação", "WhatsApp", "Instagram", "Facebook", "Site", "Portal", "Placa", "Carteira", "Outro"];

export const UUID_ESC = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehTecnico(espaco: Pick<EspacoEscritorio, "nicho">) {
  return espaco.nicho === "engenheiro";
}
export function rotulosEtapa(espaco: Pick<EspacoEscritorio, "nicho">): Record<EtapaNegocio, string> {
  return ehTecnico(espaco) ? ETAPAS_TECNICO : ETAPAS_NEGOCIO;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const reais = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : BRL.format(Number(v)));

export const FUSO = "America/Sao_Paulo";
/** "2026-11-25" do instante, no fuso de São Paulo. */
export const diaSP = (d: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(d));
export const horaSP = (d: string | Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
export const dataHoraSP = (d: string | Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" }).format(new Date(d));
/** Valor de <input type="datetime-local"> no fuso de São Paulo. */
export const paraCampoDataHora = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
