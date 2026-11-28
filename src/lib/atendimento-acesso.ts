import { redirect } from "next/navigation";
import { ator, temSetor } from "@/lib/authz";
import { papelAtendimento } from "@/lib/atendimento";

/** Quem abre uma tela do Atendimento: só a equipe; papel e abas visíveis. */
export async function acessoAtendimento() {
  const a = await ator();
  if (!a) redirect("/entrar");
  if (!a.ehArini) redirect("/");
  const papel = await papelAtendimento(a);
  return { a, papel, triagem: papel !== "atendente", diretoria: temSetor(a, "diretoria") };
}
