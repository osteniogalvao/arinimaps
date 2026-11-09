import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { numeroWhatsApp } from "@/lib/compartilhar";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";

/**
 * Número de WhatsApp da própria conta, para o "Enviar para mim mesmo" do botão
 * de compartilhar. Só devolve o telefone de quem está logado; sem sessão,
 * responde `logado: false` (não é erro: o botão só esconde a opção).
 */
export async function GET() {
  const semCache = { "Cache-Control": "no-store" };
  const user = await currentUser();
  if (!user) return NextResponse.json({ logado: false, numero: null }, { headers: semCache });
  const limite = await limitar(`conta:whatsapp:${user.id}`, 60, 600);
  if (!limite.permitido) return respostaLimite(limite, "leitura");

  const { data } = await supabaseAdmin().from("profiles").select("telefone").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ logado: true, numero: numeroWhatsApp(data?.telefone as string | null) }, { headers: semCache });
}
