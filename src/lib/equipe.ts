/**
 * Funções e gestores da equipe (migration 0161).
 *
 * A função (cargo) é só rótulo: o que a pessoa acessa continua saindo dos
 * setores marcados. O gestor de um setor libera e retira o acesso daquele
 * setor, define a função de quem trabalha nele e cria login novo já preso aos
 * setores que gere. A Diretoria faz tudo isso em todos os setores e é quem
 * nomeia os gestores.
 */
export const CARGO_MAX = 40;

/** Sugestões sem travar: a imobiliária inventa função nova toda hora. */
export const CARGOS_SUGERIDOS = [
  "Corretor", "Corretora", "Captador", "Captadora", "Recepcionista", "Atendente",
  "Gerente de Vendas", "Gerente de Locação", "Coordenador", "Analista", "Assistente",
  "Cartógrafo", "Financeiro", "Jurídico", "Marketing", "Designer", "Gestor de tráfego",
  "Suporte", "Administrativo", "Estagiário",
];

export function limparCargo(v: unknown): string | null {
  const t = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, CARGO_MAX);
  return t || null;
}

/** Erro de coluna inexistente: a 0161 ainda não rodou. */
export const falta0161 = (msg?: string | null) => !!msg && /cargo|setores_gestor|42703|does not exist/.test(msg);
