import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { ariniEmail, sendEmail } from "@/lib/notify";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { atendenteOnline, lerSince, marcarVisto } from "@/lib/suporte";

const CAMPOS_MSG = "id, autor_nome, da_equipe, corpo, created_at";

/**
 * Conversa ao vivo do lado de quem abriu o chamado (10.2): a página consulta
 * a cada 5 s pedindo só o que chegou depois de `since`. Também conta como
 * presença (o e-mail da resposta só vai se a pessoa não estiver na página).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/suporte/[id]">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Entre na sua conta." }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: ticket } = await admin.from("support_tickets").select("id, user_id, status").eq("id", id).maybeSingle();
  if (!ticket || ticket.user_id !== user.id) return NextResponse.json({ error: "Chamado não encontrado." }, { status: 404 });

  const since = lerSince(request);
  let q = admin.from("support_messages").select(CAMPOS_MSG).eq("ticket_id", id).eq("interno", false).order("created_at").limit(200);
  if (since) q = q.gt("created_at", since);
  const [{ data: mensagens }, online, {data:avaliacao,error:erroAvaliacao}] = await Promise.all([q, atendenteOnline(), admin.from("support_avaliacoes").select("nota, comentario, created_at").eq("ticket_id",id).maybeSingle(), marcarVisto(user.id)]);
  if(erroAvaliacao)return NextResponse.json({error:"Não foi possível consultar o chamado."},{status:503});

  return NextResponse.json(
    { mensagens: mensagens ?? [], status: ticket.status, atendente_online: online, avaliacao },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

/** O dono do chamado responde na conversa. Reabre o chamado se estava resolvido. */
export async function POST(request: Request, ctx: RouteContext<"/api/suporte/[id]">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Entre na sua conta para responder." }, { status: 401 });

  // conversa ao vivo: mais mensagens curtas que no e-mail
  const limite = await limitar(`suporte:msg:${user.id}`, 60, 3600);
  if (!limite.permitido) return respostaLimite(limite, "envio");

  const corpo = String((await request.json().catch(() => ({}))).mensagem ?? "").trim();
  if (corpo.length < 2) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: ticket } = await admin.from("support_tickets").select("id, codigo, assunto, user_id, status").eq("id", id).single();
  if (!ticket || ticket.user_id !== user.id) {
    return NextResponse.json({ error: "Chamado não encontrado." }, { status: 404 });
  }

  const { data: msg } = await admin.from("support_messages").insert({
    ticket_id: id, autor_id: user.id, autor_nome: user.nome || "Cliente", corpo: corpo.slice(0, 6000),
  }).select(CAMPOS_MSG).single();
  if (ticket.status !== "aberto") {
    await admin.from("support_tickets").update({ status: "em_atendimento", resolvido_em: null }).eq("id", id);
  }
  void marcarVisto(user.id);

  // ninguém do Suporte na Central agora: avisa por e-mail (fire-and-forget)
  atendenteOnline().then(async (online) => {
    if (online) return;
    sendEmail(await ariniEmail(), `Chamado ${ticket.codigo}: nova mensagem`,
      `${user.nome || "O cliente"} escreveu no chamado ${ticket.codigo} (${ticket.assunto}):\n\n${corpo.slice(0, 2000)}\n\n` +
      `Responder: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/suporte/${ticket.id}`);
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, mensagem: msg });
}
