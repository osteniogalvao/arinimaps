import "server-only";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
export type Finalidade = "rastro" | "historico_ari" | "whatsapp";
export const COOKIE_ESCOLHA = "arini_privacidade";
export async function consentimentoDaConta(titular: string | null | undefined, finalidade: Finalidade) {
  if (!titular) return finalidade==="rastro" && (await cookies()).get(COOKIE_ESCOLHA)?.value==="rastro-v1";
  const {data} = await supabaseAdmin().from("conta_consentimentos").select("permitido")
    .eq("titular",titular).eq("finalidade",finalidade).order("id",{ascending:false}).limit(1).maybeSingle();
  return data?.permitido === true;
}
