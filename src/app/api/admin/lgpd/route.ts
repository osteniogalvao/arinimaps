import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { sendEmail } from "@/lib/notify";

const STATUS = ["recebido", "em_analise", "atendido", "negado"];
const TIPOS = ["acesso", "correcao", "exclusao", "portabilidade", "revogacao", "informacao", "outro"];

/** Registra à mão um pedido que chegou por outro canal (telefone, e-mail, balcão). */
export async function POST(request: Request) {
  const a = await ator();
  if (!a || !temSetor(a, "juridico")) return NextResponse.json({ error: "Restrito ao setor Jurídico." }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  if (b.acao === "guarda") {
    const { data, error } = await supabaseAdmin().rpc("lgpd_decidir_guarda", {
      p_imovel: b.imovel ?? null, p_guarda: b.guarda ?? null, p_motivo: b.motivo ?? null,
      p_revisar: b.revisar || null, p_ator: a.userId,
    });
    if (error) return NextResponse.json({ error: error.code === "P0002" ? "Imóvel ou guarda não encontrado." : error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  const nome = String(b.nome ?? "").trim();
  const email = String(b.email ?? "").trim().toLowerCase();
  if (nome.length < 2 || !email.includes("@") || !TIPOS.includes(b.tipo)) {
    return NextResponse.json({ error: "Informe nome, e-mail e o tipo do pedido." }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().from("lgpd_requests").insert({
    nome, email, tipo: b.tipo, descricao: b.descricao ? String(b.descricao).slice(0, 4000) : null,
    cpf: b.cpf ? String(b.cpf).replace(/\D/g, "").slice(0, 14) : null,
  }).select("id, codigo").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await logAudit({ user_id: a.userId, acao: "lgpd_registrado", entidade: "lgpd_requests", entidade_id: data.id, dados_depois: { tipo: b.tipo } });
  return NextResponse.json({ ok: true, codigo: data.codigo });
}

/** Anda o pedido e registra a resposta dada ao titular. */
export async function PATCH(request: Request) {
  const a = await ator();
  if (!a || !temSetor(a, "juridico")) return NextResponse.json({ error: "Restrito ao setor Jurídico." }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();
  if (b.acao === "simular_exclusao" || b.acao === "encerrar_conta") {
    const simular = b.acao === "simular_exclusao";
    if (!simular && b.identidadeConferida !== true) return NextResponse.json({ error: "Confirme a identificação do titular." }, { status: 400 });
    const { data, error } = await admin.rpc("lgpd_encerrar_conta", {
      p_pedido: b.id, p_ator: a.userId, p_simular: simular, p_resposta: String(b.resposta ?? "").trim().slice(0, 6000),
    });
    if (error) return NextResponse.json({ error: error.code === "P0002" ? "Pedido não encontrado." : error.message }, { status: 400 });
    if (simular || data.concluido) return NextResponse.json({ ok: true, resumo: data });
    // Tenta finalizar primeiro, pois uma tentativa anterior pode já ter
    // concluído o Auth e perdido a resposta na próxima chamada ao banco.
    const finalizar = () => admin.rpc("lgpd_finalizar_encerramento", { p_pedido: b.id, p_ator: a.userId });
    let fim = await finalizar();
    if (fim.error?.code === "P1009") {
      const pasta = `avatars/${data.titular}`;
      const midia = admin.storage.from("media");
      // Após o bloqueio da conta não há novos uploads. Um lote que falhe
      // continua no bucket e pode ser retomado pelo mesmo protocolo.
      for (;;) {
        const lote = await midia.list(pasta, { limit:100 });
        if (lote.error) return NextResponse.json({ error: "Perfil bloqueado. Repita para verificar as fotos do perfil." }, { status: 503 });
        if (!lote.data.length) break;
        const removidos = await midia.remove(lote.data.map(item => `${pasta}/${item.name}`));
        if (removidos.error) return NextResponse.json({ error: "Perfil bloqueado. Repita para remover as fotos do perfil." }, { status: 503 });
      }
      const { error: erroAuth } = await admin.auth.admin.deleteUser(data.titular, true);
      if (erroAuth) return NextResponse.json({ error: "Perfil bloqueado. Repita o encerramento para concluir a autenticação." }, { status: 503 });
      fim = await finalizar();
    }
    if (fim.error) return NextResponse.json({ error: "Encerramento iniciado. Repita para concluir o protocolo." }, { status: 503 });
    if (fim.data === true && b.avisar !== false) {
      const { data: p } = await admin.from("lgpd_requests").select("codigo,email,resposta").eq("id", b.id).single();
      if (p) await sendEmail(p.email, `Resposta ao pedido ${p.codigo} — Arini Imóveis Brasil`, p.resposta).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  }
  if (!STATUS.includes(b.status)) return NextResponse.json({ error: "Situação inválida." }, { status: 400 });
  const resposta = b.resposta ? String(b.resposta).trim().slice(0, 6000) : null;
  const encerra = ["atendido", "negado"].includes(b.status);
  if (encerra && !resposta) {
    return NextResponse.json({ error: "Para encerrar o pedido, registre a resposta dada ao titular." }, { status: 400 });
  }

  const { data: antes } = await admin.from("lgpd_requests").select("codigo, email, status, tipo").eq("id", b.id).single();
  if (!antes) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  if (antes.tipo === "exclusao") {
    const { data: emCurso, error: falha } = await admin.from("lgpd_encerramentos").select("pedido_id").eq("pedido_id", b.id).maybeSingle();
    if (falha || emCurso) return NextResponse.json({ error: "Use o fluxo de encerramento para concluir este pedido." }, { status: 409 });
  }

  const { data: atualizado, error } = await admin.from("lgpd_requests").update({
    status: b.status,
    resposta: resposta ?? undefined,
    atendido_em: encerra ? new Date().toISOString() : null,
    atendido_por: encerra ? a.userId : null,
  }).eq("id", b.id).in("status", ["recebido", "em_analise"]).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!atualizado) return NextResponse.json({ error: "Este pedido já foi encerrado." }, { status: 409 });

  if (encerra && b.avisar !== false) {
    sendEmail(antes.email, `Resposta ao pedido ${antes.codigo} — Arini Imóveis Brasil`, resposta!).catch(() => undefined);
  }
  await logAudit({
    user_id: a.userId, acao: "lgpd_" + b.status, entidade: "lgpd_requests", entidade_id: b.id,
    dados_antes: { status: antes.status }, dados_depois: { status: b.status },
  });
  return NextResponse.json({ ok: true });
}
