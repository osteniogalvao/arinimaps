import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, podeOperarOportunidade, temSetor } from "@/lib/authz";
import { CONTRATO_LABEL, ETAPAS, ETAPA_LABEL, RESPONSAVEL_LABEL } from "@/lib/funil";
import { sendEmail, ariniEmail } from "@/lib/notify";
import { avisarVisitaAoProprietario } from "@/lib/acompanhamento/servidor";
import { concluirTarefaDoEvento, marcarPrimeiroAtendimento } from "@/lib/central";
import { relatorioParaProprietario, resumoRelatorio, validarRelatorio } from "@/lib/visitas";

async function contexto(id: string) {
  const a = await ator();
  if (!a) return { erro: NextResponse.json({ error: "Sessão expirada." }, { status: 401 }) };
  if (!(await podeOperarOportunidade(a, id))) {
    return { erro: NextResponse.json({ error: "Sem acesso a esta oportunidade." }, { status: 403 }) };
  }
  return { a };
}

async function evento(oppId: string, tipo: string, descricao: string, autor: string) {
  await supabaseAdmin().from("opportunity_events").insert({
    opportunity_id: oppId, tipo, descricao, autor,
  });
}

// PATCH: etapa | encaminhar | qualificar | perder
export async function PATCH(request: Request, ctx: RouteContext<"/api/oportunidades/[id]">) {
  const { id } = await ctx.params;
  const { a, erro } = await contexto(id);
  if (erro) return erro;

  const body = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();
  const { data: antes } = await admin.from("opportunities").select("etapa, property_id").eq("id", id).single();
  if (!antes) return NextResponse.json({ error: "Oportunidade não encontrada." }, { status: 404 });

  // Central operacional (0065): o corretor assume o lead; o rodízio para de girar
  if (body.acao === "assumir") {
    if (!a!.ehArini) return NextResponse.json({ error: "Só a equipe assume leads." }, { status: 403 });
    const { error } = await admin.from("opportunities").update({
      responsavel_user_id: a!.userId,
      primeiro_atendimento_em: new Date().toISOString(),
      prazo_atendimento: null,
    }).eq("id", id);
    if (error) return NextResponse.json({ error: "A Central ainda não foi atualizada (migration 0065)." }, { status: 400 });
    await admin.from("opportunity_atribuicoes").insert({ opportunity_id: id, user_id: a!.userId, motivo: "assumiu", autor: a!.userId });
    await evento(id, "contato", "Primeiro atendimento registrado: lead assumido", a!.userId);
    await logAudit({ user_id: a!.userId, acao: "lead_assumido", entidade: "opportunities", entidade_id: id, opportunity_id: id, property_id: antes.property_id });
    return NextResponse.json({ ok: true });
  }

  // gerência ou diretoria troca o corretor responsável
  if (body.acao === "repassar") {
    if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Só o Comercial repassa leads." }, { status: 403 });
    const para = String(body.responsavel_user_id ?? "");
    const { data: membro } = await admin.from("profiles").select("user_id, nome, role, ativo")
      .eq("user_id", para).maybeSingle();
    if (!membro || !["admin_central", "analista_arini"].includes(membro.role) || membro.ativo === false) {
      return NextResponse.json({ error: "Escolha alguém da equipe." }, { status: 400 });
    }
    const minutos = Number(body.minutos) > 0 ? Number(body.minutos) : null;
    const { error } = await admin.from("opportunities").update({
      responsavel_user_id: para,
      atribuida_em: new Date().toISOString(),
      // repasse manual: recomeça o prazo do primeiro contato, se ainda não houve
      ...(minutos ? { prazo_atendimento: new Date(Date.now() + minutos * 60_000).toISOString() } : {}),
    }).eq("id", id);
    if (error) return NextResponse.json({ error: "A Central ainda não foi atualizada (migration 0065)." }, { status: 400 });
    await admin.from("opportunity_atribuicoes").insert({ opportunity_id: id, user_id: para, motivo: "manual", autor: a!.userId });
    await evento(id, "encaminhamento", `Lead repassado para ${membro.nome ?? "outro corretor"}`, a!.userId);
    await logAudit({ user_id: a!.userId, acao: "lead_repassado", entidade: "opportunities", entidade_id: id, opportunity_id: id, property_id: antes.property_id, dados_depois: { responsavel_user_id: para } });
    return NextResponse.json({ ok: true });
  }

  // qualquer ação da equipe na oportunidade conta como primeiro atendimento
  if (a!.ehArini && ["etapa", "qualificar", "encaminhar"].includes(body.acao)) await marcarPrimeiroAtendimento(id, a!.userId);

  if (body.acao === "etapa") {
    const etapa = body.etapa as string;
    if (![...ETAPAS, "perdido"].includes(etapa as never)) {
      return NextResponse.json({ error: "Etapa inválida." }, { status: 400 });
    }
    await admin.from("opportunities").update({ etapa }).eq("id", id);
    await evento(id, "mudanca_etapa", `Etapa: ${ETAPA_LABEL[antes.etapa] ?? antes.etapa} → ${ETAPA_LABEL[etapa] ?? etapa}`, a!.userId);
    // imóvel acompanha o funil: proposta em diante = em negociação
    if (["proposta_enviada", "contraproposta", "negociacao", "aceite", "contrato"].includes(etapa)) {
      await admin.from("properties").update({ status: "em_negociacao" }).eq("id", antes.property_id).eq("status", "publicado");
    }
    if (etapa === "perdido") {
      await admin.from("opportunities").update({ motivo_perda: body.motivo ?? null }).eq("id", id);
      await admin.from("properties").update({ status: "publicado" }).eq("id", antes.property_id).eq("status", "em_negociacao");
    }
    await logAudit({ user_id: a!.userId, acao: "oportunidade_etapa", entidade: "opportunities", entidade_id: id, opportunity_id: id, property_id: antes.property_id, dados_antes: { etapa: antes.etapa }, dados_depois: { etapa, motivo: body.motivo } });
    return NextResponse.json({ ok: true });
  }

  if (body.acao === "encaminhar") {
    if (!a!.ehArini) return NextResponse.json({ error: "Só a Arini encaminha oportunidades." }, { status: 403 });
    const { responsavel_tipo, responsavel_partner_id, partner_comprador_id } = body;
    if (!["arini", "parceiro", "proprietario"].includes(responsavel_tipo)) {
      return NextResponse.json({ error: "Responsável inválido." }, { status: 400 });
    }
    await admin.from("opportunities").update({
      responsavel_tipo,
      responsavel_partner_id: responsavel_tipo === "parceiro" ? responsavel_partner_id ?? null : null,
      partner_comprador_id: partner_comprador_id ?? null,
    }).eq("id", id);
    await evento(id, "encaminhamento", `Encaminhada para ${RESPONSAVEL_LABEL[responsavel_tipo] ?? responsavel_tipo}`, a!.userId);
    await logAudit({ user_id: a!.userId, acao: "oportunidade_encaminhada", entidade: "opportunities", entidade_id: id, opportunity_id: id, dados_depois: { responsavel_tipo, responsavel_partner_id, partner_comprador_id } });

    // avisa o parceiro encaminhado
    if (responsavel_tipo === "parceiro" && responsavel_partner_id) {
      const { data: pa } = await admin.from("partners").select("profile_id").eq("id", responsavel_partner_id).single();
      if (pa) {
        const { data: u } = await admin.auth.admin.getUserById(pa.profile_id);
        await sendEmail(u?.user?.email, "Nova oportunidade encaminhada — Arini Imóveis Brasil",
          `A Arini encaminhou uma oportunidade para você. Acesse o painel: ${process.env.NEXT_PUBLIC_SITE_URL}/painel/oportunidades`);
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (body.acao === "qualificar") {
    await admin.from("opportunities").update({ qualificacao: body.qualificacao ?? {} }).eq("id", id);
    await evento(id, "qualificacao", body.resumo ?? "Qualificação atualizada", a!.userId);
    await logAudit({ user_id: a!.userId, acao: "oportunidade_qualificada", entidade: "opportunities", entidade_id: id, opportunity_id: id, dados_depois: body.qualificacao });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}

// POST: subrecursos { tipo: evento | visita | visita_status | proposta | proposta_status | contrato_status | venda }
export async function POST(request: Request, ctx: RouteContext<"/api/oportunidades/[id]">) {
  const { id } = await ctx.params;
  const { a, erro } = await contexto(id);
  if (erro) return erro;

  const body = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();
  const { data: opp } = await admin.from("opportunities").select("etapa, property_id, codigo").eq("id", id).single();
  if (!opp) return NextResponse.json({ error: "Oportunidade não encontrada." }, { status: 404 });
  if (a!.ehArini && ["evento", "visita", "proposta"].includes(body.tipo)) await marcarPrimeiroAtendimento(id, a!.userId);

  switch (body.tipo) {
    case "evento": {
      if (!body.descricao?.trim()) return NextResponse.json({ error: "Escreva a anotação." }, { status: 400 });
      await evento(id, body.categoria ?? "anotacao", body.descricao.trim(), a!.userId);
      return NextResponse.json({ ok: true });
    }

    case "visita": {
      if (!body.data_hora) return NextResponse.json({ error: "Informe data e hora." }, { status: 400 });
      // datetime-local chega sem fuso: sem isso o timestamptz o lê como UTC e a visita
      // das 14:00 aparece às 11:00. O painel já manda ISO; o fuso de Brasília cobre clientes antigos.
      const bruto = String(body.data_hora);
      const quando = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(bruto) ? `${bruto}-03:00` : bruto);
      if (Number.isNaN(quando.getTime())) return NextResponse.json({ error: "Data e hora inválidas." }, { status: 400 });
      const { data: v, error } = await admin.from("visits")
        .insert({ opportunity_id: id, data_hora: quando.toISOString(), responsavel: a!.userId })
        .select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await evento(id, "anotacao", `Visita agendada para ${quando.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}`, a!.userId);
      await logAudit({ user_id: a!.userId, acao: "visita_agendada", entidade: "visits", entidade_id: v.id, opportunity_id: id, property_id: opp.property_id });
      // item 28: o proprietário é avisado (canal isolado em lib/acompanhamento)
      await avisarVisitaAoProprietario({ opportunityId: id, autorId: a!.userId, status: "agendada", dataHora: quando.toISOString() });
      return NextResponse.json({ ok: true });
    }

    case "visita_status":
    case "visita_relatorio": {
      // "visita_relatorio": relatório de uma visita já marcada como realizada
      const visitaId = body.visita_id;
      const status = body.tipo === "visita_relatorio" ? "realizada" : body.status;
      let feedback: string | null = body.feedback ?? null;
      // "cancelada" existe a partir da migration 0060 (item 28)
      if (!["realizada", "remarcada", "nao_compareceu", "cancelada"].includes(status)) {
        return NextResponse.json({ error: "Status de visita inválido." }, { status: 400 });
      }
      const patch: Record<string, unknown> = { status };
      // Central (0065): visita realizada exige o relatório estruturado
      if (status === "realizada") {
        const v = validarRelatorio(body.relatorio);
        if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });
        feedback = relatorioParaProprietario(v.relatorio);
        Object.assign(patch, { relatorio: v.relatorio, relatorio_em: new Date().toISOString(), relatorio_por: a!.userId });
      }
      patch.feedback = feedback;
      let { error: errVisita } = await admin.from("visits").update(patch).eq("id", visitaId).eq("opportunity_id", id);
      if (errVisita && /relatorio/.test(errVisita.message)) {
        // banco sem a 0065: guarda só o texto, como antes
        ({ error: errVisita } = await admin.from("visits").update({ status, feedback }).eq("id", visitaId).eq("opportunity_id", id));
      }
      if (errVisita) return NextResponse.json({ error: errVisita.message }, { status: 400 });
      const resumo = status === "realizada" && patch.relatorio ? resumoRelatorio(patch.relatorio as never) : feedback;
      await evento(id, "anotacao", `Visita ${status}${resumo ? `: ${resumo}` : ""}`, a!.userId);
      await logAudit({ user_id: a!.userId, acao: body.tipo === "visita_relatorio" ? "visita_relatorio" : `visita_${status}`, entidade: "visits", entidade_id: visitaId, opportunity_id: id, property_id: opp.property_id, dados_depois: patch.relatorio ?? null });
      if (status === "realizada" || status === "cancelada" || status === "nao_compareceu") {
        await concluirTarefaDoEvento(`visita_sem_relatorio:${visitaId}`, a!.userId,
          status === "realizada" ? "Relatório da visita preenchido" : `Visita marcada como ${status.replace("_", " ")}`);
      }
      if (body.tipo !== "visita_relatorio" || feedback) {
        await avisarVisitaAoProprietario({ opportunityId: id, autorId: a!.userId, status, feedback });
      }
      return NextResponse.json({ ok: true });
    }

    case "proposta": {
      const valor = Number(body.valor);
      if (!valor || valor <= 0) return NextResponse.json({ error: "Valor da proposta inválido." }, { status: 400 });
      const { count } = await admin.from("proposals").select("id", { count: "exact", head: true }).eq("opportunity_id", id);
      const { data: p, error } = await admin.from("proposals").insert({
        opportunity_id: id,
        numero_rodada: (count ?? 0) + 1,
        autor_lado: body.autor_lado === "vendedor" ? "vendedor" : "comprador",
        valor,
        entrada: body.entrada ? Number(body.entrada) : null,
        parcelamento: body.parcelamento ?? {},
        prazo: body.prazo ?? null,
        condicoes: body.condicoes ?? null,
        observacoes: body.observacoes ?? null,
        created_by: a!.userId,
      }).select("id, numero_rodada").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      // rodada anterior vira contraproposta
      await admin.from("proposals").update({ status: "contraproposta" })
        .eq("opportunity_id", id).eq("status", "enviada").neq("id", p.id);
      await evento(id, "anotacao", `Proposta rodada ${p.numero_rodada} (${body.autor_lado === "vendedor" ? "vendedor" : "comprador"}): R$ ${valor.toLocaleString("pt-BR")}`, a!.userId);
      await logAudit({ user_id: a!.userId, acao: "proposta_registrada", entidade: "proposals", entidade_id: p.id, opportunity_id: id, property_id: opp.property_id, dados_depois: { valor, rodada: p.numero_rodada } });
      return NextResponse.json({ ok: true });
    }

    case "proposta_status": {
      const { proposta_id, status } = body;
      if (!["aceita", "recusada"].includes(status)) {
        return NextResponse.json({ error: "Status de proposta inválido." }, { status: 400 });
      }
      await admin.from("proposals").update({ status }).eq("id", proposta_id).eq("opportunity_id", id);
      await evento(id, "anotacao", `Proposta ${status}`, a!.userId);
      await logAudit({ user_id: a!.userId, acao: `proposta_${status}`, entidade: "proposals", entidade_id: proposta_id, opportunity_id: id, property_id: opp.property_id });
      return NextResponse.json({ ok: true });
    }

    case "contrato_status": {
      if (!a!.ehArini) return NextResponse.json({ error: "Contrato é conduzido pela Arini." }, { status: 403 });
      const { status } = body;
      if (!["em_elaboracao", "assinado", "registrado"].includes(status)) {
        return NextResponse.json({ error: "Status de contrato inválido." }, { status: 400 });
      }
      await admin.from("contracts").upsert(
        {
          opportunity_id: id, status,
          assinado_at: status === "assinado" ? new Date().toISOString() : undefined,
          registrado_at: status === "registrado" ? new Date().toISOString() : undefined,
        },
        { onConflict: "opportunity_id" });
      await evento(id, "anotacao", `Contrato: ${(CONTRATO_LABEL[status] ?? status).toLowerCase()}`, a!.userId);
      await logAudit({ user_id: a!.userId, acao: `contrato_${status}`, entidade: "contracts", opportunity_id: id, property_id: opp.property_id });
      return NextResponse.json({ ok: true });
    }

    case "venda": {
      if (a!.role !== "admin_central") {
        return NextResponse.json({ error: "Só a diretoria Arini registra a venda." }, { status: 403 });
      }
      const valor = Number(body.valor_final);
      const percentual = Number(body.percentual ?? 1);
      if (!valor || valor <= 0) return NextResponse.json({ error: "Valor final inválido." }, { status: 400 });
      const { data: saleId, error } = await admin.rpc("fn_registrar_venda", {
        p_opportunity_id: id,
        p_valor: valor,
        p_data: body.data_venda ?? null,
        p_participantes: body.participantes ?? {},
        p_percentual: percentual,
        p_regra: body.regra ?? null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await evento(id, "anotacao", `VENDA registrada: R$ ${valor.toLocaleString("pt-BR")} · comissão ${percentual}%`, a!.userId);
      await logAudit({ user_id: a!.userId, acao: "venda_registrada", entidade: "sales", entidade_id: saleId as string, opportunity_id: id, property_id: opp.property_id, dados_depois: { valor, percentual } });
      const to = await ariniEmail();
      await sendEmail(to, `Venda fechada — ${opp.codigo}`,
        `Venda registrada na oportunidade ${opp.codigo}: R$ ${valor.toLocaleString("pt-BR")}, comissão ${percentual}%.`);
      return NextResponse.json({ ok: true, sale_id: saleId });
    }
  }

  return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
}
