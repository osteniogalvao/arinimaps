import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail, emailDoProfile } from "@/lib/notify";
import { temSetor, type Ator } from "@/lib/authz";
import { DIAS_SEM_ATUALIZACAO, HORAS_SEM_FEEDBACK, VISITA_LABEL, dataHoraBR } from "./textos";

/**
 * Acompanhamento do proprietário (item 28) e Minha área (item 29) — lado do
 * servidor. As tabelas novas (migration 0060) podem ainda não existir: toda
 * leitura delas trata o erro e devolve vazio, sem derrubar a página.
 */

const ENCERRADAS = ["fechado", "pos_venda", "perdido"];
const SITE = () => process.env.NEXT_PUBLIC_SITE_URL ?? "https://arinibrasil.com.br";

/** O usuário é o anunciante deste imóvel (proprietário ou parceiro que anunciou)? */
export async function ehAnuncianteDoImovel(a: Ator, propertyId: string) {
  if (!a.ownerId && !a.partnerId) return false;
  const { data: p } = await supabaseAdmin()
    .from("properties").select("owner_id, partner_id").eq("id", propertyId).maybeSingle();
  if (!p) return false;
  return (!!a.ownerId && p.owner_id === a.ownerId) || (!!a.partnerId && p.partner_id === a.partnerId);
}

/** Dono do imóvel ou a Central (setores que atendem o anunciante). */
export async function podeVerAreaDoImovel(a: Ator, propertyId: string) {
  if (a.ehArini) return temSetor(a, "operacoes", "cartografia", "comercial");
  return ehAnuncianteDoImovel(a, propertyId);
}

/**
 * O usuário é intermediador responsável por alguma oportunidade aberta deste
 * imóvel? Central: setor Comercial (oportunidades conduzidas pela Arini, ou
 * qualquer uma — a Central supervisiona). Parceiro: a que foi encaminhada a ele.
 */
export async function ehIntermediadorDoImovel(a: Ator, propertyId: string) {
  if (a.ehArini) return temSetor(a, "comercial");
  if (!a.partnerId) return false;
  const { count } = await supabaseAdmin().from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId).eq("responsavel_partner_id", a.partnerId)
    .not("etapa", "in", `(${ENCERRADAS.join(",")})`);
  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Aviso ao proprietário — canal isolado
// ---------------------------------------------------------------------------

export type Destinatario = { userId: string; email: string | null; telefone: string | null; nome: string };
export type Aviso = { assunto: string; texto: string };

/**
 * ÚNICO ponto de saída dos avisos ao proprietário. Hoje: e-mail (Resend).
 * Quando houver a WhatsApp Business API, acrescente aqui o envio pelo
 * `destinatario.telefone` — quem chama não muda.
 */
export async function enviarAvisoProprietario(destinatario: Destinatario, aviso: Aviso) {
  await sendEmail(destinatario.email, aviso.assunto, aviso.texto);
}

/** Quem recebe os avisos do imóvel: o proprietário; sem ele, o parceiro que anunciou. */
export async function destinatarioDoImovel(propertyId: string): Promise<(Destinatario & { codigo: string; titulo: string }) | null> {
  const admin = supabaseAdmin();
  const { data: p } = await admin.from("properties")
    .select("codigo, titulo, owner:owners(profile_id), partner:partners(profile_id)")
    .eq("id", propertyId).maybeSingle();
  if (!p) return null;
  const um = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const userId = um(p.owner as unknown as { profile_id: string } | null)?.profile_id
    ?? um(p.partner as unknown as { profile_id: string } | null)?.profile_id;
  if (!userId) return null;
  const [{ data: perfil }, email] = await Promise.all([
    admin.from("profiles").select("nome, telefone").eq("user_id", userId).maybeSingle(),
    emailDoProfile(userId),
  ]);
  return {
    userId, email, telefone: (perfil?.telefone as string | null) ?? null, nome: (perfil?.nome as string) ?? "",
    codigo: p.codigo as string, titulo: p.titulo as string,
  };
}

