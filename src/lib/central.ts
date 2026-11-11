import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { emailDoProfile, sendEmail } from "@/lib/notify";
import { lerConfiguracoes, numero } from "@/lib/settings";

/**
 * Central operacional (bloco 1 da "Central de CRMs", migration 0065).
 *
 * Tudo aqui tolera o banco sem a migration: se a coluna ou a função ainda não
 * existe, a ação principal (lead, visita, tarefa) segue como antes.
 */

type EventoTarefa = {
  task_id: string;
  tipo: "criada" | "encaminhada" | "aceita" | "recusada" | "status" | "responsavel" | "comentario" | "evidencia" | "escalonada" | "prazo";
  autor?: string | null;
  de_setor?: string | null;
  para_setor?: string | null;
  texto?: string | null;
  dados?: Record<string, unknown>;
};

/** Linha do tempo da tarefa. Nunca lança. */
export async function eventoTarefa(e: EventoTarefa) {
  const { error } = await supabaseAdmin().from("task_events").insert({ dados: {}, ...e });
  if (error) console.error("task_events:", error.message);
}

/** Prazo para o setor assumir uma tarefa encaminhada (Configurações › Central). */
export async function prazoAceite(): Promise<string> {
  const horas = numero(await lerConfiguracoes(), "tarefa_aceite_horas", 24);
  return new Date(Date.now() + Math.max(1, horas) * 3_600_000).toISOString();
}

/**
 * Lead novo: entrega ao próximo corretor do rodízio e avisa por e-mail.
 * Sem ninguém no rodízio, o lead fica com a equipe (como antes).
 */
export async function distribuirLead(opportunityId: string, codigo: string, titulo: string) {
  const admin = supabaseAdmin();
  const { data: userId, error } = await admin.rpc("fn_rodizio_atribuir", { p_opp: opportunityId, p_motivo: "rodizio" });
  if (error) {
    // migration 0065 ainda não aplicada
    if (!/fn_rodizio_atribuir/.test(error.message)) console.error("rodízio de leads:", error.message);
    return null;
  }
  if (!userId) return null;
  const minutos = numero(await lerConfiguracoes(), "rodizio_minutos", 30);
  const email = await emailDoProfile(userId as string);
  await sendEmail(email, `Novo lead para você: ${codigo}`,
    `O rodízio entregou a você o lead ${codigo} (${titulo}).\n\n` +
    `Faça o primeiro contato em até ${minutos} minutos e registre na oportunidade. ` +
    `Sem registro nesse prazo, o lead passa para o próximo corretor.\n\n` +
    `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/oportunidades/${opportunityId}`);
  return userId as string;
}

/**
 * O corretor agiu na oportunidade (anotação, etapa, visita, proposta): conta
 * como primeiro atendimento e o lead para de rodar. Quem é da equipe e ainda
 * não tem responsável vira o responsável.
 */
export async function marcarPrimeiroAtendimento(opportunityId: string, userId: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("opportunities")
    .select("responsavel_user_id, primeiro_atendimento_em").eq("id", opportunityId).maybeSingle();
  if (error || !data || data.primeiro_atendimento_em) return;
  const { data: perfil } = await admin.from("profiles").select("role").eq("user_id", userId).maybeSingle();
  const equipe = ["admin_central", "analista_arini"].includes(perfil?.role ?? "");
  await admin.from("opportunities").update({
    primeiro_atendimento_em: new Date().toISOString(),
    prazo_atendimento: null,
    ...(equipe && !data.responsavel_user_id ? { responsavel_user_id: userId } : {}),
  }).eq("id", opportunityId).is("primeiro_atendimento_em", null);
}

/** Fecha a tarefa automática ligada a um evento (ex.: relatório da visita entregue). */
export async function concluirTarefaDoEvento(chave: string, autor: string, evidencia: string) {
  const admin = supabaseAdmin();
  const { data } = await admin.from("tasks").select("id, status, setor")
    .eq("chave_evento", chave).in("status", ["aberta", "andamento", "aguardando", "bloqueada"]).maybeSingle();
  if (!data) return;
  await admin.from("tasks").update({ status: "concluida", concluida_em: new Date().toISOString(), evidencia }).eq("id", data.id);
  await eventoTarefa({ task_id: data.id, tipo: "status", autor, texto: `Concluída: ${evidencia}`, dados: { status: "concluida" } });
}

/** Colunas que as listas de tarefas usam. As da 0065 só entram se existirem. */
const CAMPOS_TAREFA_BASE = "id, titulo, descricao, setor, status, prioridade, prazo, responsavel, created_at";
const CAMPOS_TAREFA_0065 = `${CAMPOS_TAREFA_BASE}, codigo, origem, setor_origem, aceite_em, prazo_aceite, regra, escalonada_em, opportunity_id, property_id`;

export type TarefaLinha = {
  id: string; titulo: string; descricao: string | null; setor: string; status: string; prioridade: string;
  prazo: string | null; responsavel: string | null; created_at: string;
  codigo?: string | null; origem?: string | null; setor_origem?: string | null; aceite_em?: string | null;
  prazo_aceite?: string | null; regra?: string | null; escalonada_em?: string | null;
  opportunity_id?: string | null; property_id?: string | null;
};

// o construtor do PostgREST muda de tipo a cada filtro; aqui só repassamos
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = any;

/**
 * Busca tarefas aplicando `filtro`. Se o banco ainda não tem a 0065, cai para
 * as colunas antigas e ignora os filtros que dependem delas.
 */
export async function buscarTarefas(filtro: (q: Consulta, nova: boolean) => Consulta, limite = 200): Promise<TarefaLinha[]> {
  const admin = supabaseAdmin();
  const nova = await filtro(admin.from("tasks").select(CAMPOS_TAREFA_0065), true).limit(limite);
  if (!nova.error) return (nova.data ?? []) as unknown as TarefaLinha[];
  const velha = await filtro(admin.from("tasks").select(CAMPOS_TAREFA_BASE), false).limit(limite);
  return (velha.data ?? []) as unknown as TarefaLinha[];
}
