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
  const tarefas = dentro(db.from("tasks").select("id,setor,titulo,prazo,responsavel").in("setor", setores).in("status", ["aberta", "andamento", "aguardando", "bloqueada"]), "prazo").order("prazo").limit(501);
  const crm = db.from("crm_itens").select("id,titulo,prazo_etapa,responsavel,pipeline:crm_pipelines!inner(setor)")
    .in("pipeline.setor", setores).eq("status", "aberto").gte("prazo_etapa", de + "T00:00:00-03:00").lte("prazo_etapa", ate + "T23:59:59-03:00").order("prazo_etapa").limit(501);
  await Promise.all([
    tarefas.then(r => receber("Tarefas", r, x => ({ id: String(x.id), setor: String(x.setor), tipo: "Tarefa", titulo: String(x.titulo), data: String(x.prazo), href: `/admin/tarefas/${x.id}`, responsavel: (x.responsavel as string | null) ?? null }))),
    crm.then(r => receber("CRM", r, x => ({ id: String(x.id), setor: String((x.pipeline as { setor: string }).setor), tipo: "Prazo do CRM", titulo: String(x.titulo), data: new Date(String(x.prazo_etapa)).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }), href: `/admin/crm/item/${x.id}`, responsavel: (x.responsavel as string | null) ?? null }))),
    // reuniões marcadas na própria agenda (0169): eram salvas, mas não apareciam na lista
    db.from("agenda_reunioes").select("id,setor,titulo,responsavel,inicio,status").in("setor", setores).neq("status", "cancelada")
      .gte("inicio", de + "T00:00:00-03:00").lte("inicio", ate + "T23:59:59-03:00").order("inicio").limit(501)
      .then(r => receber("Reuniões", r, x => {
        const inicio = new Date(String(x.inicio));
        return {
          id: String(x.id), setor: String(x.setor), tipo: x.status === "concluida" ? "Reunião concluída" : "Reunião", titulo: String(x.titulo),
          data: inicio.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
          hora: inicio.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
          href: `/admin/agenda-setores?reuniao=${x.id}#reuniao`, responsavel: (x.responsavel as string | null) ?? null,
        };
      })),
    // Comercial: visitas marcadas e próximos contatos do funil (antes só na agenda comercial)
    ...(setores.includes("comercial") ? [
      db.from("visits").select("id,data_hora,status,responsavel,opportunity:opportunities!inner(id,codigo,responsavel_user_id,lead:leads(nome))")
        .neq("status", "cancelada").gte("data_hora", de + "T00:00:00-03:00").lte("data_hora", ate + "T23:59:59-03:00").order("data_hora").limit(501)
        .then(r => receber("Visitas", r, x => {
          const o = x.opportunity as { id: string; codigo: string; responsavel_user_id: string | null; lead: { nome: string } | null };
          const quando = new Date(String(x.data_hora));
          return {
            id: String(x.id), setor: "comercial", tipo: "Visita", titulo: `${o.codigo}${o.lead?.nome ? " · " + o.lead.nome : ""}`,
            data: quando.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
            hora: quando.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
            href: `/admin/oportunidades/${o.id}`, responsavel: (x.responsavel as string | null) ?? o.responsavel_user_id ?? null,
          };
        })),
      db.from("oportunidades_oficiais").select("id,codigo,proxima_acao,proxima_acao_em,responsavel_user_id,lead:leads(nome)")
        .not("etapa", "in", "(fechado,pos_venda,perdido)").gte("proxima_acao_em", de + "T00:00:00-03:00").lte("proxima_acao_em", ate + "T23:59:59-03:00").order("proxima_acao_em").limit(501)
        .then(r => receber("Próximos contatos", r, x => {
          const quando = new Date(String(x.proxima_acao_em));
          const lead = x.lead as { nome: string } | null;
          return {
            id: String(x.id), setor: "comercial", tipo: "Próximo contato", titulo: `${x.codigo}${lead?.nome ? " · " + lead.nome : ""}${x.proxima_acao ? " · " + x.proxima_acao : ""}`,
            data: quando.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
            hora: quando.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
            href: `/admin/oportunidades/${x.id}`, responsavel: (x.responsavel_user_id as string | null) ?? null,
          };
        })),
    ] : []),
    ...(setores.includes("juridico") ? [
      dentro(db.from("lgpd_requests").select("id,codigo,tipo,prazo").in("status", ["recebido", "em_analise"]), "prazo").order("prazo").limit(501)
        .then(r => receber("Pedidos de titulares", r, x => ({ id: String(x.id), setor: "juridico", tipo: "LGPD", titulo: `${x.codigo} · ${x.tipo}`, data: String(x.prazo), href: "/admin/juridico/lgpd" }))),
      dentro(db.from("property_authorizations").select("id,validade,property:properties!inner(id,codigo,titulo,status)").in("property.status", ["pendente", "em_analise", "correcao", "aprovado", "publicado", "em_negociacao"]), "validade").order("validade").limit(501)
        .then(r => receber("Autorizações", r, x => { const p = x.property as { id: string; codigo: string; titulo: string }; return { id: String(x.id), setor: "juridico", tipo: "Autorização", titulo: `${p.codigo} · ${p.titulo}`, data: String(x.validade), href: "/admin/juridico" }; })),
    ] : []),
    ...(setores.includes("financeiro") ? [
      dentro(db.from("despesas").select("id,codigo,descricao,vencimento").in("status", ["pendente", "aprovada"]), "vencimento").order("vencimento").limit(501)
        .then(r => receber("Despesas", r, x => ({ id: String(x.id), setor: "financeiro", tipo: "Despesa", titulo: `${x.codigo} · ${x.descricao}`, data: String(x.vencimento), href: "/admin/registros/despesas" }))),
      dentro(db.from("alugueis_parcelas").select("id,competencia,vencimento").in("status", ["pendente", "atrasado"]), "vencimento").order("vencimento").limit(501)
        .then(r => receber("Aluguéis", r, x => ({ id: String(x.id), setor: "financeiro", tipo: "Aluguel", titulo: `Parcela ${x.competencia}`, data: String(x.vencimento), href: "/admin/financeiro/alugueis" }))),
    ] : []),
  ]);
  return { itens: ordenarAgenda(itens, setores, de, ate), falhas, limitado };
}
