/**
 * Organizações (roadmap 5.9): várias contas sob o mesmo plano.
 *
 * Rótulos e tipos que a tela também usa. O lado servidor (plano da
 * organização, convites) fica em `organizacoes-servidor.ts`.
 * Regras e precedência do plano: `docs/PLANOS.md` §10.
 */

export const TIPOS_ORG = ["imobiliaria", "empresa", "holding", "ente_publico", "franquia"] as const;
export type TipoOrg = (typeof TIPOS_ORG)[number];

export const TIPO_ORG_LABEL: Record<TipoOrg, string> = {
  imobiliaria: "Imobiliária",
  empresa: "Empresa",
  holding: "Holding",
  ente_publico: "Ente público",
  franquia: "Franquia",
};

export const PAPEL_ORG_LABEL: Record<string, string> = { admin: "Administrador", membro: "Membro" };

export const STATUS_MEMBRO_LABEL: Record<string, string> = {
  pendente: "Convite pendente", ativo: "Ativo", recusado: "Recusou", removido: "Removido",
};

export type Organizacao = {
  id: string; nome: string; cnpj: string | null; tipo: TipoOrg;
  plan_id: string | null; plan_valido_ate: string | null; region_id: string | null; ativo: boolean;
};

export type MembroOrg = {
  nicho_vinculo?: string | null;
  id: string; org_id: string; user_id: string | null; email: string;
  papel_org: "admin" | "membro"; status: "pendente" | "ativo" | "recusado" | "removido";
  convidado_em: string; aceito_em: string | null;
};

export const emailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