/**
 * Visita agendada ou com feedback: avisa o proprietário (rota das oportunidades).
 * Nunca lança — o aviso não pode derrubar o registro da visita.
 */
export async function avisarVisitaAoProprietario(dados: {
  opportunityId: string; autorId: string; status: string; dataHora?: string | null; feedback?: string | null;
}) {
  try {
    const admin = supabaseAdmin();
    const { data: opp } = await admin.from("opportunities").select("property_id").eq("id", dados.opportunityId).maybeSingle();
    if (!opp) return;
    const d = await destinatarioDoImovel(opp.property_id);
    if (!d || d.userId === dados.autorId) return;
    const quando = dados.dataHora ? ` para ${dataHoraBR(dados.dataHora)}` : "";
    const rotulo = VISITA_LABEL[dados.status] ?? "Visita atualizada";
    const link = `${SITE()}/painel/imoveis/${opp.property_id}/acompanhamento`;
    const texto = dados.status === "agendada"
      ? `Uma visita ao seu imóvel ${d.codigo} (${d.titulo}) foi agendada${quando}.\n\nAcompanhe as visitas, o retorno de cada uma e as propostas em:\n${link}`
      : `${rotulo} no seu imóvel ${d.codigo} (${d.titulo}).${dados.feedback ? `\n\nRetorno do intermediador: ${dados.feedback}` : ""}\n\nVeja o acompanhamento completo em:\n${link}`;
    await enviarAvisoProprietario(d, { assunto: `${rotulo} — ${d.codigo}`, texto });
  } catch (e) {
    console.error("aviso de visita ao proprietário falhou:", e);
  }
}

// ---------------------------------------------------------------------------
// Acompanhamento (visão do proprietário)
// ---------------------------------------------------------------------------

export type EventoLinha = {
  id: string; quando: string; tipo: "visita" | "proposta";
  titulo: string; detalhe: string | null; interessado: string; status: string;
};

export type Intermediador = {
  tipo: "arini" | "parceiro" | "proprietario" | "nenhum";
  nome: string; telefone: string | null;
};

export type Acompanhamento = {
  linha: EventoLinha[];
  propostas: { id: string; interessado: string; rodada: number; lado: string; valor: number; status: string; quando: string }[];
  proximosPassos: { texto: string; atualizadoEm: string } | null;
  intermediador: Intermediador;
  oportunidadesAbertas: number;
  visitas: { agendadas: number; realizadas: number };
};

