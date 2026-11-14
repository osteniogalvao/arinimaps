import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { SETOR_IDS, setorPorId, type SetorId } from "@/lib/setores";
import { eventoTarefa, prazoAceite } from "@/lib/central";
import { emailDoProfile, sendEmail } from "@/lib/notify";

const STATUS = ["aberta", "andamento", "aguardando", "bloqueada", "concluida", "cancelada"];
const PRIORIDADES = ["baixa", "normal", "alta"];
const nomeSetor = (id: string | null | undefined) => (id ? setorPorId(id)?.nome ?? id : "—");

/**
 * Tarefas internas por setor (Central operacional, migration 0065).
 *
 * POST cria. Se o setor de destino não é um dos seus, a tarefa vai como
 * "encaminhada": o setor recebe na caixa de entrada e precisa aceitar dentro
 * do prazo, senão ela sobe para a Diretoria (fn_central_automacoes).
 */
export async function POST(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe da Arini." }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const setor = String(b.setor ?? "") as SetorId;
  if (!SETOR_IDS.includes(setor)) return NextResponse.json({ error: "Setor inválido." }, { status: 400 });
  const titulo = String(b.titulo ?? "").trim();
  if (titulo.length < 3) return NextResponse.json({ error: "Descreva a tarefa em pelo menos 3 letras." }, { status: 400 });

  // encaminhar para um setor em que não atuo: preciso dizer de qual setor meu ela sai
  const meu = temSetor(a, setor);
  const origem = String(b.setor_origem ?? "") as SetorId;
  if (!meu && !(SETOR_IDS.includes(origem) && temSetor(a, origem))) {
    return NextResponse.json({ error: "Escolha de qual dos seus setores sai o encaminhamento." }, { status: 400 });
  }
  const encaminhada = !meu || (!!b.setor_origem && origem !== setor && temSetor(a, origem));

  const admin = supabaseAdmin();
  const base = {
    titulo: titulo.slice(0, 200),
    descricao: b.descricao ? String(b.descricao).slice(0, 4000) : null,
    setor,
    // quem encaminha não escolhe a pessoa do outro setor: o setor atribui ao aceitar
    responsavel: encaminhada ? null : b.responsavel || null,
    criado_por: a.userId,
    prazo: b.prazo || null,
    prioridade: PRIORIDADES.includes(b.prioridade) ? b.prioridade : "normal",
    property_id: b.property_id || null,
    opportunity_id: b.opportunity_id || null,
  };
  const extra = {
    origem: encaminhada ? "encaminhada" : "manual",
    setor_origem: encaminhada ? origem : null,
    prazo_aceite: encaminhada ? await prazoAceite() : null,
    aceite_em: encaminhada ? null : new Date().toISOString(),
    aceite_por: encaminhada ? null : a.userId,
    criterio_conclusao: b.criterio_conclusao ? String(b.criterio_conclusao).slice(0, 600) : null,
  };
  let { data, error } = await admin.from("tasks").insert({ ...base, ...extra }).select("id").single();
  if (error && /origem|setor_origem|prazo_aceite|aceite_|criterio/.test(error.message)) {
    // banco sem a 0065: só tarefa do próprio setor, como antes
    if (encaminhada) return NextResponse.json({ error: "Encaminhar para outro setor exige a atualização da Central (migration 0065)." }, { status: 400 });
    ({ data, error } = await admin.from("tasks").insert(base).select("id").single());
  }
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Não foi possível criar." }, { status: 400 });

  await eventoTarefa(encaminhada
    ? { task_id: data.id, tipo: "encaminhada", autor: a.userId, de_setor: origem, para_setor: setor, texto: base.descricao }
    : { task_id: data.id, tipo: "criada", autor: a.userId, para_setor: setor });
  await logAudit({ user_id: a.userId, acao: encaminhada ? "tarefa_encaminhada" : "tarefa_criada", entidade: "tasks", entidade_id: data.id, dados_depois: { setor, setor_origem: extra.setor_origem, titulo } });
  if (base.responsavel && base.responsavel !== a.userId) await avisarResponsavel(base.responsavel, titulo, data.id);
  return NextResponse.json({ ok: true, id: data.id });
}

type Antes = {
  setor: string; status: string; responsavel: string | null; titulo: string; origem?: string | null;
  setor_origem?: string | null; aceite_em?: string | null; prioridade: string; prazo: string | null; updated_at: string;
};

