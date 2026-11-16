import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { sendEmail } from "@/lib/notify";
import { marcarVisto, usuarioOnline } from "@/lib/suporte";

const STATUS = ["aberto", "em_atendimento", "aguardando_cliente", "resolvido"];
const PRIORIDADES = ["baixa", "normal", "alta"];

/**
 * Atendimento do chamado pela equipe: responder ao cliente, deixar nota
 * interna, trocar situação, prioridade e responsável.
 */
export async function PATCH(request: Request) {
  const a = await ator();
  if (!a || !temSetor(a, "suporte")) {
    return NextResponse.json({ error: "Restrito ao setor de Suporte." }, { status: 403 });
  }
  const b = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();
  const { data: ticket } = await admin.from("support_tickets")
    .select("id, codigo, email, assunto, status, responsavel, user_id").eq("id", b.id).single();
  if (!ticket) return NextResponse.json({ error: "Chamado não encontrado." }, { status: 404 });

  const patch: Record<string, unknown> = {};
  const corpo = String(b.mensagem ?? "").trim();
  const interno = b.interno === true;

  if (corpo) {
    const { data: eu } = await admin.from("profiles").select("nome").eq("user_id", a.userId).single();
    await admin.from("support_messages").insert({
      ticket_id: ticket.id, autor_id: a.userId, autor_nome: eu?.nome || "Equipe Arini",
      da_equipe: true, interno, corpo: corpo.slice(0, 6000),
    });
    if (!interno) {
      // respondeu ao cliente: a bola está com ele, e o chamado ganha dono
      patch.status = "aguardando_cliente";
      if (!ticket.responsavel) patch.responsavel = a.userId;
      // 10.2: quem está com a conversa aberta vê a resposta na hora; o e-mail
      // vai só para visitante sem conta ou cliente fora da página (fire-and-forget)
      usuarioOnline(ticket.user_id).then((online) => {
        if (online) return;
        return sendEmail(
          ticket.email,
          `Resposta ao chamado ${ticket.codigo} — ARINI`,
          `${corpo}\n\n—\nChamado ${ticket.codigo}: ${ticket.assunto}\n` +
          `Para continuar a conversa, responda em ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/suporte`
        );
      }).catch(() => undefined);
    }
    void marcarVisto(a.userId);
  }
  if (b.status !== undefined) {
    if (!STATUS.includes(b.status)) return NextResponse.json({ error: "Situação inválida." }, { status: 400 });
    patch.status = b.status;
    patch.resolvido_em = b.status === "resolvido" ? new Date().toISOString() : null;
  }
  if (b.prioridade !== undefined && PRIORIDADES.includes(b.prioridade)) patch.prioridade = b.prioridade;
  if (b.responsavel !== undefined) patch.responsavel = b.responsavel || null;

  if (Object.keys(patch).length) {
    const { error } = await admin.from("support_tickets").update(patch).eq("id", ticket.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else if (!corpo) {
    return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
  }

  await logAudit({
    user_id: a.userId, acao: corpo ? (interno ? "chamado_nota_interna" : "chamado_respondido") : "chamado_alterado",
    entidade: "support_tickets", entidade_id: ticket.id, dados_depois: patch,
  });
  return NextResponse.json({ ok: true });
}
