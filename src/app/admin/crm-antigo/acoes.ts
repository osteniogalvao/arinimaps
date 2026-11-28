"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { logAudit } from "@/lib/audit";

/** Marca (ou desmarca) um imóvel do CRM antigo como já trazido para o sistema novo. */
export async function marcarTrazido(form: FormData) {
  const user = await exigirSetor("operacoes", "comercial");
  const id = String(form.get("id") ?? "");
  const desfazer = form.get("desfazer") === "1";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await supabaseAdmin().from("crm_antigo_registros")
    .update(desfazer ? { trazido_em: null, trazido_por: null } : { trazido_em: new Date().toISOString(), trazido_por: user.id })
    .eq("tabela", "properties").eq("id_antigo", id);
  await logAudit({ acao: desfazer ? "crm_antigo_imovel_desmarcado" : "crm_antigo_imovel_trazido", entidade: "crm_antigo_registros", entidade_id: id, user_id: user.id });
  revalidatePath("/admin/crm-antigo");
}