/**
 * PATCH { id, acao?, ... }
 *  - sem acao: muda status, responsável, prazo ou prioridade (como antes)
 *  - aceitar | recusar (motivo) | encaminhar (setor, motivo) | comentar (texto) | evidencia (texto)
 */
export async function PATCH(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe da Arini." }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();
  const primeira = await admin.from("tasks")
    .select("setor, status, responsavel, titulo, origem, setor_origem, aceite_em, prioridade, prazo, updated_at").eq("id", b.id).maybeSingle<Antes>();
  let antes = primeira.data;
  if (primeira.error) ({ data: antes } = await admin.from("tasks").select("setor, status, responsavel, titulo, prioridade, prazo, updated_at").eq("id", b.id).maybeSingle<Antes>());
  if (!antes) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });

  const doSetor = temSetor(a, antes.setor as SetorId);
  const quemEnviou = !!antes.setor_origem && temSetor(a, antes.setor_origem as SetorId);
  const acao = String(b.acao ?? "");

  // quem encaminhou pode acompanhar e comentar; agir na tarefa é do setor que a recebeu
  if (acao === "comentar") {
    if (!doSetor && !quemEnviou) return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
    const texto = String(b.texto ?? "").trim().slice(0, 2000);
    if (!texto) return NextResponse.json({ error: "Escreva o comentário." }, { status: 400 });
    await eventoTarefa({ task_id: b.id, tipo: "comentario", autor: a.userId, texto });
    return NextResponse.json({ ok: true });
  }
  if (!doSetor) return NextResponse.json({ error: "Esta tarefa é de um setor em que você não atua." }, { status: 403 });

  const agora = new Date().toISOString();
  const versao = antes.updated_at;
  const atualizar = async (patch: Record<string, unknown>) => {
    const { data, error } = await admin.from("tasks").update(patch).eq("id", b.id).eq("updated_at", versao).select("id").maybeSingle();
    if (error) return { message: error.message, status: 400 };
    return data ? null : { message: "A tarefa foi alterada por outra pessoa. Atualize a página.", status: 409 };
  };

  if (acao === "aceitar") {
    if (antes.aceite_em) return NextResponse.json({ error: "Esta tarefa já foi aceita." }, { status: 409 });
    const err = await atualizar({
      aceite_em: agora, aceite_por: a.userId, responsavel: antes.responsavel ?? a.userId,
      status: antes.status === "aberta" ? "andamento" : antes.status,
    });
    if (err) return NextResponse.json({ error: err.message }, { status: err.status });
    await eventoTarefa({ task_id: b.id, tipo: "aceita", autor: a.userId, para_setor: antes.setor, texto: "Recebida e assumida pelo setor" });
    await logAudit({ user_id: a.userId, acao: "tarefa_aceita", entidade: "tasks", entidade_id: b.id });
    return NextResponse.json({ ok: true });
  }

  if (acao === "recusar") {
    const motivo = String(b.motivo ?? "").trim().slice(0, 1000);
    if (motivo.length < 5) return NextResponse.json({ error: "Explique por que o setor devolve a tarefa." }, { status: 400 });
    if (!antes.setor_origem) return NextResponse.json({ error: "Só se devolve tarefa encaminhada por outro setor." }, { status: 400 });
    const err = await atualizar({
      setor: antes.setor_origem, setor_origem: antes.setor, responsavel: null, status: "aberta",
      aceite_em: null, aceite_por: null, prazo_aceite: await prazoAceite(), escalonada_em: null, motivo,
    });
    if (err) return NextResponse.json({ error: err.message }, { status: err.status });
    await eventoTarefa({ task_id: b.id, tipo: "recusada", autor: a.userId, de_setor: antes.setor, para_setor: antes.setor_origem, texto: motivo });
    await logAudit({ user_id: a.userId, acao: "tarefa_recusada", entidade: "tasks", entidade_id: b.id, dados_depois: { motivo, devolvida_para: antes.setor_origem } });
    return NextResponse.json({ ok: true });
  }

  if (acao === "encaminhar") {
    const para = String(b.setor ?? "") as SetorId;
    if (!SETOR_IDS.includes(para) || para === antes.setor) return NextResponse.json({ error: "Escolha outro setor." }, { status: 400 });
    const motivo = String(b.motivo ?? "").trim().slice(0, 1000) || null;
    const err = await atualizar({
      setor: para, setor_origem: antes.setor, origem: "encaminhada", responsavel: null, status: "aberta",
      aceite_em: null, aceite_por: null, prazo_aceite: await prazoAceite(), escalonada_em: null,
    });
    if (err) return NextResponse.json({ error: err.message }, { status: err.status });
    await eventoTarefa({ task_id: b.id, tipo: "encaminhada", autor: a.userId, de_setor: antes.setor, para_setor: para, texto: motivo });
    await logAudit({ user_id: a.userId, acao: "tarefa_encaminhada", entidade: "tasks", entidade_id: b.id, dados_antes: { setor: antes.setor }, dados_depois: { setor: para, motivo } });
    return NextResponse.json({ ok: true });
  }

  if (acao === "evidencia") {
    const texto = String(b.texto ?? "").trim().slice(0, 2000);
    if (!texto) return NextResponse.json({ error: "Descreva o que foi feito." }, { status: 400 });
    const err = await atualizar({ evidencia: texto });
    if (err) return NextResponse.json({ error: err.message }, { status: err.status });
    await eventoTarefa({ task_id: b.id, tipo: "evidencia", autor: a.userId, texto });
    return NextResponse.json({ ok: true });
  }

  // ---- campos simples (lista e detalhe)
  const patch: Record<string, unknown> = {};
  if (b.status !== undefined) {
    if (!STATUS.includes(b.status)) return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    if (["aguardando", "bloqueada", "cancelada"].includes(b.status) && antes.origem && !String(b.motivo ?? "").trim()) {
      return NextResponse.json({ error: "Diga o motivo." }, { status: 400 });
    }
    patch.status = b.status;
    patch.concluida_em = b.status === "concluida" ? agora : null;
    if (b.status === "concluida" && b.evidencia) patch.evidencia = String(b.evidencia).slice(0, 2000);
    if (b.motivo) patch.motivo = String(b.motivo).slice(0, 1000);
    // concluir uma tarefa encaminhada também conta como aceite
    if (antes.origem === "encaminhada" && !antes.aceite_em) Object.assign(patch, { aceite_em: agora, aceite_por: a.userId });
  }
  if (b.responsavel !== undefined) patch.responsavel = b.responsavel || null;
  if (b.prazo !== undefined) patch.prazo = b.prazo || null;
  if (b.prioridade !== undefined && PRIORIDADES.includes(b.prioridade)) patch.prioridade = b.prioridade;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });

  let err = await atualizar(patch);
  if (err && /aceite_|evidencia|motivo/.test(err.message)) {
    // banco sem a 0065
    delete patch.aceite_em; delete patch.aceite_por; delete patch.evidencia; delete patch.motivo;
    err = await atualizar(patch);
  }
  if (err) return NextResponse.json({ error: err.message }, { status: err.status });

  if (patch.status && patch.status !== antes.status) {
    await eventoTarefa({ task_id: b.id, tipo: "status", autor: a.userId, texto: [b.motivo, b.evidencia].filter(Boolean).join(" · ") || null, dados: { de: antes.status, para: patch.status } });
  }
  if (patch.responsavel !== undefined && patch.responsavel !== antes.responsavel) {
    await eventoTarefa({ task_id: b.id, tipo: "responsavel", autor: a.userId, dados: { de: antes.responsavel, para: patch.responsavel } });
    if (patch.responsavel && patch.responsavel !== a.userId) await avisarResponsavel(patch.responsavel as string, antes.titulo, b.id);
  }
  if (patch.prazo !== undefined && patch.prazo !== antes.prazo) {
    await eventoTarefa({ task_id: b.id, tipo: "prazo", autor: a.userId, dados: { de: antes.prazo, para: patch.prazo } });
  }
  await logAudit({ user_id: a.userId, acao: "tarefa_alterada", entidade: "tasks", entidade_id: b.id, dados_antes: antes, dados_depois: patch });
  return NextResponse.json({ ok: true, setor: nomeSetor(antes.setor) });
}

async function avisarResponsavel(userId: string, titulo: string, taskId: string) {
  const email = await emailDoProfile(userId);
  await sendEmail(email, `Tarefa para você: ${titulo}`,
    `Você é o responsável pela tarefa "${titulo}" na Central Arini.\n\n${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/tarefas/${taskId}`);
}

