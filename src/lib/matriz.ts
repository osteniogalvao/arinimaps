/**
 * Matriz: cobrança por níveis, prazos por setor e estado dos blocos
 * ("ARINI Matriz: Estrutura dos CRMs por Setor", 19/11/2026, seções 4 e 6;
 * migration 0162). Só tipos e regras puras: pode ir para o cliente.
 */

/** Níveis de cobrança da tarefa (seção 4). */
export const NIVEL_COBRANCA_LABEL: Record<number, string> = {
  0: "Criada",
  1: "Lembrete: metade do prazo",
  2: "Vencida: gestor avisado",
  3: "Gargalo: além do limite do setor",
};

export type PrazoSetor = {
  setor: string;
  regra: string;
  prazo_dias: number;
  limite_dias: number;
  atencao: number;
  critico: number;
};

/** Padrão quando a 0162 ainda não rodou (igual ao fallback do banco). */
export const PRAZO_PADRAO: Omit<PrazoSetor, "setor" | "regra"> = { prazo_dias: 3, limite_dias: 2, atencao: 1, critico: 5 };

export type EstadoBloco = "ok" | "atencao" | "critico";

/** Cor do bloco pelo número de vencidas e pelos limites do setor. */
export function estadoBloco(vencidas: number, cfg: Pick<PrazoSetor, "atencao" | "critico">): EstadoBloco {
  if (vencidas >= Math.max(1, cfg.critico)) return "critico";
  if (vencidas >= Math.max(1, cfg.atencao)) return "atencao";
  return "ok";
}

export const ESTADO_LABEL: Record<EstadoBloco, string> = { ok: "sem atraso", atencao: "atenção", critico: "crítico" };

/** Linha de carga por setor (fn_matriz_carga). */
export type CargaSetor = {
  setor: string;
  abertas: number;
  vencidas: number;
  nivel3: number;
  novas24: number;
  concluidas24: number;
  pessoas: number;
  capacidade: number;
  deficit: boolean;
};

/** Dias de atraso de um prazo (AAAA-MM-DD) em relação a hoje. */
export function diasAtraso(prazo: string | null | undefined, hoje: string): number {
  if (!prazo) return 0;
  const d = Math.round((Date.parse(hoje + "T12:00:00Z") - Date.parse(prazo.slice(0, 10) + "T12:00:00Z")) / 86_400_000);
  return Math.max(0, d);
}

/** Datas opcionais de vencimento. Um intervalo inválido nunca vira consulta sem filtro. */
export function periodoGargalos(de: unknown, ate: unknown) {
  const data = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const inicio = de === undefined || de === "" ? "" : data(de) ? de : null;
  const fim = ate === undefined || ate === "" ? "" : data(ate) ? ate : null;
  const erro = inicio === null || fim === null || (!!inicio && !!fim && inicio > fim)
    ? "Informe datas válidas, com o início anterior ou igual ao fim." : null;
  return { de: inicio ?? "", ate: fim ?? "", erro };
}
