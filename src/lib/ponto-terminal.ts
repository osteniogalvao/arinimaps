import "server-only";
import { temSetor, type Ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Opera o terminal de ponto quem é da diretoria ou da recepção (marcada em Atendimento > Configurar). */
export async function podeOperarTerminal(a: Ator) {
  if (!a.ehArini) return false;
  if (temSetor(a, "diretoria")) return true;
  const { data } = await supabaseAdmin().from("profiles").select("atendimento_recepcao").eq("user_id", a.userId).maybeSingle();
  return !!data?.atendimento_recepcao;
}
