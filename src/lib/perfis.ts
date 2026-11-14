/**
 * Perfis de acesso do sistema, num lugar só.
 *
 * Três famílias, e é a família que decide o que a pessoa enxerga:
 *  · EQUIPE   — Matriz (Central Arini), dividida por setores (src/lib/setores.ts);
 *  · PARCEIRO — anuncia imóveis de terceiros; passa por aprovação e só enxerga
 *               os próprios imóveis e as oportunidades encaminhadas a ele;
 *  · CLIENTE  — proprietário (anuncia o que é dele), comprador e consulta.
 *
 * A matriz completa de permissões está em docs/SEGURANCA.md.
 */
export const PAPEIS_EQUIPE = ["admin_central", "analista_arini"] as const;
export const PAPEIS_PARCEIRO = ["imobiliaria", "corretor", "engenheiro", "leiloeiro", "franqueado"] as const;
/** Perfis que a pessoa escolhe ao criar a conta. Franqueado é definido pela Matriz. */
export const PAPEIS_CADASTRO = ["comprador", "consulta", "proprietario", "imobiliaria", "corretor", "engenheiro", "leiloeiro"] as const;

export const ehEquipe = (role: string | null | undefined) => (PAPEIS_EQUIPE as readonly string[]).includes(role ?? "");
export const ehParceiro = (role: string | null | undefined) => (PAPEIS_PARCEIRO as readonly string[]).includes(role ?? "");
/** A atividade técnica preserva o cadastro de parceiro e a leitura da carteira histórica. */
export function podeAnunciar(role: string | null | undefined, nicho?: string | null): boolean {
  if (ehEquipe(role)) return true;
  if (nicho && ["engenheiro", "ente_publico", "comprador_investidor", "consulta"].includes(nicho)) return false;
  return ["proprietario", "corretor", "imobiliaria", "leiloeiro", "franqueado"].includes(role ?? "");
}

export const PAPEL_LABEL: Record<string, string> = {
  admin_central: "Diretoria", analista_arini: "Equipe Arini",
  imobiliaria: "Imobiliária", corretor: "Corretor", engenheiro: "Engenheiro / profissional",
  leiloeiro: "Leiloeiro", franqueado: "Franqueado",
  proprietario: "Proprietário", comprador: "Comprador", consulta: "Consulta",
};

/** Nome do registro profissional que cada parceiro informa. */
export const REGISTRO_LABEL: Record<string, string> = {
  imobiliaria: "CRECI", corretor: "CRECI", engenheiro: "Registro profissional (se aplicável)",
  leiloeiro: "Matrícula na Junta Comercial", franqueado: "CRECI",
};
