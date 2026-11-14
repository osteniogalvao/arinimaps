import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { marcarPrimeiroAtendimento, concluirTarefaDoEvento } from "@/lib/central";
import { enviarWhatsapp, MetaErro, telefoneWhatsapp, whatsappConfigurado } from "@/lib/meta";

/** Conversa de WhatsApp da oportunidade: ler (GET ?opp=) e responder (POST). */
export async function GET(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  const opp = new URL(request.url).searchParams.get("opp") ?? "";
  const { data, error } = await supabaseAdmin().from("whatsapp_mensagens").select("id, direcao, texto, status, erro, created_at")
    .eq("opportunity_id", opp).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: "Não foi possível carregar a conversa." }, { status: 503 });
  return NextResponse.json({ configurado: whatsappConfigurado(), mensagens: (data ?? []).reverse() });
}

export async function POST(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const texto = String(b.texto ?? "").trim();
  if (!texto) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: opp } = await admin.from("opportunities").select("id, lead:leads(telefone)").eq("id", String(b.opp ?? "")).maybeSingle();
  const tel = telefoneWhatsapp((opp?.lead as unknown as { telefone: string | null } | null)?.telefone);
  if (!opp || !tel) return NextResponse.json({ error: "O lead não tem telefone válido." }, { status: 400 });
  try {
    const waId = await enviarWhatsapp(tel, texto);
    await admin.from("whatsapp_mensagens").insert({ wa_id: waId || null, telefone: tel, direcao: "saida", texto, opportunity_id: opp.id, enviado_por: a!.userId, status: "sent" });
    await admin.from("opportunity_events").insert({ opportunity_id: opp.id, tipo: "contato", descricao: `WhatsApp enviado: ${texto.slice(0, 500)}`, autor: a!.userId });
    await marcarPrimeiroAtendimento(opp.id, a!.userId);
    // respondeu: a cobrança de "WhatsApp sem resposta" desta conversa se fecha
    const { data: ultimas } = await admin.from("whatsapp_mensagens").select("id").eq("opportunity_id", opp.id).eq("direcao", "entrada").order("created_at", { ascending: false }).limit(3);
    for (const m of ultimas ?? []) await concluirTarefaDoEvento(`whatsapp_sem_resposta:${m.id}`, a!.userId, "Cliente respondido pelo WhatsApp");
    await logAudit({ user_id: a!.userId, acao: "whatsapp_enviado", entidade: "whatsapp_mensagens", opportunity_id: opp.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof MetaErro) return NextResponse.json({ error: e.mensagem }, { status: 400 });
    throw e;
  }
}
