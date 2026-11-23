"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SETOR_IDS } from "@/lib/setores";

/**
 * Prazos e limites da Matriz (migration 0162). Só a Diretoria edita
 * ("Quem edita as regras é a Diretoria", seção 4). Vale na próxima rodada do
 * motor, sem mexer em código.
 */
async function diretoria() {
  const a = await ator();
  if (!a || a.role !== "admin_central") redirect("/admin?sem_acesso=diretoria");
  return a;
}

const inteiro = (v: FormDataEntryValue | null, min: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export async function salvarPrazo(form: FormData) {
  const a = await diretoria();
  const setor = String(form.get("setor") ?? "");
  const regra = String(form.get("regra") ?? "").trim().slice(0, 60);
  const linha = {
    setor, regra,
    prazo_dias: inteiro(form.get("prazo_dias"), 0, 365),
    limite_dias: inteiro(form.get("limite_dias"), 0, 365),
    atencao: inteiro(form.get("atencao"), 0, 999),
    critico: inteiro(form.get("critico"), 1, 999),
  };
  let resultado = "erro";
  if (SETOR_IDS.includes(setor as never) && /^[a-z0-9_]*$/.test(regra)
      && [linha.prazo_dias, linha.limite_dias, linha.atencao, linha.critico].every((x) => x !== null)) {
    const admin = supabaseAdmin();
    const { data: antes } = await admin.from("matriz_prazos").select("*").eq("setor", setor).eq("regra", regra).maybeSingle();
    const { error } = await admin.from("matriz_prazos")
      .upsert({ ...linha, updated_by: a.userId, updated_at: new Date().toISOString() }, { onConflict: "setor,regra" });
    if (!error) {
      resultado = "salvo";
      await logAudit({ user_id: a.userId, acao: "matriz_prazo_alterado", entidade: "matriz_prazos", dados_antes: antes, dados_depois: linha });
    }
  }
  revalidatePath("/admin/automacoes");
  revalidatePath("/admin");
  redirect(`/admin/automacoes?prazos=${resultado}#prazos`);
}

export async function removerExcecao(form: FormData) {
  const a = await diretoria();
  const setor = String(form.get("setor") ?? "");
  const regra = String(form.get("regra") ?? "");
  if (regra && SETOR_IDS.includes(setor as never)) {
    const admin = supabaseAdmin();
    const { data: antes } = await admin.from("matriz_prazos").select("*").eq("setor", setor).eq("regra", regra).maybeSingle();
    const { error } = await admin.from("matriz_prazos").delete().eq("setor", setor).eq("regra", regra);
    if (!error) await logAudit({ user_id: a.userId, acao: "matriz_prazo_removido", entidade: "matriz_prazos", dados_antes: antes });
  }
  revalidatePath("/admin/automacoes");
  redirect("/admin/automacoes?prazos=salvo#prazos");
}
