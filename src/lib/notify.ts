import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Corpo HTML no padrão "Assinatura de e-mail · 600 px" do manual (prancha 22):
 * fundo off-white, cartão branco, assinatura no topo, fio dourado, texto em
 * Verde Arini e rodapé com o sinal de localização. Só tabelas e estilos em
 * linha (compatível com Gmail/Outlook); Quicksand cai para fontes do sistema.
 * O texto puro segue indo junto, como alternativa.
 */
export function emailHtml(assunto: string, texto: string): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arinibrasil.com.br";
  const corpo = esc(texto)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#124431;font-weight:600;text-decoration:underline;">$1</a>')
    .replace(/\n/g, "<br>");
  const fonte = "Quicksand,'Trebuchet MS','Segoe UI',Arial,sans-serif";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#F2F2EC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2EC;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #DADCD0;border-radius:16px;font-family:${fonte};">
<tr><td style="padding:28px 32px 0 32px;">
<a href="${site}" style="text-decoration:none;font-family:${fonte};font-size:24px;font-weight:700;letter-spacing:0.14em;color:#124431;">ARINI</a>
<span style="font-size:10px;letter-spacing:0.22em;color:#55655A;text-transform:uppercase;font-weight:600;">&nbsp;&nbsp;Imóveis Brasil</span>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr><td width="40" height="2" style="background:#D9BD6F;font-size:0;line-height:0;">&nbsp;</td></tr></table>
</td></tr>
<tr><td style="padding:22px 32px 6px 32px;font-size:20px;line-height:1.25;font-weight:700;color:#124431;text-transform:uppercase;letter-spacing:0.02em;">${esc(assunto)}</td></tr>
<tr><td style="padding:8px 32px 28px 32px;font-size:15px;line-height:1.65;color:#0E2A20;">${corpo}</td></tr>
<tr><td style="background:#0A2219;border-radius:0 0 15px 15px;padding:18px 32px;font-size:11px;line-height:1.5;color:#B3C3B8;letter-spacing:0.04em;">
<span style="color:#D9BD6F;">&#9679;</span>&nbsp; Arini Imóveis Brasil · Inteligência territorial &nbsp;·&nbsp; <a href="${site}" style="color:#F2F2EC;text-decoration:none;">${site.replace(/^https?:\/\//, "")}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Distingue um erro definitivo de uma falha temporária na fila de envio. */
export async function enviarEmailComStatus(to: string | null | undefined, subject: string, text: string, chave?: string) {
  if (!process.env.RESEND_API_KEY || !to) return "falhou";
  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(chave ? {"Idempotency-Key":chave} : {}),
      },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "Arini Imóveis Brasil <naoresponda@arinibrasil.com.br>",
        to: [to],
        subject,
        text,
        html: emailHtml(subject, text),
      }),
    });
    if (resposta.ok) return "enviado";
    if (resposta.status === 409) {
      const detalhe = await resposta.json().catch(() => null);
      return detalhe?.name === "concurrent_idempotent_requests" ? "temporario" : "falhou";
    }
    return resposta.status === 408 || resposta.status === 429 || resposta.status >= 500 ? "temporario" : "falhou";
  } catch {
    return "temporario";
  }
}

export async function sendEmail(to: string | null | undefined, subject: string, text: string, chave?: string) {
  return (await enviarEmailComStatus(to, subject, text, chave)) === "enviado";
}

/** E-mail da central Arini: settings.notify_email > env ARINI_NOTIFY_EMAIL. */
export async function ariniEmail(): Promise<string | null> {
  const { data } = await supabaseAdmin().from("settings").select("valor").eq("chave", "notify_email").single();
  const v = data?.valor;
  if (typeof v === "string" && v.includes("@")) return v;
  return process.env.ARINI_NOTIFY_EMAIL ?? null;
}

/** E-mail do usuário dono do profile (vive no auth.users). */
export async function emailDoProfile(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}
