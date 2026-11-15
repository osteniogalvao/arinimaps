import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { Indicadores } from "@/components/admin/Painel";
import Organizacoes, { type OrgLinha } from "./Organizacoes";
import { CircleCheck, Landmark, MailPlus, Users } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/Pagina";

export const dynamic = "force-dynamic";

/**
 * Organizações (5.9) na Matriz — setores Comercial e Diretoria: cadastrar a
 * imobiliária/empresa/prefeitura/franquia, dar plano e região, ver e convidar
 * membros. O plano de escopo "organizacao" vale para todos os membros cujo
 * plano pessoal é o padrão do nicho (docs/PLANOS.md §10).
 */
export default async function AdminOrganizacoes() {
  await exigirSetor("comercial", "diretoria");
  const admin = supabaseAdmin();
  const [{ data: orgs }, { data: membros }, { data: planos }, { data: regioes }] = await Promise.all([
    admin.from("organizations").select("id, nome, cnpj, tipo, plan_id, plan_valido_ate, region_id, ativo, observacoes, created_at").order("nome"),
    admin.from("organization_members").select("id, org_id, user_id, email, papel_org, status, convidado_em, aceito_em")
      .in("status", ["ativo", "pendente"]).order("convidado_em"),
    admin.from("plans").select("id, nome, escopo, ativo").eq("ativo", true).order("ordem"),
    admin.from("regions").select("id, nome").order("nome"),
  ]);
  const ids = [...new Set((membros ?? []).map((m) => m.user_id).filter(Boolean))] as string[];
  const { data: perfis } = ids.length
    ? await admin.from("profiles").select("user_id, nome, avatar_url, role").in("user_id", ids)
    : { data: [] as { user_id: string; nome: string; avatar_url: string | null; role: string }[] };
  const perfil = new Map((perfis ?? []).map((p) => [p.user_id, p]));

  const linhas: OrgLinha[] = (orgs ?? []).map((o) => ({
    ...o,
    membros: (membros ?? []).filter((m) => m.org_id === o.id).map((m) => ({
      ...m,
      nome: m.user_id ? perfil.get(m.user_id)?.nome ?? null : null,
      avatar_url: m.user_id ? perfil.get(m.user_id)?.avatar_url ?? null : null,
    })),
  }));
  const ativos = (membros ?? []).filter((m) => m.status === "ativo").length;
  const pendentes = (membros ?? []).filter((m) => m.status === "pendente").length;

  return (
    <div className="space-y-8 max-w-5xl">
      <CabecalhoPagina eyebrow="Comercial" titulo="Organizações"
        subtitulo={<>
          Várias contas sob o mesmo plano: imobiliária com corretores, empresa, holding, ente público ou franquia.
          Quem é membro usa o plano da organização enquanto o plano pessoal for o padrão do nicho.
        </>} />
      <Link className="text-sm font-semibold underline" href="/admin/organizacoes/contratos">Módulos por contrato · Diretoria</Link>
      <Indicadores itens={[
        { rotulo: "Organizações", icone: Landmark, valor: linhas.length },
        { rotulo: "Ativas", icone: CircleCheck, valor: linhas.filter((o) => o.ativo).length },
        { rotulo: "Membros ativos", icone: Users, valor: ativos },
        { rotulo: "Convites pendentes", icone: MailPlus, valor: pendentes, destaque: pendentes > 0 },
      ]} />
      <Organizacoes orgs={linhas} planos={planos ?? []} regioes={regioes ?? []} />
    </div>
  );
}
