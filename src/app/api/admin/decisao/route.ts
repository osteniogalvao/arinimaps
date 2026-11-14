import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendEmail, emailDoProfile } from "@/lib/notify";
import { buscarEVincularPois } from "@/lib/overpass";
import { casarDemandas } from "@/lib/demandas";
import { setoresDe } from "@/lib/setores";
import { mfaPendente } from "@/lib/authz";
import { CAMPOS_REVISAO, CAMPOS_REVISAO_CARACTERISTICAS, CAMPO_REVISAO_LABEL, valorRevisao } from "@/lib/imovel/revisao";

async function emailDoAnunciante(propertyId: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data: p } = await admin.from("properties").select("owner_id, partner_id").eq("id", propertyId).single();
  if (!p) return null;
  if (p.owner_id) {
    const { data: o } = await admin.from("owners").select("profile_id").eq("id", p.owner_id).single();
    if (o) return emailDoProfile(o.profile_id);
  }
  if (p.partner_id) {
    const { data: pa } = await admin.from("partners").select("profile_id").eq("id", p.partner_id).single();
    if (pa) return emailDoProfile(pa.profile_id);
  }
  return null;
}

// "complementar" (Fluxograma §7) é o mesmo status `correcao`, com pendência
// de dados em vez de erro: o anunciante vê "Aguardando complemento".
const ACOES_IMOVEL = ["em_analise", "aprovado", "correcao", "complementar", "reprovado", "publicado", "suspenso"];

