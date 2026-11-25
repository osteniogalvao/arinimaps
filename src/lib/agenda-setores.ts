export type CompromissoSetor = {
  id: string; setor: string; tipo: string; titulo: string; data: string; href: string;
  /** quem responde pelo compromisso (reunião, tarefa, item do CRM); nulo nas filas sem dono */
  responsavel?: string | null;
  /** hora de início (só reuniões), no fuso de São Paulo, "HH:MM" */
  hora?: string;
};
export function periodoAgenda(inicio: unknown, fim: unknown, hoje: string) {
  const valido = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  const de = valido(inicio) ? inicio : hoje;
  const padrao = new Date(Date.parse(de) + 30 * 86_400_000).toISOString().slice(0, 10);
  const ate = valido(fim) && fim >= de && Date.parse(fim) - Date.parse(de) <= 366 * 86_400_000 ? fim : padrao;
  return { de, ate };
}

export function ordenarAgenda(itens: CompromissoSetor[], setores: string[], de: string, ate: string) {
  return itens.filter(i => setores.includes(i.setor) && i.data.slice(0, 10) >= de && i.data.slice(0, 10) <= ate)
    .sort((a, b) => a.data.localeCompare(b.data) || (a.hora ?? "99").localeCompare(b.hora ?? "99") || a.titulo.localeCompare(b.titulo));
}
