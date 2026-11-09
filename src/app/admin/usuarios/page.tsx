import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import GestaoUsuarios from "./GestaoUsuarios";
import PlanoConta, { type PlanoOpcao } from "./PlanoConta";
import { exigirSetor } from "@/lib/setores-servidor";
import { PAPEL_LABEL, PAPEIS_EQUIPE } from "@/lib/perfis";
import { CabecalhoPagina, Secao, Vazio } from "@/components/ui/Pagina";
import { UserRound } from "lucide-react";
import Paginacao from "@/components/admin/Paginacao";
import BuscaLista, { termoBusca } from "@/components/admin/BuscaLista";
import { paginaDe } from "@/lib/supabase/lotes";

const POR_PAGINA = 50;
const CAMPOS_PERFIL = "user_id, nome, role, telefone, ativo, setores, nicho, plan_id, plan_origem, plan_valido_ate, created_at";

/** plan_valido_ate já passou? (fora do componente: o linter do React não quer Date.now() em render) */
const estaVencido = (d: string | null) => !!d && new Date(d).getTime() < Date.now();

export default async function AdminUsuarios({ searchParams }: PageProps<"/admin/usuarios">) {
  await exigirSetor("diretoria");
  const sp = await searchParams;
  const { pagina, de, ate } = paginaDe(sp.pagina, POR_PAGINA);
  const q = termoBusca(sp.q);
  const admin = supabaseAdmin();
  const papeisEquipe = PAPEIS_EQUIPE as readonly string[];
  // equipe inteira (é pequena); contas externas paginadas com busca — o
  // PostgREST cortava a lista em 1000 e o listUsers em 200 sem avisar
  let qExternos = admin.from("profiles").select(CAMPOS_PERFIL, { count: "exact" })
    .not("role", "in", `(${papeisEquipe.join(",")})`);
  if (q) qExternos = qExternos.ilike("nome", `%${q}%`);
  const [{ data: equipe }, { data: externosPagina, count: totalExternos }, { data: planos }, user] = await Promise.all([
    admin.from("profiles").select(CAMPOS_PERFIL).in("role", [...papeisEquipe]).order("created_at"),
    qExternos.order("created_at").order("user_id").range(de, ate),
    admin.from("plans").select("id, nome, ativo").order("ordem").order("id"),
    currentUser(),
  ]);
  const externos = externosPagina ?? [];

  // e-mail só de quem aparece na tela (o e-mail mora no Auth, não em profiles)
  const ids = [...(equipe ?? []), ...externos].map((p) => p.user_id as string);
  const emails = await Promise.all(ids.map((id) =>
    admin.auth.admin.getUserById(id).then(({ data }) => [id, data.user?.email ?? ""] as const).catch(() => [id, ""] as const)));
  const emailPorId = new Map<string, string>(emails);
  const ehDiretoria = user?.role === "admin_central";

  return (
    <div className="mx-auto max-w-[1280px] space-y-12">
      <CabecalhoPagina
        variante="simples"
        eyebrow="Central · Diretoria"
        titulo="Usuários e acessos"
        subtitulo="A equipe da Arini opera o sistema por setor; proprietários, parceiros e compradores usam os portais."
      />

      <GestaoUsuarios
        equipe={(equipe ?? []).map((p) => ({
          user_id: p.user_id, nome: p.nome, role: p.role, ativo: p.ativo,
          setores: (p.setores ?? []) as string[],
          email: emailPorId.get(p.user_id) ?? "",
        }))}
        souEu={user?.id ?? ""}
        ehDiretoria={ehDiretoria}
      />

      <Secao
        eyebrow="Portais"
        titulo={`Contas externas (${totalExternos ?? externos.length})`}
        subtitulo={<>
          Aprovação de proprietários e parceiros acontece em <strong className="text-texto">Cadastros</strong>. O nicho e o plano de
          cada conta são editados aqui; o que cada plano libera, em <strong className="text-texto">Planos e nichos</strong>.
        </>}
      >
        <div className="mb-4">
          <BuscaLista caminho="/admin/usuarios" valor={q} placeholder="Buscar conta pelo nome" />
        </div>
        {externos.length ? (
        <div className="cartao divide-y divide-linha max-h-[36rem] overflow-y-auto">
          {externos.map((p) => (
            <PlanoConta key={p.user_id}
              conta={{
                user_id: p.user_id, nome: p.nome, email: emailPorId.get(p.user_id) ?? "", role: p.role, ativo: p.ativo,
                nicho: (p.nicho as string | null) ?? null, plan_id: (p.plan_id as string | null) ?? null,
                plan_origem: (p.plan_origem as string) ?? "padrao", plan_valido_ate: (p.plan_valido_ate as string | null) ?? null,
                vencido: estaVencido(p.plan_valido_ate as string | null),
              }}
              planos={(planos ?? []) as PlanoOpcao[]}
              ehDiretoria={ehDiretoria}
              papelLabel={PAPEL_LABEL[p.role] ?? p.role}
            />
          ))}
        </div>
        ) : (
          <Vazio icone={UserRound} titulo={q ? "Nenhuma conta com esse nome." : "Nenhuma conta externa ainda."} />
        )}
        <div className="mt-4">
          <Paginacao caminho="/admin/usuarios" pagina={pagina} porPagina={POR_PAGINA} total={totalExternos} params={{ q }} />
        </div>
      </Secao>
    </div>
  );
}
