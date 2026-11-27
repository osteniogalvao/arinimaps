import { supabaseAdmin } from "@/lib/supabase/admin";
import { SETORES } from "@/lib/setores";
import { falta0161 } from "@/lib/equipe";
import type { Pessoa } from "@/components/admin/EquipeSetores";

const EQUIPE = ["admin_central", "analista_arini"];

/**
 * Equipe da Central com setores, função e gestores (migration 0161), para a
 * tela geral (Equipe e funções) e para a equipe de cada setor.
 */
export async function lerEquipe(user: { id: string; role: string; setores: string[] }) {
  const admin = supabaseAdmin();
  const diretoria = user.role === "admin_central";

  let semMigration = false;
  let r = await admin.from("profiles")
    .select("user_id, nome, role, ativo, setores, cargo, setores_gestor, atendimento_recepcao, equipe_acesso")
    .in("role", EQUIPE).order("nome");
  if (r.error && falta0161(r.error.message)) {
    semMigration = true;
    // antes da 0161: mesma tela, sem função nem gestor
    r = await admin.from("profiles").select("user_id, nome, role, ativo, setores").in("role", EQUIPE).order("nome") as typeof r;
  }
  if (r.error) throw new Error("Falha ao carregar a equipe.");

  const linhas = (r.data ?? []) as Record<string, unknown>[];
  const eu = linhas.find((p) => p.user_id === user.id);
  const gere = diretoria
    ? SETORES.filter((s) => s.id !== "diretoria").map((s) => s.id as string)
    : ((eu?.setores_gestor ?? []) as string[]).filter((s) => user.setores.includes(s));
  const organiza = diretoria || gere.length > 0;

  // e-mail só para quem organiza (mora no Auth, não em profiles)
  const emails = new Map<string, string>();
  if (organiza) {
    await Promise.all(linhas.map((p) => admin.auth.admin.getUserById(String(p.user_id))
      .then(({ data }) => { emails.set(String(p.user_id), data.user?.email ?? ""); }).catch(() => undefined)));
  }

  const pessoas: Pessoa[] = linhas.map((p) => ({
    user_id: String(p.user_id),
    nome: (p.nome as string) || "Sem nome",
    email: emails.get(String(p.user_id)) ?? "",
    diretoria: p.role === "admin_central",
    ativo: p.ativo !== false,
    setores: ((p.setores ?? []) as string[]).filter((s) => s !== "diretoria"),
    gestor: ((p.setores_gestor ?? []) as string[]),
    cargo: (p.cargo as string | null) ?? null,
    recepcao: !!p.atendimento_recepcao,
    acesso: p.equipe_acesso === "leitura" ? "leitura" : "operador",
  }));

  return { pessoas, gere, diretoria, semMigration };
}
