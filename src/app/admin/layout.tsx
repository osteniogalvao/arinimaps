import { redirect } from "next/navigation";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { setoresDe } from "@/lib/setores";
import AdminShell from "./AdminShell";
import AjudaTour from "@/components/ajuda/AjudaTour";

const PAPEL_LABEL: Record<string, string> = {
  admin_central: "Diretoria",
  analista_arini: "Equipe",
};

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  if (!["admin_central", "analista_arini"].includes(user.role)) redirect("/");

  // Duas travas da Central, pedidas nos requisitos de segurança (01/10/2026):
  //  · segundo fator — quem tem, precisa ter confirmado nesta sessão; se a
  //    diretoria tornou obrigatório, quem não tem é levado a ativar;
  //  · sessão administrativa não fica aberta para sempre.
  const supabase = await supabaseServer();
  const [{ data: aal }, { data: { user: authUser } }, cfg] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.getUser(),
    lerConfiguracoes(),
  ]);
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/entrar?mfa=1");
  if (cfg.seguranca_mfa_equipe === true && aal?.nextLevel !== "aal2") redirect("/conta/seguranca?obrigatorio=1");

  const horas = numero(cfg, "seguranca_sessao_equipe_horas", 12);
  const entrou = authUser?.last_sign_in_at ? new Date(authUser.last_sign_in_at).getTime() : Date.now();
  if (Date.now() - entrou > horas * 3_600_000) redirect("/entrar?expirou=1");

  return (
    <AdminShell
      nome={user.nome ?? ""}
      papel={PAPEL_LABEL[user.role] ?? user.role}
      setores={setoresDe(user.role, user.setores)}
      avatar={user.avatarUrl}
    >
      {children}
      {/* tour de primeira visita + botão Ajuda (2ª etapa, item 14) */}
      <AjudaTour perfil="central" />
    </AdminShell>
  );
}
