import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { assinatura } from "@/lib/juridico";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { distribuirLead } from "@/lib/central";

// Formulário público "Tenho interesse" → lead + oportunidade + auditoria + e-mail à Arini.
export async function POST(request: Request) {
  // formulário público: sem limite, um robô enche o funil de leads falsos
  const limite = await limitar(`lead:ip:${ipDoPedido(request)}`, 8, 600);
  if (!limite.permitido) return respostaLimite(limite, "envio");

  const body = await request.json().catch(() => null);
  const { codigo, nome, telefone, email, mensagem, consentimento } = body ?? {};

  if (!codigo || !nome?.trim() || (!telefone?.trim() && !email?.trim())) {
    return NextResponse.json(
      { error: "Informe seu nome e pelo menos um contato (telefone ou e-mail)." },
      { status: 400 }
    );
  }
  if (!consentimento) {
    return NextResponse.json(
      { error: "É preciso autorizar o contato para enviar o interesse." },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const { data: property } = await admin
    .from("properties")
    .select("id, codigo, titulo, status")
    .eq("codigo", codigo)
    .in("status", ["publicado", "em_negociacao"])
    .single();
  if (!property) {
    return NextResponse.json({ error: "Imóvel não disponível." }, { status: 404 });
  }
  // §1.1: demonstração de interesse (antes de criar o lead, para registrar a tentativa)
  void registrarEventoImovel({ propertyId: property.id, tipo: "interesse", request, detalhe: { codigo: property.codigo } });

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .insert({
      property_id: property.id,
      nome: nome.trim(),
      telefone: telefone?.trim() || null,
      email: email?.trim() || null,
      mensagem: mensagem?.trim() || null,
      origem: "pagina",
      consentimento_lgpd: true,
      consentimento_versao: assinatura("privacidade"),
      status: "em_oportunidade",
    })
    .select("id")
    .single();
  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });

  const { data: opp, error: oppError } = await admin
    .from("opportunities")
    .insert({ lead_id: lead.id, property_id: property.id })
    .select("id, codigo")
    .single();
  if (oppError) return NextResponse.json({ error: oppError.message }, { status: 500 });

  await admin.from("opportunity_events").insert({
    opportunity_id: opp.id,
    tipo: "contato",
    descricao: `Lead recebido pelo site para ${property.codigo} — ${property.titulo}`,
  });
  void registrarEventoImovel({ propertyId: property.id, tipo: "lead", request, detalhe: { lead_id: lead.id, opportunity: opp.codigo } });
  // Central operacional (migration 0065): rodízio entre os corretores da equipe
  await distribuirLead(opp.id, opp.codigo, property.titulo);

  await logAudit({
    acao: "lead_criado",
    entidade: "leads",
    entidade_id: lead.id,
    property_id: property.id,
    opportunity_id: opp.id,
    dados_depois: { nome, telefone, email },
  });

  // Notificação imediata à Arini (F0): e-mail via Resend, se configurado.
  if (process.env.RESEND_API_KEY && process.env.ARINI_NOTIFY_EMAIL) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Arini Imóveis Brasil <leads@arinibrasil.com.br>",
          to: [process.env.ARINI_NOTIFY_EMAIL],
          subject: `Novo lead ${opp.codigo} — ${property.titulo}`,
          text: `Novo interesse no imóvel ${property.codigo} (${property.titulo}).\n\nNome: ${nome}\nTelefone: ${telefone || "-"}\nE-mail: ${email || "-"}\nMensagem: ${mensagem || "-"}\n\nAbra o painel: ${process.env.NEXT_PUBLIC_SITE_URL}/admin/leads`,
        }),
      });
    } catch (e) {
      console.error("notificação de lead falhou:", e);
    }
  }

  return NextResponse.json({ ok: true, oportunidade: opp.codigo });
}
