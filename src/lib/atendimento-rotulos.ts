/** Rótulos do Atendimento (0156), sem dependência de servidor: valem na tela e na API. */
import { setorPorId, SETOR_IDS, type SetorId } from "@/lib/setores";

export const STATUS_LABEL: Record<string, string> = { aberta: "Aberta", pendente: "Aguardando cliente", resolvida: "Resolvida" };
export const PERFIL_LABEL: Record<string, string> = {
  proprietario: "Proprietário", corretor: "Corretor parceiro", imobiliaria: "Imobiliária parceira", engenheiro: "Engenheiro parceiro",
  franqueado: "Franqueado", leiloeiro: "Leiloeiro", comprador: "Cliente com conta", consulta: "Cliente com conta",
  admin_central: "Equipe ARINI", analista_arini: "Equipe ARINI", negociacao: "Cliente em negociação",
};

/** Setores que recebem atendimento (todos menos a diretoria, que vê tudo). */
export const SETORES_ATENDIMENTO: SetorId[] = SETOR_IDS.filter((s) => s !== "diretoria");
export const nomeSetor = (s: string | null | undefined) => (s ? setorPorId(s)?.nome ?? s : "Caixa central");

