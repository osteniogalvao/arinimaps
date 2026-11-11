import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { emailDoProfile, sendEmail } from "@/lib/notify";

export type Nivel = "info" | "atencao" | "critico";

/**
 * Notificação em 3 níveis (migration 0067): info fica só no sino; atenção
 * aparece em destaque; crítico também vai por e-mail na hora. `chave` evita
 * avisar duas vezes a mesma coisa. Nunca lança.
 */
export async function notificar(userId: string | null | undefined, nivel: Nivel, titulo: string, texto: string | null, link: string | null, chave?: string) {
  if (!userId) return;
  try {
    const { error } = await supabaseAdmin().rpc("fn_notificar", {
      p_user: userId, p_nivel: nivel, p_titulo: titulo, p_texto: texto ?? "", p_link: link ?? "", p_chave: chave ?? null,
    });
    if (error) return;
    if (nivel === "critico") {
      const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
      await sendEmail(await emailDoProfile(userId), titulo, `${texto ?? ""}\n\n${link ? site + link : ""}`.trim());
      await supabaseAdmin().from("notificacoes").update({ email_em: new Date().toISOString() })
        .eq("user_id", userId).eq("titulo", titulo.slice(0, 200)).is("email_em", null);
    }
  } catch (e) {
    console.error("notificar:", e);
  }
}