export async function carregarAcompanhamento(propertyId: string): Promise<Acompanhamento> {
  const admin = supabaseAdmin();
  const { data: opps } = await admin.from("opportunities")
    .select("id, etapa, responsavel_tipo, responsavel_partner_id, created_at")
    .eq("property_id", propertyId).order("created_at").limit(100);
  const lista = opps ?? [];
  const ids = lista.map((o) => o.id);
  // interessado anônimo: o proprietário não vê nome nem contato do comprador
  const apelido = new Map(lista.map((o, i) => [o.id, `Interessado ${i + 1}`]));

  const [{ data: visitas }, { data: propostas }, acomp, { data: whats }] = await Promise.all([
    ids.length
      ? admin.from("visits").select("id, opportunity_id, data_hora, status, feedback, updated_at").in("opportunity_id", ids).order("data_hora", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as { id: string; opportunity_id: string; data_hora: string; status: string; feedback: string | null; updated_at: string }[] }),
    ids.length
      ? admin.from("proposals").select("id, opportunity_id, numero_rodada, autor_lado, valor, status, created_at").in("opportunity_id", ids).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as { id: string; opportunity_id: string; numero_rodada: number; autor_lado: string; valor: number; status: string; created_at: string }[] }),
    admin.from("property_acompanhamento").select("proximos_passos, atualizado_em").eq("property_id", propertyId).maybeSingle()
      .then((r) => (r.error ? null : r.data)),
    admin.from("settings").select("valor").eq("chave", "whatsapp_central").maybeSingle(),
  ]);

  const linha: EventoLinha[] = [
    ...(visitas ?? []).map((v) => ({
      id: `v-${v.id}`, quando: v.data_hora, tipo: "visita" as const,
      titulo: VISITA_LABEL[v.status] ?? "Visita", detalhe: v.feedback?.trim() || null,
      interessado: apelido.get(v.opportunity_id) ?? "Interessado", status: v.status as string,
    })),
    ...(propostas ?? []).map((p) => ({
      id: `p-${p.id}`, quando: p.created_at, tipo: "proposta" as const,
      titulo: p.autor_lado === "vendedor" ? `Contraproposta enviada (rodada ${p.numero_rodada})` : `Proposta recebida (rodada ${p.numero_rodada})`,
      detalhe: Number(p.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }),
      interessado: apelido.get(p.opportunity_id) ?? "Interessado", status: p.status as string,
    })),
  ].sort((a, b) => +new Date(b.quando) - +new Date(a.quando));

  // intermediador: o da oportunidade aberta mais recente
  const abertas = lista.filter((o) => !ENCERRADAS.includes(o.etapa));
  const ref = abertas[abertas.length - 1] ?? null;
  let intermediador: Intermediador = { tipo: "nenhum", nome: "Central Arini", telefone: typeof whats?.valor === "string" ? whats.valor : null };
  if (ref?.responsavel_tipo === "arini") intermediador = { ...intermediador, tipo: "arini" };
  else if (ref?.responsavel_tipo === "proprietario") intermediador = { tipo: "proprietario", nome: "Você conduz o atendimento", telefone: null };
  else if (ref?.responsavel_tipo === "parceiro" && ref.responsavel_partner_id) {
    const { data: pa } = await admin.from("partners")
      .select("razao_social, perfil:profiles(nome, telefone)").eq("id", ref.responsavel_partner_id).maybeSingle();
    const perfil = (Array.isArray(pa?.perfil) ? pa?.perfil[0] : pa?.perfil) as { nome?: string; telefone?: string | null } | null;
    intermediador = { tipo: "parceiro", nome: perfil?.nome || pa?.razao_social || "Corretor parceiro", telefone: perfil?.telefone ?? null };
  }

  return {
    linha,
    propostas: (propostas ?? []).map((p) => ({
      id: p.id, interessado: apelido.get(p.opportunity_id) ?? "Interessado", rodada: p.numero_rodada,
      lado: p.autor_lado, valor: Number(p.valor), status: p.status, quando: p.created_at,
    })),
    proximosPassos: acomp?.proximos_passos?.trim()
      ? { texto: acomp.proximos_passos, atualizadoEm: acomp.atualizado_em }
      : null,
    intermediador,
    oportunidadesAbertas: abertas.length,
    visitas: {
      agendadas: (visitas ?? []).filter((v) => v.status === "agendada").length,
      realizadas: (visitas ?? []).filter((v) => v.status === "realizada").length,
    },
  };
}

export type Lembrete = { id: string; data: string; texto: string; enviado_em: string | null };

