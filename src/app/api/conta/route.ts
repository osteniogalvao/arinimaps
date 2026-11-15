import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";

/** Perfil da própria conta: nome e telefone (e-mail e papel não mudam aqui). */
export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return falha(401, "sem_sessao", "Sessão expirada.", { solucao: "Entre de novo." });
  const limite = await limitar(`conta:perfil:${user.id}`, 20, 600);
  if (!limite.permitido) return respostaLimite(limite, "gravação");

  const b = await request.json().catch(() => ({}));
  if (!b || typeof b !== "object" || Array.isArray(b)) return falha(400, "perfil_invalido", "Confira os dados do perfil.");
  const patch: Record<string, string | boolean | null> = {};
  if (b.nome !== undefined) {
    const nome = String(b.nome).replace(/\s+/g, " ").trim();
    if (nome.length < 2 || nome.length > 120) return falha(400, "nome_invalido", "Informe seu nome (2 a 120 letras).");
    patch.nome = nome;
  }
  if (b.telefone !== undefined) {
    const tel = String(b.telefone ?? "").trim();
    const digitos = tel.replace(/\D/g, "");
    if (tel && (digitos.length < 10 || digitos.length > 15)) {
      return falha(400, "telefone_invalido", "Telefone inválido.", { solucao: "Use DDD + número, ex.: (34) 99999-0000." });
    }
    patch.telefone = tel ? tel.slice(0, 30) : null;
  }
  for (const [campo,max] of [["profissao_declarada",100],["especialidade",120]] as const) {
    if (b[campo] === undefined) continue;
    if (typeof b[campo] !== "string" || (b[campo].trim() && b[campo].trim().length < 2) || b[campo].trim().length > max)
      return falha(400, "qualificacao_invalida", "Confira a profissão e a especialidade.");
    patch[campo]=b[campo].trim() || null;
  }
  if (typeof b.avisos_email === "boolean") patch.avisos_email = b.avisos_email;
  if (!Object.keys(patch).length) return falha(400, "nada_para_alterar", "Nada para alterar.");

  const admin = supabaseAdmin();
  const { data: antes } = await admin.from("profiles").select("nome, telefone").eq("user_id", user.id).single();
  const { error } = await admin.from("profiles").update(patch).eq("user_id", user.id);
  if (error) return falha(500, "erro_banco", "Não foi possível salvar.", { motivo: error.message });
  await logAudit({ user_id: user.id, acao: "perfil_alterado", entidade: "profiles", entidade_id: user.id, dados_antes: antes, dados_depois: patch });
  return NextResponse.json({ ok: true });
}
