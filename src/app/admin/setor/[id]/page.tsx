import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { SETOR_IDS, setorPorId, type SetorId } from "@/lib/setores";
import { ETAPAS, ETAPA_LABEL } from "@/lib/funil";
import { lerAgendaSetores } from "@/lib/agenda-setores-servidor";
import MesaSetor, { type ConversaMesa, type Funil, type TarefaMesa } from "@/components/admin/MesaSetor";

export const metadata = { title: "Setor" };

const TZ = "America/Sao_Paulo";
const ABERTAS = ["aberta", "andamento", "aguardando", "bloqueada"];

/**
 * Visão geral do setor (a "mesa" do setor).
 *
 * Pedido do Carlos em 24/11/2026: a Central estava "carregada, cansativa,
 * confusa"; ele quer o setor como um bloco de operação, etapa por etapa, como
 * no CRM da Arini Negócios Imobiliários: o atendimento do setor, o CRM
 * (pipeline), a agenda e o agendamento, e as tarefas. Esta tela junta os
 * quatro, só leitura e com atalhos; o trabalho acontece nas telas de sempre,
 * que viraram abas no topo.
 */
export default async function MesaDoSetor({ params }: PageProps<"/admin/setor/[id]">) {
  const { id: bruto } = await params;
  if (!SETOR_IDS.includes(bruto as SetorId)) notFound();
  const id = bruto as SetorId;
  await exigirSetor(id);
  const setor = setorPorId(id)!;
  const diretoria = id === "diretoria";
  const admin = supabaseAdmin();
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const em14 = new Date(Date.parse(hoje) + 14 * 86_400_000).toISOString().slice(0, 10);

  // 1. atendimento: a fila do setor (na Diretoria, a caixa central de triagem)
  let conversas = admin.from("atendimento_conversas")
    .select("id, codigo, nome, telefone, responsavel, nao_lidas, ultimo_texto, ultima_mensagem_em")
    .neq("status", "resolvida").order("ultima_mensagem_em", { ascending: false }).limit(300);
  conversas = diretoria ? conversas.is("setor", null) : conversas.eq("setor", id);

  // 2. funis do setor (crm_pipelines) e, no Comercial, o funil de negociação
  const funisSetor = admin.from("crm_pipelines").select("id, nome").eq("setor", id).eq("ativo", true).order("nome");
  const oportunidades = id === "comercial"
    ? admin.from("oportunidades_oficiais").select("etapa").neq("etapa", "perdido").limit(5000)
    : Promise.resolve({ data: null, error: null });

  // 4. tarefas abertas do setor
  const tarefas = admin.from("tasks").select("id, titulo, prazo, prioridade, status")
    .eq("setor", id).in("status", ABERTAS).order("prazo", { ascending: true, nullsFirst: false }).limit(300);

  const [rConversas, rFunis, rOport, rTarefas, agenda] = await Promise.all([
    conversas, funisSetor, oportunidades, tarefas, lerAgendaSetores([id], hoje, em14),
  ]);

  const funis: Funil[] = [];
  if (rOport.data) {
    const conta = new Map<string, number>();
    for (const o of rOport.data as { etapa: string }[]) conta.set(o.etapa, (conta.get(o.etapa) ?? 0) + 1);
    const faixas = ETAPAS.map((e) => ({ rotulo: ETAPA_LABEL[e] ?? e, n: conta.get(e) ?? 0 }));
    funis.push({ id: "comercial", nome: "Funil comercial", href: "/admin/funil", faixas, abertos: faixas.reduce((s, f) => s + f.n, 0), atrasados: 0 });
  }
  const pipelines = (rFunis.data ?? []) as { id: string; nome: string }[];
  if (pipelines.length) {
    const ids = pipelines.map((p) => p.id);
    const [{ data: etapas }, { data: itens }] = await Promise.all([
      admin.from("crm_etapas").select("id, pipeline_id, nome, ordem, final").in("pipeline_id", ids).order("ordem"),
      admin.from("crm_itens").select("pipeline_id, etapa_id, prazo_etapa").in("pipeline_id", ids).eq("status", "aberto").limit(5000),
    ]);
    const agora = Date.now();
    for (const p of pipelines) {
      const doFunil = (itens ?? []).filter((i) => i.pipeline_id === p.id);
      const faixas = (etapas ?? []).filter((e) => e.pipeline_id === p.id).map((e) => {
        const naEtapa = doFunil.filter((i) => i.etapa_id === e.id);
        return { rotulo: e.nome as string, n: naEtapa.length, atrasados: naEtapa.filter((i) => i.prazo_etapa && +new Date(i.prazo_etapa) < agora).length };
      });
      funis.push({
        id: p.id, nome: p.nome, href: `/admin/crm/${p.id}`, faixas,
        abertos: doFunil.length, atrasados: faixas.reduce((s, f) => s + (f.atrasados ?? 0), 0),
      });
    }
  }

  return (
    <MesaSetor setor={setor} hoje={hoje}
      conversas={(rConversas.data ?? []) as ConversaMesa[]} conversasErro={!!rConversas.error}
      funis={funis} agenda={agenda}
      tarefas={(rTarefas.data ?? []) as TarefaMesa[]} tarefasErro={!!rTarefas.error} />
  );
}
