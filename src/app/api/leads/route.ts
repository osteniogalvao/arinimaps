import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assinatura } from "@/lib/juridico";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { ator } from "@/lib/authz";
import { consentimentoDaConta } from "@/lib/privacidade/consentimento";
import { distribuirLead } from "@/lib/central";

// Formulário público "Tenho interesse" → lead + oportunidade + auditoria + e-mail à Arini.
export async function POST(request: Request) {
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Entre para demonstrar interesse." }, { status: 401 });
  // formulário público: sem limite, um robô enche o funil de leads falsos
  const limite = await limitar(`lead:ip:${ipDoPedido(request)}`, 8, 600);
  if (!limite.permitido) return respostaLimite(limite, "envio");

  const body = await request.json().catch(() => null);
  const { codigo, nome, telefone, email, mensagem, consentimento } = body ?? {};
  // campanha que trouxe o lead (Central de marketing): só as chaves UTM, curtas
  const utm: Record<string, string> = {};
  if (await consentimentoDaConta(a.userId,"rastro") && body?.utm && typeof body.utm === "object") {
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const v = (body.utm as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) utm[k] = v.trim().slice(0, 100);
    }
  }

  if (typeof codigo!=="string" || typeof nome!=="string" || !nome.trim() ||
      [telefone,email,mensagem].some(v=>v!=null && typeof v!=="string") || (!telefone?.trim() && !email?.trim())) {
    return NextResponse.json(
      { error: "Informe seu nome e pelo menos um contato (telefone ou e-mail)." },
      { status: 400 }
    );
  }
  if (consentimento !== true) {
    return NextResponse.json(
      { error: "É preciso autorizar o contato para enviar o interesse." },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const { data: property } = await admin
    .from("properties")
    .select("id, codigo, titulo, status, regime_comercial")
    .eq("codigo", codigo)
    .in("status", ["publicado", "em_negociacao"])
    .single();
  if (!property) {
    return NextResponse.json({ error: "Imóvel não disponível." }, { status: 404 });
  }
  const {data:opp,error} = await admin.rpc("fn_interesse_no_mapa",{
    p_codigo:codigo,p_cliente:a.userId,p_regime:body.regime??"EXCLUSIVO_ARINI",p_nome:nome.trim().slice(0,180),p_telefone:telefone?.trim().slice(0,40)||null,
    p_email:email?.trim().slice(0,254)||null,p_mensagem:mensagem?.trim().slice(0,2000)||null,p_versao:assinatura("privacidade"),p_utm:utm,
  });
  if (error || !opp) return NextResponse.json({error:error?.code==="P0001" ? error.message : "Não foi possível registrar o interesse."},{status:409});
  if (!opp.novo) return NextResponse.json({ok:true,oportunidade:opp.codigo});
  void registrarEventoImovel({propertyId:property.id,tipo:"interesse",userId:a.userId,request,detalhe:{codigo:property.codigo}});
  void registrarEventoImovel({propertyId:property.id,tipo:"lead",userId:a.userId,request,detalhe:{lead_id:opp.lead_id,opportunity:opp.codigo}});
  if (opp.regime!=="EXCLUSIVO_ARINI") return NextResponse.json({ok:true,oportunidade:opp.codigo});
  await distribuirLead(opp.id,opp.codigo,property.titulo);

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
