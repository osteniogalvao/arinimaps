export type PessoaCarga = { user_id: string; nome: string | null; role: string; setores: string[] | null; ativo: boolean; equipe_acesso: string | null; capacidade_tarefas: number | null };
export type TarefaCarga = { id: string; titulo: string; setor: string; responsavel: string | null; prazo: string | null; created_at: string; concluida_em: string | null };
export type SugestaoRedistribuicao = { id: string; titulo: string; setor: string; origem: string; destino: string; destinoId: string; cargaOrigem: number; capacidadeOrigem: number; cargaDestino: number; capacidadeDestino: number; mediaDias: number | null; amostras: number };

/** Só recomenda tarefas do mesmo setor. Não altera vínculos nem interpreta tempo de ciclo como horas trabalhadas. */
export function sugerirRedistribuicao(pessoas: PessoaCarga[], abertas: TarefaCarga[], historico: TarefaCarga[], outras: { responsavel: string }[], setores: string[]) {
  const membros = pessoas.filter(p => p.ativo && ["admin_central", "analista_arini"].includes(p.role) && p.equipe_acesso !== "leitura");
  const carga = new Map<string, number>();
  for (const id of [...abertas.map(t => t.responsavel), ...outras.map(t => t.responsavel)]) if (id) carga.set(id, (carga.get(id) ?? 0) + 1);
  const capacidade = (p: PessoaCarga) => Number.isFinite(p.capacidade_tarefas) && Number(p.capacidade_tarefas) > 0 ? Number(p.capacidade_tarefas) : 0;
  const ciclos = new Map<string, number[]>();
  for (const t of historico) {
    if (!t.responsavel || !t.concluida_em || !setores.includes(t.setor)) continue;
    const dias = (Date.parse(t.concluida_em) - Date.parse(t.created_at)) / 86400000;
    if (!Number.isFinite(dias) || dias < 0) continue;
    const chave = t.responsavel + ":" + t.setor;
    ciclos.set(chave, [...(ciclos.get(chave) ?? []), dias]);
  }
  const media = (id: string, setor: string) => {
    const amostra = ciclos.get(id + ":" + setor) ?? [];
    return { mediaDias: amostra.length ? amostra.reduce((a, b) => a + b, 0) / amostra.length : null, amostras: amostra.length };
  };
  const sugestoes: SugestaoRedistribuicao[] = [];
  for (const t of [...abertas].sort((a, b) => (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999") || a.id.localeCompare(b.id))) {
    if (!t.responsavel || !setores.includes(t.setor)) continue;
    const origem = membros.find(p => p.user_id === t.responsavel);
    if (!origem || !capacidade(origem) || (carga.get(origem.user_id) ?? 0) <= capacidade(origem)) continue;
    const destinos = membros.filter(p => p.user_id !== origem.user_id && (p.role === "admin_central" || p.setores?.includes(t.setor))
      && capacidade(p) > (carga.get(p.user_id) ?? 0));
    destinos.sort((a, b) => (carga.get(a.user_id) ?? 0) / capacidade(a) - (carga.get(b.user_id) ?? 0) / capacidade(b)
      || (media(a.user_id, t.setor).mediaDias ?? Infinity) - (media(b.user_id, t.setor).mediaDias ?? Infinity)
      || a.user_id.localeCompare(b.user_id));
    const destino = destinos[0]; if (!destino) continue;
    const cargaOrigem = carga.get(origem.user_id) ?? 0, cargaDestino = carga.get(destino.user_id) ?? 0;
    sugestoes.push({ id: t.id, titulo: t.titulo, setor: t.setor, origem: origem.nome ?? "Sem nome", destino: destino.nome ?? "Sem nome", destinoId: destino.user_id,
      cargaOrigem, capacidadeOrigem: capacidade(origem), cargaDestino, capacidadeDestino: capacidade(destino), ...media(destino.user_id, t.setor) });
    // Reserva virtual impede recomendar mais trabalho do que a pessoa comporta no mesmo lote.
    carga.set(origem.user_id, cargaOrigem - 1); carga.set(destino.user_id, cargaDestino + 1);
    if (sugestoes.length === 5) break;
  }
  return sugestoes;
}
