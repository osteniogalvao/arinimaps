import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { exigirSetor } from "@/lib/setores-servidor";
import { NICHOS, PAPEIS_EQUIPE_IDS, type Plano } from "@/lib/planos";
import { PAPEL_LABEL } from "@/lib/perfis";
import PlanosAdmin from "./PlanosAdmin";
import { CabecalhoPagina, Etiqueta, Secao } from "@/components/ui/Pagina";
import { Users } from "lucide-react";
import { plural } from "@/lib/format";
import { LinkAcao } from "@/components/admin/Painel";

/**
 * Planos e nichos (pedido do Carlos, 05/10/2026). O que cada plano libera é
 * editado aqui e vale na hora; o significado de cada recurso está no código
 * (src/lib/planos.ts) — recurso novo exige o desenvolvedor.
 */
export default async function AdminPlanos() {
  await exigirSetor("diretoria");
  const admin = supabaseAdmin();
  const [{ data: planosRaw }, { data: perfis }, user] = await Promise.all([
    admin.from("plans").select("*").order("ordem").order("id"),
    admin.from("profiles").select("role, nicho, plan_id").eq("ativo", true),
    currentUser(),
  ]);
  const planos = (planosRaw ?? []) as Plano[];

  // contagem de contas por nicho e por plano (a equipe fica de fora: não tem plano)
  const porNicho: Record<string, number> = {};
  const porPlano: Record<string, number> = {};
  for (const p of perfis ?? []) {
    if (PAPEIS_EQUIPE_IDS.includes(p.role)) continue;
    if (p.nicho) porNicho[p.nicho] = (porNicho[p.nicho] ?? 0) + 1;
    if (p.plan_id) porPlano[p.plan_id] = (porPlano[p.plan_id] ?? 0) + 1;
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-12">
      <CabecalhoPagina
        variante="simples"
        eyebrow="Central · Diretoria"
        titulo="Planos e nichos"
        acoes={<><LinkAcao href="/admin/planos/solicitacoes">Solicitações de planos</LinkAcao><LinkAcao href="/admin/planos/matriz">Matriz de personas</LinkAcao></>}
        subtitulo="Cada conta externa tem um nicho (o segmento comercial) e um plano (o que ela pode usar). O que você mudar aqui vale imediatamente para todas as contas do plano. A equipe da Arini não usa plano: o papel libera tudo."
      />

      <PlanosAdmin planos={planos} contasPorPlano={porPlano} ehDiretoria={user?.role === "admin_central"} />

      <Secao
        eyebrow="Segmentos"
        titulo="Nichos"
        subtitulo="Personas do Fluxograma Mestre. A lista é fixa no código; o plano padrão de cada nicho é definido marcando o nicho no plano, acima."
      >
        <div className="cartao overflow-hidden divide-y divide-linha">
          {NICHOS.map((n) => {
            const padrao = planos.find((p) => p.ativo && p.nichos_padrao.includes(n.id));
            return (
              <div key={n.id} className="px-5 py-4 flex items-start gap-4 flex-wrap text-[0.95rem] transition-colors hover:bg-superficie-2/50">
                <div className="flex-1 min-w-56">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-texto">
                    {n.nome} <span className="font-mono text-xs font-normal text-texto-2">{n.id}</span>
                    {n.reservado && <Etiqueta tom="ouro">reservado</Etiqueta>}
                    {!n.escolhivel && <Etiqueta tom="neutro">definido pela Matriz</Etiqueta>}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-texto-2">{n.descricao}</p>
                  <p className="text-sm text-texto-2 mt-1.5">
                    Papéis: {n.papeis.map((r) => PAPEL_LABEL[r] ?? r).join(", ")} · plano padrão:{" "}
                    <span className="font-semibold text-texto">{padrao?.nome ?? "nenhum"}</span>
                  </p>
                </div>
                <Etiqueta tom="neutro" className="tabular-nums">
                  <Users className="size-3.5" /> {plural(porNicho[n.id] ?? 0, "conta")}
                </Etiqueta>
              </div>
            );
          })}
        </div>
      </Secao>
    </div>
  );
}
