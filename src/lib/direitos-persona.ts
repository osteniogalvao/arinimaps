import type { RecursoId } from "./planos";

export const PERSONAS_MATRIZ = {
  proprietario: "Proprietário", corretor_imobiliaria: "Corretor ou imobiliária",
  produtor_rural: "Produtor rural", engenheiro: "Profissional técnico",
  comprador_investidor: "Comprador ou investidor", leiloeiro: "Leiloeiro",
  ente_publico: "Órgão público ou instituição", empresa_holding: "Empresa ou incorporadora",
  quero_vender: "Quero vender meu imóvel", correspondente_bancario: "Correspondente bancário",
};

export const NIVEIS_MATRIZ: Record<string, string> = {
  C: "Consulta", L: "Consulta limitada", O: "Operação", P: "Sob contratação",
  M: "Comercialização", G: "Gestão", "-": "Sem acesso",
};
export const DISPOSICOES_MATRIZ = ["Produto", "Plataforma (segurança e permissões)", "Backoffice ARINI",
  "Integração", "Fora do escopo (estratégico)", "Negócio (fora do software)"];
export const FASES_MATRIZ = ["L0 Lançamento", "F1 até 30 dias", "F2 30 a 90 dias", "F3 sob demanda", "—"];

export function personaDaMatriz(nicho: string | null, entrada?: string | null) {
  if (nicho === "proprietario" && entrada === "anunciar") return "quero_vender";
  return nicho && Object.hasOwn(PERSONAS_MATRIZ, nicho) ? nicho as keyof typeof PERSONAS_MATRIZ : null;
}

export type AcaoItem = "consultar" | "operar" | "comercializar" | "gerir";
export type NivelItem = { id: number; nivel: string; liberado: boolean | null };

// O vínculo com o titular/organização é verificado pelo manipulador do dado.
// Uma operação de leitura limitada só aceita conteúdo público de um anúncio.
export function permiteItem(item: NivelItem | undefined, acao: AcaoItem, contratado: boolean, publicoAVenda = false) {
  if (!item || item.liberado === false) return false;
  switch (item.nivel) {
    case "C": return acao === "consultar";
    case "L": return acao === "consultar" && publicoAVenda;
    case "O": return acao === "consultar" || acao === "operar";
    case "P": return item.liberado ?? contratado;
    case "M": return acao !== "gerir";
    case "G": return true;
    default: return false;
  }
}

// Apenas ferramentas já existentes têm um vínculo de execução. Os demais
// itens permanecem consultáveis no inventário e podem ser vinculados ao plano.
export const ITENS_POR_RECURSO: Partial<Record<RecursoId, { id: number; acao: AcaoItem }>> = {
  camada_car: { id: 62, acao: "consultar" }, camada_lotes: { id: 19, acao: "consultar" },
  ferramenta_medir: { id: 137, acao: "operar" },
  consulta_area: { id: 14, acao: "consultar" }, relatorio_territorial: { id: 540, acao: "operar" },
  ferramenta_kml: { id: 150, acao: "operar" }, ferramenta_exportar: { id: 166, acao: "operar" },
  historico_imovel: { id: 148, acao: "consultar" }, pre_avaliacao: { id: 495, acao: "operar" },
  chat_ia: { id: 472, acao: "operar" }, anunciar: { id: 239, acao: "operar" },
  crm_privado: { id: 424, acao: "operar" }, crm_setorial: { id: 433, acao: "operar" },
};
