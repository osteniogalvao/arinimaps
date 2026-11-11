import Link from "next/link";
import { Database, Kanban } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { SETORES } from "@/lib/setores";
import { CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import NovoFunil from "@/components/crm-setores/NovoFunil";

/** CRMs dos setores (Central de CRMs, etapa 5): os funis que eu enxergo. */
export default async function CrmsDosSetores() {
  const user = await exigirEquipe();
  const admin = supabaseAdmin();
  const diretoria = user.setores.includes("diretoria");
  const { data: funis, error } = await admin.from("crm_pipelines").select("id, setor, nome, descricao, ativo")
    .in("setor", user.setores).order("nome");
  if (error) {
    return (
      <div className="max-w-4xl space-y-6">
        <CabecalhoPagina eyebrow="Central" titulo="CRMs dos setores" />
        <Vazio icone={Database} titulo="Falta atualizar o banco" texto="Rode a migration 0069 para ligar os CRMs dos setores." />
      </div>
    );
  }
  const ids = (funis ?? []).map((f) => f.id);
  const { data: abertos } = ids.length
    ? await admin.from("crm_itens").select("pipeline_id, prazo_etapa").in("pipeline_id", ids).eq("status", "aberto").limit(5000)
    : { data: [] };
  const agora = Date.now();
  const conta = new Map<string, { abertos: number; atrasados: number }>();
  for (const i of abertos ?? []) {
    const c = conta.get(i.pipeline_id) ?? { abertos: 0, atrasados: 0 };
    c.abertos++;
    if (i.prazo_etapa && +new Date(i.prazo_etapa) < agora) c.atrasados++;
    conta.set(i.pipeline_id, c);
  }
  const setores = SETORES.filter((s) => user.setores.includes(s.id));

  return (
    <div className="max-w-6xl space-y-8">
      <CabecalhoPagina eyebrow="Central" titulo="CRMs dos setores"
        subtitulo="Cada setor tem os seus funis, com etapas, prazos e campos próprios. Etapa vencida vira tarefa para o responsável." />
      {diretoria && <NovoFunil setores={setores.map((s) => ({ id: s.id, nome: s.nome }))} />}
      {!funis?.length && <Vazio icone={Kanban} titulo="Nenhum funil no seu setor" texto="A Diretoria cria os funis e define as etapas e os campos de cada um." />}
      {setores.map((s) => {
        const doSetor = (funis ?? []).filter((f) => f.setor === s.id);
        if (!doSetor.length) return null;
        return (
          <section key={s.id} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-texto-2">{s.nome}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {doSetor.map((f) => {
                const c = conta.get(f.id) ?? { abertos: 0, atrasados: 0 };
                return (
                  <Link key={f.id} href={`/admin/crm/${f.id}`} className="cartao block space-y-2 p-5 transition hover:border-verde/50">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-texto">{f.nome}</span>
                      {!f.ativo && <Etiqueta>Inativo</Etiqueta>}
                    </div>
                    {f.descricao && <p className="line-clamp-2 text-sm text-texto-2">{f.descricao}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Etiqueta tom="verde">{c.abertos} em aberto</Etiqueta>
                      {c.atrasados > 0 && <Etiqueta tom="critico">{c.atrasados} com prazo vencido</Etiqueta>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
