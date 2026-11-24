"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase/server";

export async function salvarReuniao(form: FormData) {
  const a = await ator();
  if (!a?.ehArini || a.somenteLeitura) redirect("/admin?sem_acesso=agenda");
  const texto = (key: string) => String(form.get(key) ?? "").trim();
  const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const id = texto("id"), tarefa = texto("tarefa_id"), inicio = texto("inicio"), fim = texto("fim");
  const data = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && Number.isFinite(Date.parse(v + "-03:00"));
  if ((id && !uuid(id)) || (tarefa && !uuid(tarefa)) || !uuid(texto("responsavel")) || !data(inicio) || !data(fim)) redirect("/admin/agenda-setores?aviso=invalido");
  const { error } = await (await supabaseServer()).rpc("fn_agenda_reuniao_salvar", {
    p_id: id || null, p_versao: Number(texto("versao")), p_setor: texto("setor"), p_titulo: texto("titulo"),
    p_responsavel: texto("responsavel"), p_inicio: inicio + "-03:00", p_fim: fim + "-03:00", p_local: texto("local"),
    p_lembrete: Number(texto("lembrete")), p_tarefa: tarefa || null, p_status: texto("status"),
  });
  revalidatePath("/admin/agenda-setores");
  redirect(`/admin/agenda-setores?aviso=${error ? error.code === "40001" ? "conflito" : "invalido" : "salvo"}`);
}
