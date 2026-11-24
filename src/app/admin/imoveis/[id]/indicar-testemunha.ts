"use server";
import { revalidatePath } from "next/cache";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function indicarTestemunha(_: string, form: FormData) {
  const a = await ator();
  if (!a || a.somenteLeitura || !temSetor(a,"operacoes","juridico")) return "Acesso restrito à equipe responsável.";
  const id = String(form.get("id")), email=String(form.get("email")).trim();
  const posicao = Number(form.get("posicao"));
  if (!/^[a-f0-9-]{36}$/i.test(id) || ![1,2].includes(posicao) || email.length>254 || !email.includes("@")) return "Confira o e-mail e a posição da testemunha.";
  const {error} = await supabaseAdmin().rpc("fn_indicar_testemunha",{p_id:id,p_posicao:posicao,p_email:email,p_ator:a.userId});
  if (error) return error.code==="P1190" ? error.message : "Não foi possível indicar a testemunha.";
  revalidatePath("/admin/imoveis/[id]","page");
  return "Testemunha indicada. O documento está disponível na conta dela.";
}
