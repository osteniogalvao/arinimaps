/**
 * Motor de CRM configurável por setor (Central de CRMs, etapa 5,
 * migration 0069). Tipos e validação compartilhados entre a tela e a API.
 */
export type Etapa = { id: string; pipeline_id: string; nome: string; ordem: number; sla_horas: number | null; final: boolean };
export type CampoCrm = {
  id: string; pipeline_id: string; chave: string; rotulo: string;
  tipo: "texto" | "textarea" | "numero" | "dinheiro" | "data" | "select" | "bool";
  opcoes: string[]; exigido_desde: string | null; ordem: number;
};
export type Pipeline = { id: string; setor: string; nome: string; descricao: string | null; ativo: boolean };
export type ItemCrm = {
  id: string; codigo: string; pipeline_id: string; etapa_id: string | null; titulo: string; descricao: string | null;
  responsavel: string | null; dados: Record<string, unknown>; prazo_etapa: string | null; entrou_etapa_em: string;
  status: "aberto" | "concluido" | "cancelado"; created_at: string;
};

export const TIPOS_CAMPO: [CampoCrm["tipo"], string][] = [
  ["texto", "Texto curto"], ["textarea", "Texto longo"], ["numero", "Número"], ["dinheiro", "Valor (R$)"],
  ["data", "Data"], ["select", "Lista de opções"], ["bool", "Sim ou não"],
];

/** Campos que faltam para o item entrar (ou ficar) na etapa de destino. */
export function camposFaltando(campos: CampoCrm[], etapas: Etapa[], destino: string, dados: Record<string, unknown>) {
  const ordemDestino = etapas.find((e) => e.id === destino)?.ordem ?? 0;
  return campos.filter((c) => {
    if (!c.exigido_desde) return false;
    const desde = etapas.find((e) => e.id === c.exigido_desde)?.ordem ?? Infinity;
    if (ordemDestino < desde) return false;
    const v = dados[c.chave];
    return v === undefined || v === null || v === "" || (c.tipo === "bool" && v !== true);
  });
}

export function normalizarDados(campos: CampoCrm[], entrada: Record<string, unknown>) {
  const dados: Record<string, unknown> = {};
  for (const c of campos) {
    const v = entrada[c.chave];
    if (v === undefined) continue;
    if (v === null || v === "") { dados[c.chave] = null; continue; }
    switch (c.tipo) {
      case "numero": case "dinheiro": {
        const n = Number(String(v).replace(",", "."));
        dados[c.chave] = Number.isFinite(n) ? n : null; break;
      }
      case "bool": dados[c.chave] = v === true || v === "true"; break;
      case "data": dados[c.chave] = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null; break;
      case "select": dados[c.chave] = c.opcoes.includes(String(v)) ? String(v) : null; break;
      default: dados[c.chave] = String(v).slice(0, c.tipo === "textarea" ? 5000 : 300);
    }
  }
  return dados;
}

export const prazoDaEtapa = (e: Etapa | undefined) => (e?.sla_horas && !e.final ? new Date(Date.now() + e.sla_horas * 3_600_000).toISOString() : null);
