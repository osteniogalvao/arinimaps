import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { SETORES, setorPorId, setoresDe, type SetorId } from "@/lib/setores";
import type { CampoCrm, Etapa, ItemCrm, Pipeline } from "@/lib/crmSetores";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";
import { Secao } from "@/components/admin/Painel";
import Conversa from "@/components/admin/Conversa";
import ItemCrmDetalhe from "@/components/crm-setores/ItemCrmDetalhe";

/** Ficha de um item do CRM do setor: campos, etapa, histórico e conversa. */
export default async function ItemDoCrm({ params }: PageProps<"/admin/crm/item/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await exigirEquipe();
  const admin = supabaseAdmin();
  const { data: i } = await admin.from("crm_itens").select("*").eq("id", id).maybeSingle();
  if (!i) notFound();
  const item = i as ItemCrm & { property_id: string | null; opportunity_id: string | null };
  const { data: p } = await admin.from("crm_pipelines").select("*").eq("id", item.pipeline_id).maybeSingle();
  const pipeline = p as Pipeline;
  // quem recebeu o item por delegação abre a ficha mesmo sendo de outro setor (23/11/2026)
  const doSetor = user.setores.includes(pipeline.setor as SetorId);
  if (!doSetor && item.responsavel !== user.id) redirect("/admin/crm");

  const [{ data: etapas }, { data: campos }, { data: eventos }, { data: equipe }] = await Promise.all([
    admin.from("crm_etapas").select("*").eq("pipeline_id", pipeline.id).order("ordem"),
    admin.from("crm_campos").select("*").eq("pipeline_id", pipeline.id).order("ordem"),
    admin.from("crm_item_eventos").select("id, tipo, autor, texto, created_at").eq("item_id", id).order("created_at", { ascending: false }).limit(200),
    admin.from("profiles").select("user_id, nome, role, setores, ativo").in("role", ["admin_central", "analista_arini"]).order("nome"),
  ]);
  const { data: funis } = await admin.from("crm_pipelines").select("id, setor, nome, ativo").neq("id", pipeline.id).order("nome");
  const membros = (equipe ?? []).filter((m) => m.ativo !== false).map((m) => ({
    user_id: m.user_id as string, nome: (m.nome as string) || "—",
    setores: setoresDe(m.role as string, m.setores as string[] | null) as string[],
  }));
  const nome = new Map((equipe ?? []).map((m) => [m.user_id as string, (m.nome as string) || "—"]));
  const etapa = (etapas ?? []).find((e) => e.id === item.etapa_id);
  const tom = item.status === "aberto" ? "verde" : item.status === "concluido" ? "ouro" : "neutro";

  return (
    <div className="max-w-5xl space-y-8">
      <CabecalhoPagina eyebrow={`CRM · ${setorPorId(pipeline.setor)?.nome ?? pipeline.setor} · ${item.codigo}`} titulo={item.titulo} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {doSetor ? <Link href={`/admin/crm/${pipeline.id}`} className="btn-contorno px-3 py-1.5">← {pipeline.nome}</Link>
          : <Link href="/admin/crm" className="btn-contorno px-3 py-1.5">← CRMs</Link>}
        <Etiqueta tom={tom}>{item.status === "aberto" ? `Em: ${etapa?.nome ?? "—"}` : item.status === "concluido" ? "Concluído" : "Cancelado"}</Etiqueta>
        {item.prazo_etapa && item.status === "aberto" && (
          <Etiqueta tom={+new Date(item.prazo_etapa) < Date.now() ? "critico" : "neutro"}>
            Prazo da etapa: {new Date(item.prazo_etapa).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}
          </Etiqueta>
        )}
        {item.property_id && <Link href={`/admin/imoveis/${item.property_id}`} className="text-verde hover:underline">Imóvel vinculado</Link>}
        {item.opportunity_id && <Link href={`/admin/oportunidades/${item.opportunity_id}`} className="text-verde hover:underline">Oportunidade vinculada</Link>}
      </div>

      {!doSetor && <p className="rounded-lg border border-ouro/40 bg-ouro/10 px-4 py-3 text-sm">Este item foi delegado a você pelo setor {setorPorId(pipeline.setor)?.nome ?? pipeline.setor}. Você pode atualizar, avançar, devolver ou encaminhar.</p>}
      <ItemCrmDetalhe item={item} etapas={(etapas ?? []) as Etapa[]} campos={(campos ?? []) as CampoCrm[]} equipe={membros} setorDoFunil={pipeline.setor}
        funis={(funis ?? []).filter((f) => f.ativo !== false).map((f) => ({ id: f.id as string, nome: f.nome as string, setor: f.setor as string,
          setorNome: SETORES.find((x) => x.id === f.setor)?.nome ?? (f.setor as string) }))} />

      <Secao titulo="Conversa">
        <Conversa entidade="crm_itens" id={item.id} />
      </Secao>

      <Secao titulo="Histórico">
        <ol className="space-y-2 text-sm">
          {(eventos ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2 border-b border-linha pb-2">
              <span className="text-texto-2">{new Date(e.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}</span>
              <span className="font-medium text-texto">{nome.get(e.autor ?? "") ?? "Sistema"}</span>
              <span className="text-texto-2">{e.texto}</span>
            </li>
          ))}
          {!eventos?.length && <li className="text-texto-2">Sem eventos.</li>}
        </ol>
      </Secao>
    </div>
  );
}
