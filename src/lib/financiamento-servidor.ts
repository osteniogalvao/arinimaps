import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { estadoLegivel, type VagaPublica, type Espelho } from "./financiamento";
import type { Ator } from "./authz";

export async function vagaDaSimulacao(id: string, cliente: string): Promise<VagaPublica | null> {
  const db = supabaseAdmin();
  const { data: sim, error } = await db.from("fin_simulacoes").select("regiao_id,espelho").eq("id",id).eq("cliente_id",cliente).maybeSingle();
  if (error) throw Error("Falha ao consultar a região.");
  if (!sim?.regiao_id) return null;
  const vagas = await db.from("fin_vagas").select("id,identificacao,banco").eq("regiao_id",sim.regiao_id)
    .eq("ativo",true).order("prioridade");
  if (vagas.error) throw Error("Falha ao consultar as vagas.");
  return vagas.data.find(v => v.banco.trim().toLowerCase() === sim.espelho.banco.trim().toLowerCase()) ?? null;
}

export async function lerAtendimento(id: string, ator: Ator) {
  const db = supabaseAdmin();
  // O join do correspondente filtra consentimento e vaga antes de trazer o espelho, o contato ou os documentos.
  const dono = await db.from("fin_simulacoes").select("id,criada_em,espelho,linha_id,cliente_id").eq("id", id).eq("cliente_id",ator.userId).maybeSingle();
  if (dono.error) throw Error("Não foi possível consultar a simulação.");
  const autorizado = dono.data ? null : ator.nicho === "correspondente_bancario" ?
    await db.from("fin_atendimentos").select("id,vaga:fin_vagas!inner(titular_id,ativo)").eq("id",id)
      .eq("vaga.titular_id",ator.userId).eq("vaga.ativo",true).is("revogado_em",null).maybeSingle() : null;
  if (autorizado?.error) throw Error("Não foi possível consultar a vaga.");
  if (!dono.data && !autorizado?.data) return null;
  const sim = dono.data ?? (await db.from("fin_simulacoes").select("id,criada_em,espelho,linha_id,cliente_id").eq("id",id).single()).data;
  if (!sim) return null;
  const [atendimento, documentos, historico, linha] = await Promise.all([
    db.from("fin_atendimentos").select("estado,prazo_contato,primeiro_contato,consentido_em,revogado_em,consentimento,nome,email,telefone,renda,nascimento").eq("id",id).maybeSingle(),
    db.from("fin_documentos").select("id,titulo,estado,comentario,nome_arquivo").eq("atendimento_id",id).order("criado_em"),
    db.from("fin_eventos").select("id,estado,nota,criado_em").eq("simulacao_id",id).order("id"),
    db.from("fin_linhas").select("lista_documentos").eq("id",sim.linha_id).single(),
  ]);
  if (atendimento.error || documentos.error || historico.error || linha.error) throw Error("Não foi possível carregar o atendimento.");
  if (!dono.data && atendimento.data?.revogado_em) return null;
  return { proprio: !!dono.data, id, espelho: sim.espelho as Espelho, atendimento: atendimento.data, documentos: documentos.data,
    eventos: historico.data.map(e => ({...e, estado:estadoLegivel(e.estado)})), modelos: linha.data.lista_documentos as string[] };
}

