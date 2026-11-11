import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { setorPorId, type SetorId } from "@/lib/setores";
import type { CampoCrm, Etapa, ItemCrm, Pipeline } from "@/lib/crmSetores";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import QuadroCrm from "@/components/crm-setores/QuadroCrm";
import ConfigFunil from "@/components/crm-setores/ConfigFunil";

/** Quadro de um funil do setor; com ?config=1 a Diretoria edita etapas e campos. */
export default async function FunilDoSetor({ params, searchParams }: PageProps<"/admin/crm/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await exigirEquipe();
  const admin = supabaseAdmin();
  const { data: p } = await admin.from("crm_pipelines").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const pipeline = p as Pipeline;
  if (!user.setores.includes(pipeline.setor as SetorId)) redirect(`/admin/crm`);
  const diretoria = user.setores.includes("diretoria");
  const config = diretoria && sp.config === "1";

  const [{ data: etapas }, { data: campos }, { data: itens }, { data: equipe }] = await Promise.all([
    admin.from("crm_etapas").select("*").eq("pipeline_id", id).order("ordem"),
    admin.from("crm_campos").select("*").eq("pipeline_id", id).order("ordem"),
    admin.from("crm_itens").select("*").eq("pipeline_id", id).eq("status", "aberto").order("entrou_etapa_em").limit(500),
    admin.from("profiles").select("user_id, nome").in("role", ["admin_central", "analista_arini"]).order("nome"),
  ]);
  const membros = (equipe ?? []).map((m) => ({ user_id: m.user_id as string, nome: (m.nome as string) || "—" }));

  return (
    <div className="max-w-[90rem] space-y-6">
      <CabecalhoPagina eyebrow={`CRM · ${setorPorId(pipeline.setor)?.nome ?? pipeline.setor}`} titulo={pipeline.nome} subtitulo={pipeline.descricao ?? undefined} />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/crm" className="btn-contorno px-3 py-1.5">← Todos os funis</Link>
        {diretoria && (config
          ? <Link href={`/admin/crm/${id}`} className="btn-contorno px-3 py-1.5">Ver o quadro</Link>
          : <Link href={`/admin/crm/${id}?config=1`} className="btn-contorno inline-flex items-center gap-1.5 px-3 py-1.5"><Settings className="size-4" /> Configurar etapas e campos</Link>)}
      </div>
      {config
        ? <ConfigFunil pipeline={pipeline} etapas={(etapas ?? []) as Etapa[]} campos={(campos ?? []) as CampoCrm[]} />
        : <QuadroCrm pipelineId={id} etapas={(etapas ?? []) as Etapa[]} campos={(campos ?? []) as CampoCrm[]} itens={(itens ?? []) as ItemCrm[]} equipe={membros} souEu={user.id} />}
    </div>
  );
}
