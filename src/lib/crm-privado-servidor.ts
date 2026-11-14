import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { TAM_PAGINA_CRM, type AtendimentoPrivado, type EventoPrivado, type ServicoPrivado, type ConfiguracaoSetorial } from "@/lib/crm-privado";

type Banco = Awaited<ReturnType<typeof supabaseServer>>;
const CAMPOS = "id,assunto,etapa,proximo_retorno,versao,atualizado_em,contato:crm_privado_contatos!inner(id,nome,email,telefone)";
export async function configuracaoPrivada(banco: Banco): Promise<ConfiguracaoSetorial | null> {
  const { data, error } = await banco.rpc("crm_privado_configuracao");
  if (error) throw new Error("Falha ao consultar os modelos de serviço.");
  return data;
}
export async function sessaoCrm() {
  const banco = await supabaseServer();
  const { data: { user } } = await banco.auth.getUser();
  if (!user) return { status: 401 } as const;
  const { data, error } = await banco.rpc("crm_privado_liberado");
  if (error) return { status: 503 } as const;
  return data === true ? { status: 200, banco, titular: user.id } as const : { status: 403 } as const;
}
export async function listarPrivados(banco: Banco, titular: string, pagina: number) {
  const inicio = (pagina - 1) * TAM_PAGINA_CRM;
  const res = await banco.from("crm_privado_atendimentos").select(CAMPOS)
    .eq("titular_id", titular).order("atualizado_em", { ascending: false }).order("id").range(inicio, inicio + TAM_PAGINA_CRM);
  if (res.error) throw new Error("Falha ao consultar os atendimentos.");
  const itens = (res.data ?? []) as unknown as AtendimentoPrivado[];
  return { itens: itens.slice(0, TAM_PAGINA_CRM), temMais: itens.length > TAM_PAGINA_CRM };
}
export async function detalhePrivado(banco: Banco, titular: string, id: string, pagina: number) {
  const inicio = (pagina - 1) * TAM_PAGINA_CRM;
  const [at, hist, servico] = await Promise.all([
    banco.from("crm_privado_atendimentos").select(CAMPOS).eq("titular_id", titular).eq("id", id).maybeSingle(),
    banco.from("crm_privado_historico").select("versao,etapa_anterior,etapa,proximo_retorno,nota,criado_em")
      .eq("titular_id", titular).eq("atendimento_id", id).order("versao", { ascending: false }).range(inicio, inicio + TAM_PAGINA_CRM),
    banco.from("crm_privado_servicos").select("modelo_nome,categoria_nome,campos")
      .eq("titular_id",titular).eq("atendimento_id",id).maybeSingle(),
  ]);
  if (at.error || hist.error || servico.error) throw new Error("Falha ao consultar o histórico.");
  if (!at.data) return null;
  const eventos = (hist.data ?? []) as EventoPrivado[];
  return { atendimento: at.data as unknown as AtendimentoPrivado, servico: servico.data as ServicoPrivado | null, eventos: eventos.slice(0,TAM_PAGINA_CRM), temMais: eventos.length > TAM_PAGINA_CRM };
}