/** Lembretes do proprietário neste imóvel. null = tabela ainda não criada (recurso escondido). */
export async function lembretesDoImovel(propertyId: string, userId: string): Promise<Lembrete[] | null> {
  const { data, error } = await supabaseAdmin().from("property_lembretes")
    .select("id, data, texto, enviado_em").eq("property_id", propertyId).eq("user_id", userId)
    .order("data").limit(100);
  if (error) return null;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Pendências do intermediador
// ---------------------------------------------------------------------------

export type Pendencias = {
  visitasSemFeedback: { visitaId: string; opportunityId: string; codigoOpp: string; imovel: string; dataHora: string }[];
  semAtualizacao: {
    propertyId: string; codigo: string; titulo: string; ultima: string;
    proprietario: string; telefone: string | null; proximosPassos: string;
  }[];
  total: number;
};

/**
 * Pendências do intermediador responsável: visita realizada sem feedback há
 * mais de 48 h e proprietário sem atualização há 7 dias. `escopo`: o parceiro
 * (oportunidades encaminhadas a ele) ou a Central (conduzidas pela Arini).
 */
export async function pendenciasIntermediador(escopo: { partnerId: string } | { central: true }): Promise<Pendencias> {
  const admin = supabaseAdmin();
  let q = admin.from("opportunities")
    .select("id, codigo, property_id, created_at, property:properties(codigo, titulo, status)")
    .not("etapa", "in", `(${ENCERRADAS.join(",")})`).limit(500);
  q = "partnerId" in escopo ? q.eq("responsavel_partner_id", escopo.partnerId) : q.eq("responsavel_tipo", "arini");
  const { data: opps } = await q;
  const lista = (opps ?? []).map((o) => ({
    ...o, property: (Array.isArray(o.property) ? o.property[0] : o.property) as { codigo: string; titulo: string; status: string } | null,
  }));
  if (!lista.length) return { visitasSemFeedback: [], semAtualizacao: [], total: 0 };
  const ids = lista.map((o) => o.id);
  const propIds = [...new Set(lista.map((o) => o.property_id))];

  const [{ data: visitas }, { data: propostas }, acomps] = await Promise.all([
    admin.from("visits").select("id, opportunity_id, data_hora, status, feedback, updated_at").in("opportunity_id", ids).limit(2000),
    admin.from("proposals").select("opportunity_id, created_at").in("opportunity_id", ids).limit(2000),
    admin.from("property_acompanhamento").select("property_id, proximos_passos, atualizado_em").in("property_id", propIds)
      .then((r) => (r.error ? [] : r.data ?? [])),
  ]);

  const limiteFeedback = Date.now() - HORAS_SEM_FEEDBACK * 3_600_000;
  const porOpp = new Map(lista.map((o) => [o.id, o]));
  const visitasSemFeedback = (visitas ?? [])
    .filter((v) => v.status === "realizada" && !v.feedback?.trim() && +new Date(v.data_hora) < limiteFeedback)
    .map((v) => {
      const o = porOpp.get(v.opportunity_id)!;
      return { visitaId: v.id, opportunityId: v.opportunity_id, codigoOpp: o.codigo, imovel: o.property ? `${o.property.codigo} — ${o.property.titulo}` : "", dataHora: v.data_hora };
    })
    .sort((a, b) => +new Date(a.dataHora) - +new Date(b.dataHora));

  // última coisa que o proprietário viu mudar: visita, proposta, próximos passos ou a própria oportunidade
  const ultima = new Map<string, number>();
  const marca = (pid: string, d: string | null | undefined) => {
    if (!d) return;
    const t = +new Date(d);
    if (t > (ultima.get(pid) ?? 0)) ultima.set(pid, t);
  };
  for (const o of lista) marca(o.property_id, o.created_at);
  for (const v of visitas ?? []) marca(porOpp.get(v.opportunity_id)!.property_id, v.updated_at);
  for (const p of propostas ?? []) marca(porOpp.get(p.opportunity_id)!.property_id, p.created_at);
  const passos = new Map<string, string>();
  for (const a of acomps as { property_id: string; proximos_passos: string; atualizado_em: string }[]) {
    marca(a.property_id, a.atualizado_em);
    passos.set(a.property_id, a.proximos_passos ?? "");
  }

  const limiteAtualizacao = Date.now() - DIAS_SEM_ATUALIZACAO * 86_400_000;
  const atrasados = propIds.filter((pid) => (ultima.get(pid) ?? 0) < limiteAtualizacao).slice(0, 50);
  const semAtualizacao: Pendencias["semAtualizacao"] = [];
  for (const pid of atrasados) {
    const o = lista.find((x) => x.property_id === pid)!;
    const d = await destinatarioDoImovel(pid);
    semAtualizacao.push({
      propertyId: pid, codigo: o.property?.codigo ?? "", titulo: o.property?.titulo ?? "",
      ultima: new Date(ultima.get(pid) ?? 0).toISOString(),
      proprietario: d?.nome || "Proprietário", telefone: d?.telefone ?? null,
      proximosPassos: passos.get(pid) ?? "",
    });
  }
  semAtualizacao.sort((a, b) => +new Date(a.ultima) - +new Date(b.ultima));

  return { visitasSemFeedback, semAtualizacao, total: visitasSemFeedback.length + semAtualizacao.length };
}
