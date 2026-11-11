import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { SETOR_IDS, TAREFA_STATUS_ABERTOS, type SetorId } from "@/lib/setores";
import { briefing } from "@/lib/ia/central";
import { iaConfigurada } from "@/lib/ia/config";

/**
 * Resumo do dia pela IA ("ARINI proativa"). escopo = "eu" (o que é meu) ou
 * "setor:<id>" (o setor inteiro). Fica guardado por dia; ?novo=1 refaz.
 */
const FECHADAS = "(fechado,pos_venda,perdido)";

export async function GET(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  if (!iaConfigurada()) return NextResponse.json({ desligada: true });
  const u = new URL(request.url);
  const escopo = u.searchParams.get("escopo") ?? "eu";
  const setor = escopo.startsWith("setor:") ? (escopo.slice(6) as SetorId) : null;
  if (setor && (!SETOR_IDS.includes(setor) || !temSetor(a, setor))) return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  if (!setor && escopo !== "eu") return NextResponse.json({ error: "Escopo inválido." }, { status: 400 });

  const admin = supabaseAdmin();
  const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  if (u.searchParams.get("novo") !== "1") {
    const { data: cache } = await admin.from("ia_resumos").select("texto, created_at").eq("user_id", a.userId).eq("escopo", escopo).eq("dia", dia).maybeSingle();
    if (cache) return NextResponse.json({ texto: cache.texto, em: cache.created_at });
  }

  const agora = new Date().toISOString();
  const retrato: Record<string, unknown> = { hoje: dia };
  let tq = admin.from("tasks").select("codigo, titulo, status, prioridade, prazo, setor, escalonada_em, aceite_em, origem")
    .in("status", TAREFA_STATUS_ABERTOS).order("prazo", { ascending: true, nullsFirst: false }).limit(60);
  tq = setor ? tq.eq("setor", setor) : tq.eq("responsavel", a.userId);
  const { data: tarefas } = await tq;
  retrato.tarefas = tarefas ?? [];

  if (!setor || setor === "comercial") {
    let oq = admin.from("opportunities").select("codigo, etapa, prazo_atendimento, primeiro_atendimento_em, updated_at")
      .not("etapa", "in", FECHADAS).order("updated_at").limit(60);
    oq = setor ? oq : oq.eq("responsavel_user_id", a.userId);
    const { data: opps } = await oq;
    retrato.oportunidades = (opps ?? []).map((o) => ({
      ...o, sem_contato: !o.primeiro_atendimento_em, contato_atrasado: !o.primeiro_atendimento_em && !!o.prazo_atendimento && o.prazo_atendimento < agora,
      dias_parada: Math.floor((Date.now() - +new Date(o.updated_at)) / 86_400_000),
    }));
    const { data: visitas } = await admin.from("visits").select("data_hora, status, relatorio_em, opportunity:opportunities(codigo, responsavel_user_id)")
      .eq("status", "realizada").is("relatorio_em", null).limit(30);
    retrato.visitas_sem_relatorio = (visitas ?? []).filter((v) => setor || (v.opportunity as unknown as { responsavel_user_id: string } | null)?.responsavel_user_id === a.userId)
      .map((v) => ({ quando: v.data_hora, oportunidade: (v.opportunity as unknown as { codigo: string } | null)?.codigo }));
  }
  if (setor === "financeiro" || setor === "diretoria") {
    const { data: desp } = await admin.from("despesas").select("codigo, descricao, valor, status, vencimento").in("status", ["pendente", "aprovada"]).order("vencimento").limit(40);
    retrato.despesas_em_aberto = desp ?? [];
    const { data: res } = await admin.rpc("fn_resultado_mensal", { p_meses: 2 });
    retrato.resultado_ultimos_meses = res ?? [];
  }
  if (setor === "operacoes") {
    const { data: cad } = await admin.from("properties").select("codigo, status, updated_at").in("status", ["pendente", "em_analise", "correcao"]).order("updated_at").limit(40);
    retrato.cadastros_em_analise = cad ?? [];
  }
  if (setor === "marketing") {
    const { data: pub } = await admin.from("publicacoes").select("canal, status, agendada_para, property:properties(codigo)").in("status", ["rascunho", "aprovacao", "agendada", "erro"]).limit(40);
    retrato.publicacoes = pub ?? [];
  }
  if (setor === "diretoria") {
    const { data: esc } = await admin.from("tasks").select("codigo, titulo, setor, escalonada_em").not("escalonada_em", "is", null).in("status", TAREFA_STATUS_ABERTOS).limit(30);
    retrato.escalonadas = esc ?? [];
  }

  const pedido = setor
    ? `Escreva o briefing do dia do setor "${setor}" para quem coordena o setor: o que está atrasado, parado ou travado, e o que fazer primeiro.`
    : "Escreva o briefing do dia desta pessoa: o que ela deve fazer primeiro e por quê.";
  try {
    const r = await briefing(pedido, retrato);
    if (!r) return NextResponse.json({ desligada: true });
    await admin.from("ia_resumos").upsert({ user_id: a.userId, escopo, dia, texto: r.texto, modelo: r.modelo, created_at: agora }, { onConflict: "user_id,escopo,dia" });
    return NextResponse.json({ texto: r.texto, em: agora });
  } catch (e) {
    console.error("ia resumo:", e);
    return NextResponse.json({ error: "A IA não respondeu agora. Tente de novo em instantes." }, { status: 503 });
  }
}
