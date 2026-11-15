import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { ariniEmail, sendEmail } from "@/lib/notify";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";

const CATEGORIAS = ["duvida", "problema", "anuncio", "financeiro", "dados_pessoais", "outro"];
const TIPOS_LGPD = ["acesso", "correcao", "exclusao", "portabilidade", "revogacao", "informacao", "outro"];

/**
 * Abre um chamado de suporte — com ou sem conta.
 *
 * Categoria "dados_pessoais" não vira chamado comum: vira pedido de titular
 * (LGPD, art. 18), que tem prazo legal e vai para o Jurídico, não para a fila
 * do suporte.
 */
export async function POST(request: Request) {
  const limite = await limitar(`suporte:ip:${ipDoPedido(request)}`, 6, 3600);
  if (!limite.permitido) return respostaLimite(limite, "envio");

  const b = await request.json().catch(() => ({}));
  const user = await currentUser();
  const nome = String(b.nome ?? user?.nome ?? "").trim();
  const email = String(b.email ?? user?.email ?? "").trim().toLowerCase();
  const assunto = String(b.assunto ?? "").trim();
  const mensagem = String(b.mensagem ?? "").trim();
  const categoria = CATEGORIAS.includes(b.categoria) ? b.categoria : "duvida";

  if (nome.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Informe seu nome e um e-mail válido para a resposta." }, { status: 400 });
  }
  if (mensagem.length < 10) {
    return NextResponse.json({ error: "Descreva o que aconteceu em pelo menos uma frase." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  if (categoria === "dados_pessoais") {
    const { data, error } = await admin.from("lgpd_requests").insert({
      user_id: user?.id ?? null, nome, email,
      cpf: b.cpf ? String(b.cpf).replace(/\D/g, "").slice(0, 14) : null,
      tipo: TIPOS_LGPD.includes(b.lgpd_tipo) ? b.lgpd_tipo : "informacao",
      descricao: mensagem.slice(0, 4000),
    }).select("codigo, prazo").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    sendEmail(await ariniEmail(), `Pedido LGPD ${data.codigo}`, `${nome} <${email}> enviou um pedido sobre dados pessoais.\nPrazo de resposta: ${data.prazo}.\n\n${mensagem}`).catch(() => undefined);
    return NextResponse.json({
      ok: true, codigo: data.codigo,
      mensagem: `Pedido ${data.codigo} registrado. Respondemos por e-mail em até 15 dias.`,
    });
  }

  if (assunto.length < 3) return NextResponse.json({ error: "Informe o assunto." }, { status: 400 });

  const { data: tickets, error } = await admin.rpc("abrir_chamado_com_mensagem", {
    p_usuario: user?.id ?? null, p_nome: nome, p_email: email,
    p_telefone: b.telefone ? String(b.telefone).slice(0, 30) : null,
    p_categoria: categoria, p_assunto: assunto, p_mensagem: mensagem,
  });
  const ticket = tickets?.[0];
  if (error || !ticket) return NextResponse.json({ error: "Não foi possível registrar a solicitação. Tente novamente." }, { status: 503 });
  sendEmail(await ariniEmail(), `Chamado ${ticket.codigo}: ${assunto}`, `${nome} <${email}> abriu um chamado (${categoria}).\n\n${mensagem}`).catch(() => undefined);

  return NextResponse.json({
    ok: true, codigo: ticket.codigo, id: ticket.id,
    mensagem: `Chamado ${ticket.codigo} aberto. A resposta chega no seu e-mail${user ? " e fica em Meus chamados" : ""}.`,
  });
}
