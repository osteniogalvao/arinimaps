import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { acessoDe } from "@/lib/planos-servidor";
import { PAPEL_LABEL, ehParceiro } from "@/lib/perfis";
import AjudaTour from "@/components/ajuda/AjudaTour";
import AppShell from "@/components/shell/AppShell";
import MarcaArini from "@/components/marca/MarcaArini";
import AbasPainel from "@/components/painel/AbasPainel";

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  if (["admin_central", "analista_arini"].includes(user.role)) redirect("/admin");

  // só para a saudação: o plano nunca derruba o painel
  const plano = await acessoDe(user.id).then((a) => a.planNome ?? null).catch(() => null);
  const primeiroNome = (user.nome || "").trim().split(/\s+/)[0];

  return (
    <AppShell usuario={{ nome: user.nome || "Conta", papel: "Anunciante", avatar: user.avatarUrl }} busca={false}>
      <div className="mx-auto w-full max-w-[1280px] md:px-4 md:pt-4">
        {/* capa de prancha: Verde Profundo, linhas de mapa e o radar no canto */}
        <header className="lp-escuro lp-malha-escura relative mb-8 overflow-hidden rounded-3xl p-6 md:mb-10 md:p-9">
          <MarcaArini variante="radar" titulo=""
            className="pointer-events-none absolute right-6 top-6 hidden w-9 md:block" />
          <p className="lp-eyebrow">01 · Área do cliente</p>
          <p className="lp-display mt-4 text-3xl md:text-[2.75rem] text-texto text-balance">
            Olá{primeiroNome ? <>, <span className="text-ouro">{primeiroNome}</span></> : ""}
          </p>
          <p className="mt-3 text-base text-texto-2">
            {PAPEL_LABEL[user.role] ?? "Anunciante"}
            {plano && <> · plano <strong className="font-semibold text-texto">{plano}</strong></>}
          </p>
          <div className="mt-7">
            <AbasPainel />
          </div>
        </header>
        <div className="pb-12">{children}</div>
        {/* tour de primeira visita + botão Ajuda (2ª etapa, item 14) */}
        <AjudaTour perfil={ehParceiro(user.role) ? "parceiro" : "painel"}
          className="fixed bottom-24 right-4 z-40 lg:bottom-6 lg:right-6" />
      </div>
    </AppShell>
  );
}
