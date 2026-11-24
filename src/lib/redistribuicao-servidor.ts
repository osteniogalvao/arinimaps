import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sugerirRedistribuicao, type PessoaCarga, type TarefaCarga } from "@/lib/redistribuicao";
import { SETOR_IDS, TAREFA_STATUS_ABERTOS } from "@/lib/setores";

/** Chamado somente na página da Diretoria. Paginação evita tratar limite do PostgREST como carga completa. */
export async function lerRedistribuicao(setores: string[], agora = new Date()) {
  const vazio = { sugestoes: [], pronto: false, erro: "A consulta de capacidade está indisponível. Não foram calculadas sugestões." };
  if (!setores.includes("diretoria")) return vazio;
  const db = supabaseAdmin();
  const desde = new Date(agora.getTime() - 90 * 86400000).toISOString();
  const ate = agora.toISOString();
  const tarefaCols = "id,titulo,setor,responsavel,prazo,created_at,concluida_em";
  // Cada origem tem limite explícito. Dados parciais nunca geram uma recomendação.
  async function paginas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
    const todos: T[] = [];
    for (let de = 0; de < 10000; de += 500) {
      const r = await consulta(de, de + 499);
      if (r.error || !r.data) throw new Error("Consulta de carga falhou");
      todos.push(...r.data); if (r.data.length < 500) return todos;
    }
    throw new Error("Carga acima do limite de análise");
  }
  try {
    const [pessoas, abertas, historico, leads, crm] = await Promise.all([
      paginas<PessoaCarga>((de, fim) => db.from("profiles").select("user_id,nome,role,setores,ativo,equipe_acesso,capacidade_tarefas")
        .in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("user_id").range(de, fim)),
      paginas<TarefaCarga>((de, fim) => db.from("tasks").select(tarefaCols).in("status", TAREFA_STATUS_ABERTOS).order("id").range(de, fim)),
      paginas<TarefaCarga>((de, fim) => db.from("tasks").select(tarefaCols).eq("status", "concluida")
        .gte("concluida_em", desde).lte("concluida_em", ate).order("id").range(de, fim)),
      paginas<{ responsavel_user_id: string }>((de, fim) => db.from("opportunities").select("responsavel_user_id").not("responsavel_user_id", "is", null)
        .not("etapa", "in", "(fechado,pos_venda,perdido)").order("id").range(de, fim)),
      paginas<{ responsavel: string }>((de, fim) => db.from("crm_itens").select("responsavel").eq("status", "aberto").not("responsavel", "is", null).order("id").range(de, fim)),
    ]);
    return { sugestoes: sugerirRedistribuicao(pessoas, abertas, historico, [...leads.map(l => ({ responsavel: l.responsavel_user_id })), ...crm], SETOR_IDS), pronto: true, erro: null };
  } catch { return vazio; }
}
