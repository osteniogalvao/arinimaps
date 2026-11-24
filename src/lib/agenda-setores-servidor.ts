import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ordenarAgenda, type CompromissoSetor } from "@/lib/agenda-setores";

/** Só consulta fontes dos setores permitidos; o filtro da URL nunca amplia acesso. */
export async function lerAgendaSetores(setores: string[], de: string, ate: string) {
  const db = supabaseAdmin(), itens: CompromissoSetor[] = [], falhas: string[] = [];
  let limitado = false;
  type Linha = Record<string, unknown>;
  const receber = (fonte: string, r: { data: unknown; error: unknown }, mapear: (r: Linha) => CompromissoSetor) => {
    if (r.error) { falhas.push(fonte); return; }
    const dados = (r.data ?? []) as Linha[]; limitado ||= dados.length > 500;
    itens.push(...dados.slice(0, 500).map(mapear));
  };
  const dentro = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(q: T, coluna: string) => q.gte(coluna, de).lte(coluna, ate);
  const tarefas = dentro(db.from("tasks").select("id,setor,titulo,prazo").in("setor", setores).in("status", ["aberta", "andamento", "aguardando", "bloqueada"]), "prazo").order("prazo").limit(501);
  const crm = db.from("crm_itens").select("id,titulo,prazo_etapa,pipeline:crm_pipelines!inner(setor)")
    .in("pipeline.setor", setores).eq("status", "aberto").gte("prazo_etapa", de + "T00:00:00-03:00").lte("prazo_etapa", ate + "T23:59:59-03:00").order("prazo_etapa").limit(501);
  await Promise.all([
    tarefas.then(r => receber("Tarefas", r, x => ({ id: String(x.id), setor: String(x.setor), tipo: "Tarefa", titulo: String(x.titulo), data: String(x.prazo), href: `/admin/tarefas/${x.id}` }))),
    crm.then(r => receber("CRM", r, x => ({ id: String(x.id), setor: String((x.pipeline as { setor: string }).setor), tipo: "Prazo do CRM", titulo: String(x.titulo), data: new Date(String(x.prazo_etapa)).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }), href: `/admin/crm/item/${x.id}` }))),
    ...(setores.includes("juridico") ? [
      dentro(db.from("lgpd_requests").select("id,codigo,tipo,prazo").in("status", ["recebido", "em_analise"]), "prazo").order("prazo").limit(501)
        .then(r => receber("Pedidos de titulares", r, x => ({ id: String(x.id), setor: "juridico", tipo: "LGPD", titulo: `${x.codigo} · ${x.tipo}`, data: String(x.prazo), href: "/admin/juridico/lgpd" }))),
      dentro(db.from("property_authorizations").select("id,validade,property:properties!inner(id,codigo,titulo,status)").in("property.status", ["pendente", "em_analise", "correcao", "aprovado", "publicado", "em_negociacao"]), "validade").order("validade").limit(501)
        .then(r => receber("Autorizações", r, x => { const p = x.property as { id: string; codigo: string; titulo: string }; return { id: String(x.id), setor: "juridico", tipo: "Autorização", titulo: `${p.codigo} · ${p.titulo}`, data: String(x.validade), href: "/admin/juridico" }; })),
    ] : []),
    ...(setores.includes("financeiro") ? [
      dentro(db.from("despesas").select("id,codigo,descricao,vencimento").in("status", ["pendente", "aprovada"]), "vencimento").order("vencimento").limit(501)
        .then(r => receber("Despesas", r, x => ({ id: String(x.id), setor: "financeiro", tipo: "Despesa", titulo: `${x.codigo} · ${x.descricao}`, data: String(x.vencimento), href: "/admin/financeiro/despesas" }))),
      dentro(db.from("alugueis_parcelas").select("id,competencia,vencimento").in("status", ["pendente", "atrasado"]), "vencimento").order("vencimento").limit(501)
        .then(r => receber("Aluguéis", r, x => ({ id: String(x.id), setor: "financeiro", tipo: "Aluguel", titulo: `Parcela ${x.competencia}`, data: String(x.vencimento), href: "/admin/financeiro/alugueis" }))),
    ] : []),
  ]);
  return { itens: ordenarAgenda(itens, setores, de, ate), falhas, limitado };
}
