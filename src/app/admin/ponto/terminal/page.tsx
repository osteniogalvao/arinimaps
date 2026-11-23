import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { podeOperarTerminal } from "@/lib/ponto-terminal";
import { diaSP } from "@/lib/ponto";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import TerminalPonto from "@/components/ponto/TerminalPonto";

const horasAtras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export const metadata = { title: "Terminal de ponto" };

/**
 * Terminal de ponto (0160): o computador da recepção fica aberto nesta tela
 * e cada pessoa marca o próprio ponto com nome + PIN.
 */
export default async function Terminal() {
  const a = await ator();
  if (!a) redirect("/entrar");
  if (!a.ehArini) redirect("/");
  if (!(await podeOperarTerminal(a))) redirect("/admin/ponto");
  const admin = supabaseAdmin();
  const desde = horasAtras(36);
  const [{ data: equipe }, { data: pins, error }, { data: recentes }] = await Promise.all([
    admin.from("profiles").select("user_id, nome").in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome"),
    admin.from("ponto_pins").select("user_id"),
    admin.from("ponto_marcacoes").select("user_id, marcado_em").gte("marcado_em", desde),
  ]);
  const hoje = diaSP(new Date());
  const marcasHoje = new Map<string, number>();
  for (const m of recentes ?? []) if (diaSP(m.marcado_em) === hoje) marcasHoje.set(m.user_id, (marcasHoje.get(m.user_id) ?? 0) + 1);
  const comPin = new Set((pins ?? []).map((p) => p.user_id as string));
  const pessoas = (equipe ?? []).map((p) => ({
    user_id: p.user_id as string, nome: (p.nome as string) || "Sem nome", tem_pin: comPin.has(p.user_id as string),
    proxima: (marcasHoje.get(p.user_id as string) ?? 0) % 2 === 0 ? "entrada" as const : "saída" as const,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CabecalhoPagina eyebrow="Equipe · Ponto" titulo="Terminal de ponto"
        subtitulo="Escolha o seu nome e digite o seu PIN. A marcação fica no seu nome, não na conta aberta neste computador."
        acoes={<Link href="/admin/ponto" className="btn-contorno px-4 py-2 text-sm">Sair do terminal</Link>} />
      {error
        ? <p className="cartao p-5" role="alert">Falta rodar a migration 0160 (Terminal de ponto) no Supabase.</p>
        : <TerminalPonto pessoas={pessoas} />}
    </div>
  );
}