// Decisões da Arini sobre imóveis e cadastros (parceiro/proprietário).
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: profile } = await admin.from("profiles").select("role, setores, ativo").eq("user_id", user.id).single();
  const daEquipe = !!profile && profile.ativo === true && ["admin_central", "analista_arini"].includes(profile.role);
  // aprovar e publicar é do setor de Operações (diretoria entra em todos)
  if (!daEquipe || !setoresDe(profile.role, profile.setores as string[] | null).includes("operacoes") ||
      (await mfaPendente(supabase, daEquipe))) {
    return NextResponse.json({ error: "Decisões sobre anúncios e cadastros são do setor de Operações." }, { status: 403 });
  }

  const { alvo, id, acao, motivo } = await request.json().catch(() => ({}));

  // ---------- imóveis ----------
  if (alvo === "imovel") {
    if (!ACOES_IMOVEL.includes(acao)) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    const { data: antes } = await admin.from("properties").select("id, codigo, status, partner_id, modalidade").eq("id", id).single();
    if (!antes) return NextResponse.json({ error: "Imóvel não encontrado." }, { status: 404 });

    // Comprovação de propriedade: nada é aprovado nem publicado sem a Arini
    // ter conferido a matrícula (e, em imóvel de parceiro, a autorização do
    // proprietário). Regra do Carlos: o site não publica imóvel sem prova.
    if (["aprovado", "publicado"].includes(acao)) {
      const { data: conferidos } = await admin.from("property_documents")
        .select("tipo").eq("property_id", id).eq("verificado", true).is("substituido_por", null); // só a versão vigente (5.8)
      const tipos = new Set((conferidos ?? []).map((d) => d.tipo));
      // leilão se sustenta no edital; venda comum, na matrícula (e na
      // autorização do proprietário quando quem anuncia é parceiro)
      const faltam = (antes.modalidade === "leilao"
        ? [!tipos.has("edital") && "o edital do leilão conferido"]
        : [
            !tipos.has("matricula") && "a matrícula (ou escritura) conferida",
            antes.partner_id && !tipos.has("autorizacao") && "a autorização do proprietário conferida",
          ]
      ).filter(Boolean);
      if (faltam.length) {
        return NextResponse.json({
          error: `Não dá para ${acao === "aprovado" ? "aprovar" : "publicar"} ainda: falta ${faltam.join(" e ")}. ` +
            "Abra o documento em Documentos, confira e clique em \"marcar como conferido\".",
        }, { status: 400 });
      }
    }

    const statusNovo = acao === "complementar" ? "correcao" : acao;
    const { error } = await admin
      .from("properties")
      .update({
        status: statusNovo,
        motivo_correcao: ["correcao", "complementar", "reprovado"].includes(acao) ? motivo || null : null,
        pendencia_tipo: acao === "correcao" ? "correcao" : acao === "complementar" ? "complemento" : null,
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 }); // transição inválida cai aqui

    // §3: aprovar é o ato da Matriz que valida a divisa — se a versão atual
    // ainda está "informada pelo usuário", passa a validada. Nunca derruba a decisão.
    if (acao === "aprovado") {
      const { data: versaoAtual } = await admin.from("property_geometry_versions").select("id, situacao")
        .eq("property_id", id).neq("situacao", "substituida").order("versao", { ascending: false }).limit(1).maybeSingle();
      if (versaoAtual && versaoAtual.situacao !== "validada") {
        const { data: vid, error: vErro } = await admin.rpc("fn_validar_geometria", {
          p_property_id: id, p_user_id: user.id, p_motivo: "Validada na aprovação do anúncio",
        });
        if (vErro) console.error("fn_validar_geometria na aprovação falhou:", vErro.message);
        else await logAudit({
          user_id: user.id, acao: "geometria_validada", entidade: "property_geometry_versions",
          entidade_id: (vid as string | null) ?? null, property_id: id, dados_depois: { motivo: "aprovação do anúncio" },
        });
      }
    }

    if (acao === "publicado") {
      // mensalidade nasce junto com a publicação (idempotente)
      const { data: valorPadrao } = await admin.from("settings").select("valor").eq("chave", "mensalidade_valor_padrao").single();
      await admin.from("subscriptions").upsert(
        { property_id: id, valor_mensal: Number(valorPadrao?.valor ?? 0) },
        { onConflict: "property_id", ignoreDuplicates: true }
      );
      // apresentação 3D fica disponível na hora; vídeo/OG vão para a fila do worker.
      // Idempotente: republicar não duplica apresentação nem job (a migration 0063
      // cria o unique (property_id, tipo); a checagem abaixo vale antes dela também).
      const { data: existentes } = await admin.from("presentations").select("tipo, status").eq("property_id", id);
      const temTour = (existentes ?? []).some((p) => p.tipo === "tour3d");
      const video = (existentes ?? []).find((p) => p.tipo === "video");
      const novas = [
        ...(temTour ? [] : [{ property_id: id, tipo: "tour3d", status: "pronto", output_path: `/imovel/${antes.codigo}/tour` }]),
        ...(video ? [] : [{ property_id: id, tipo: "video", status: "pendente" }]),
      ];
      if (novas.length) await admin.from("presentations").insert(novas);
      // vídeo que falhou volta para a fila; o que já está pronto ou em andamento fica como está
      if (video?.status === "erro") {
        await admin.from("presentations").update({ status: "pendente", erro: null }).eq("property_id", id).eq("tipo", "video");
      }
      const { data: jobsAbertos } = await admin.from("jobs").select("tipo")
        .in("tipo", ["render_video", "screenshot_og"]).in("status", ["pendente", "processando"])
        .eq("payload->>property_id", id);
      const abertos = new Set((jobsAbertos ?? []).map((j) => j.tipo));
      const novosJobs = [
        ...(!abertos.has("render_video") && video?.status !== "pronto"
          ? [{ tipo: "render_video", payload: { property_id: id, codigo: antes.codigo } }] : []),
        ...(!abertos.has("screenshot_og") ? [{ tipo: "screenshot_og", payload: { property_id: id, codigo: antes.codigo } }] : []),
      ];
      if (novosJobs.length) await admin.from("jobs").insert(novosJobs);
      // POIs: tenta agora (Overpass com cache); se falhar vira job
      buscarEVincularPois(id).catch(() => undefined);
      // 5.16: demandas abertas que casam com o imóvel viram tarefa do Comercial
      void casarDemandas(id);
    }

    // avisa o anunciante nas decisões que mudam a vida dele
    const mensagens: Record<string, string> = {
      aprovado: "Seu imóvel foi APROVADO pela Arini e será publicado em breve.",
      publicado: `Seu imóvel está PUBLICADO no mapa: ${process.env.NEXT_PUBLIC_SITE_URL}/imovel/${antes.codigo}`,
      correcao: `A Arini pediu correções no seu imóvel: ${motivo ?? "veja o painel"}. Acesse ${process.env.NEXT_PUBLIC_SITE_URL}/painel`,
      complementar: `A Arini pediu informações complementares: ${motivo ?? "veja o painel"}. Acesse ${process.env.NEXT_PUBLIC_SITE_URL}/painel`,
      reprovado: `Seu imóvel não foi aprovado. Motivo: ${motivo ?? "entre em contato com a Arini"}.`,
    };
    if (mensagens[acao]) {
      emailDoAnunciante(id).then((to) =>
        sendEmail(to, `Arini Imóveis Brasil — imóvel ${antes.codigo}`, mensagens[acao])
      ).catch(() => undefined);
    }

    await logAudit({
      user_id: user.id,
      acao: `imovel_${acao}`,
      entidade: "properties",
      entidade_id: id,
      property_id: id,
      dados_antes: { status: antes.status },
      dados_depois: { status: statusNovo, pendencia_tipo: acao === "complementar" ? "complemento" : acao === "correcao" ? "correcao" : null, motivo },
    });
    return NextResponse.json({ ok: true });
  }

  // ---------- alteração de anúncio publicado (Fluxograma §9) ----------
  // O imóvel fica publicado o tempo todo; aprovar aplica os campos propostos.
  if (alvo === "revisao") {
    if (!["aprovar", "rejeitar"].includes(acao)) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    const { data: rev } = await admin.from("property_revisions")
      .select("id, property_id, versao, status, dados, dados_anteriores, created_by")
      .eq("id", id).maybeSingle();
    if (!rev) return NextResponse.json({ error: "Alteração não encontrada." }, { status: 404 });
    if (rev.status !== "pendente") return NextResponse.json({ error: "Esta alteração já foi decidida." }, { status: 409 });
    const { data: prop } = await admin.from("properties").select("id, codigo, titulo").eq("id", rev.property_id).single();
    if (!prop) return NextResponse.json({ error: "Imóvel não encontrado." }, { status: 404 });

    const agora = new Date().toISOString();
    const dados = (rev.dados ?? {}) as Record<string, unknown>;
    if (acao === "aprovar") {
      // só os campos permitidos entram em properties
      const patch: Record<string, unknown> = {};
      for (const c of CAMPOS_REVISAO) if (c in dados) patch[c] = dados[c];
      // tour virtual (item 9) mora em `caracteristicas`: mescla sem apagar o resto
      const extras = CAMPOS_REVISAO_CARACTERISTICAS.filter((c) => c in dados);
      if (extras.length) {
        const { data: atualC } = await admin.from("properties").select("caracteristicas").eq("id", prop.id).single();
        const carac = { ...((atualC?.caracteristicas ?? {}) as Record<string, unknown>) };
        for (const c of extras) {
          if (dados[c] == null || dados[c] === "") delete carac[c];
          else carac[c] = dados[c];
        }
        patch.caracteristicas = carac;
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "A proposta não tem campos aplicáveis." }, { status: 400 });
      const { data: antesProp } = await admin.from("properties").select(CAMPOS_REVISAO.join(", ")).eq("id", prop.id).single();
      const { error: upErro } = await admin.from("properties").update(patch).eq("id", prop.id);
      if (upErro) return NextResponse.json({ error: upErro.message }, { status: 400 });
      await admin.from("property_revisions")
        .update({ status: "aprovada", revisada_por: user.id, revisada_em: agora })
        .eq("id", rev.id);
      await logAudit({
        user_id: user.id, acao: "revisao_aprovada", entidade: "property_revisions", entidade_id: rev.id,
        property_id: prop.id, dados_antes: antesProp ?? rev.dados_anteriores, dados_depois: { versao: rev.versao, ...patch },
      });
    } else {
      await admin.from("property_revisions")
        .update({ status: "rejeitada", motivo: motivo || null, revisada_por: user.id, revisada_em: agora })
        .eq("id", rev.id);
      await logAudit({
        user_id: user.id, acao: "revisao_rejeitada", entidade: "property_revisions", entidade_id: rev.id,
        property_id: prop.id, dados_antes: { versao: rev.versao, dados }, dados_depois: { motivo },
      });
    }
    // a tarefa de Operações criada na proposta se encerra junto
    await admin.from("tasks").update({ status: "concluida", concluida_em: agora })
      .eq("property_id", prop.id).eq("setor", "operacoes").in("status", ["aberta", "andamento"])
      .ilike("titulo", "Alteração proposta — %");

    const resumo = Object.keys(dados)
      .map((c) => `${CAMPO_REVISAO_LABEL[c as keyof typeof CAMPO_REVISAO_LABEL] ?? c}: ${valorRevisao(c, dados[c])}`)
      .join("\n");
    const texto = acao === "aprovar"
      ? `Sua alteração foi aplicada ao anúncio ${prop.codigo} (${prop.titulo}).\n\n${resumo}\n\nVeja: ${process.env.NEXT_PUBLIC_SITE_URL}/imovel/${prop.codigo}`
      : `A Arini não aplicou a alteração proposta no anúncio ${prop.codigo}. Motivo: ${motivo || "entre em contato com a Arini"}.\n\nO anúncio continua publicado como estava.`;
    emailDoAnunciante(prop.id).then((to) =>
      sendEmail(to, `Arini Imóveis Brasil — alteração do anúncio ${prop.codigo}`, texto)
    ).catch(() => undefined);

    return NextResponse.json({ ok: true });
  }

  // ---------- cadastros (parceiro / proprietário) ----------
  if (alvo === "partner" || alvo === "owner") {
    const tabela = alvo === "partner" ? "partners" : "owners";
    if (!["aprovado", "ativo", "pendente", "reprovado", "suspenso", "em_analise"].includes(acao)) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    const { data: antes } = await admin.from(tabela).select("id, status").eq("id", id).single();
    if (!antes) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });

    const { error } = await admin
      .from(tabela)
      .update({ status: acao, motivo_pendencia: acao === "pendente" ? motivo || null : null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await logAudit({
      user_id: user.id,
      acao: `${alvo}_${acao}`,
      entidade: tabela,
      entidade_id: id,
      dados_antes: { status: antes.status },
      dados_depois: { status: acao, motivo },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Alvo inválido." }, { status: 400 });
}
