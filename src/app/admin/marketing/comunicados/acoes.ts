"use server";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function comunicar(dados: FormData, id: string, prever: boolean) {
  const user = await exigirSetor("marketing");
  const titulo = String(dados.get("titulo") ?? "").trim(),
    mensagem = String(dados.get("mensagem") ?? "").trim();
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    titulo.length < 4 ||
    titulo.length > 140 ||
    mensagem.length < 8 ||
    mensagem.length > 4000
  )
    return { erro: "Confira o título e a mensagem." };
  const filtros = Object.fromEntries(
    ["perfil", "plano", "profissao", "interesse"].flatMap((k) => {
      const valor = String(dados.get(k) ?? "").trim();
      return valor ? [[k, valor.slice(0, 120)]] : [];
    }),
  );
  const { data, error } = await supabaseAdmin().rpc("matriz_comunicar", {
    p_ator: user.id,
    p_id: id,
    p_titulo: titulo,
    p_mensagem: mensagem,
    p_filtros: filtros,
    p_email: dados.has("email"),
    p_prever: prever,
  });
  if (error) return { erro: "Não foi possível processar o comunicado. Confira os campos e tente novamente." };
  if (!prever) revalidatePath("/admin/marketing/comunicados");
  return { total: Number(data) };
}
