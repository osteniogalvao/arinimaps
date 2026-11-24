import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { SETORES } from "@/lib/setores";
import { falta0161 } from "@/lib/equipe";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import EquipeSetores, { type Pessoa } from "@/components/admin/EquipeSetores";

export const metadata = { title: "Equipe e funções" };

const EQUIPE = ["admin_central", "analista_arini"];

/**
 * Funções e acessos por setor (migration 0161; áudios do Carlos, 23/11/2026
 * 17h58: "controle de funções" e "cada setor a gente tem que organizar para
 * liberar o acesso"). Toda a equipe vê quem está em cada setor e com qual
 * função (para saber a quem delegar); Diretoria e gestores organizam.
 */
export default async function EquipePorSetor() {
  const user = await exigirEquipe();
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
    ? SETORES.filter((s) => s.id !== "diretoria").map((s) => s.id)
    : ((eu?.setores_gestor ?? []) as string[]).filter((s) => user.setores.includes(s as never));
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

  return (
    <div className="mx-auto max-w-[1280px] space-y-8">
      <CabecalhoPagina
        eyebrow="Central · Equipe"
        titulo="Equipe e funções"
        subtitulo={<>
          Quem trabalha em cada setor, com qual função e quem é o gestor. O gestor libera e retira o acesso do próprio setor e cria o login
          de quem entra nele; a Diretoria nomeia os gestores.
          {diretoria && <> Papel de Diretoria e desativação de conta ficam em <Link href="/admin/usuarios" className="font-semibold text-verde underline">Equipe e usuários</Link>;
            a recepção do WhatsApp, em <Link href="/admin/atendimento/configurar" className="font-semibold text-verde underline">Menu do WhatsApp e recepção</Link>.</>}
        </>}
      />
      {semMigration && (
        <p role="alert" className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm font-semibold text-alerta">
          Falta rodar a migration 0161 no Supabase. Até lá dá para ver e mudar os setores, mas não a função nem os gestores.
        </p>
      )}
      <EquipeSetores pessoas={pessoas} souEu={user.id} diretoria={diretoria} gere={gere} semMigration={semMigration} />
    </div>
  );
}
