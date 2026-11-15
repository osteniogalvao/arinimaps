"use server";
import { revalidatePath } from "next/cache";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function salvarContrato(_: string, form: FormData): Promise<string> {
  const a = await ator();
  if (a?.role !== "admin_central") return "Apenas a Diretoria pode configurar contratos.";
  const org = String(form.get("org") ?? "");
  const modulo = String(form.get("modulo") ?? "");
  const territorio = String(form.get("territorio") ?? "").trim();
  const referencia = String(form.get("referencia") ?? "").trim();
  const revisao = Number(form.get("revisao"));
  if (!/^[a-f0-9-]{36}$/i.test(org) || !["balcao","safras"].includes(modulo) ||
    !territorio || !referencia || Math.max(territorio.length, referencia.length)>200 || !Number.isInteger(revisao)) return "Confira o território e a referência do contrato.";
  const { error } = await supabaseAdmin().rpc("org_configurar_contrato", {
    p_ator:a.userId,p_org:org,p_modulo:modulo,p_territorio:territorio,p_referencia:referencia,p_ativo:form.get("ativo")==="on",p_revisao:revisao,
  });
  if (error?.code === "40001") return "Esse contrato mudou. Atualize a página antes de salvar.";
  if (error?.code === "P9701") return error.message;
  if (error) return "Não foi possível atualizar o contrato.";
  revalidatePath("/admin/organizacoes/contratos");
  return "Contrato atualizado.";
}
