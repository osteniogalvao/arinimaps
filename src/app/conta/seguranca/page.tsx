import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { lerConfiguracoes } from "@/lib/settings";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import TopoConta from "@/components/painel/TopoConta";
import Seguranca from "./Seguranca";
import { mfaObrigatoriaEquipe } from "@/lib/seguranca/equipe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Segurança da conta" };

/**
 * Segurança da própria conta: segundo fator, troca de senha, sessões e o
 * histórico de acessos. Fica fora de /admin e de /painel de propósito — é para
 * onde a pessoa é levada quando o segundo fator é obrigatório e ela ainda não
 * tem um, e não pode depender de já ter passado por essa exigência.
 */
export default async function ContaSeguranca({ searchParams }: PageProps<"/conta/seguranca">) {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  const obrigatorio = (await searchParams).obrigatorio === "1";
  const daEquipe = ["admin_central", "analista_arini"].includes(user.role);

  const [{ data: eventos }, cfg] = await Promise.all([
    supabaseAdmin().from("auth_events")
      .select("id, evento, ip, agente, created_at").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(15),
    lerConfiguracoes(),
  ]);

  return (
    <div className="min-h-screen bg-fundo">
      <TopoConta daEquipe={daEquipe} />
      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-10 md:px-8 md:pt-14">
        <CabecalhoPagina eyebrow="Minha conta" titulo="Segurança da conta" subtitulo={<>{user.nome} · {user.email}</>} />
        <Seguranca
          eventos={eventos ?? []}
          obrigatorio={obrigatorio}
          exigidoDaEquipe={mfaObrigatoriaEquipe(user, cfg.seguranca_mfa_equipe === true)}
        />
      </main>
    </div>
  );
}
