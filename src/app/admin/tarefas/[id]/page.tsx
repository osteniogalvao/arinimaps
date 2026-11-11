import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Bot } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { SETORES, TAREFA_ORIGEM_LABEL, TAREFA_STATUS_LABEL, PRIORIDADE_LABEL, setorPorId, type SetorId } from "@/lib/setores";
import { equipeAtiva } from "@/components/admin/Painel";
import TarefaDetalhe, { type EventoLinha } from "@/components/admin/TarefaDetalhe";
import Conversa from "@/components/admin/Conversa";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";

const nomeSetor = (id: string | null | undefined) => (id ? setorPorId(id)?.nome ?? id : "—");

/** Uma tarefa com a linha do tempo: quem criou, encaminhou, aceitou, comentou e concluiu. */
export default async function TarefaPagina({ params }: PageProps<"/admin/tarefas/[id]">) {
  const user = await exigirEquipe();
  const { id } = await params;
  const admin = supabaseAdmin();

  const { data: t } = await admin.from("tasks").select("*").eq("id", id).maybeSingle();
  if (!t) notFound();
  const doSetor = user.setores.includes(t.setor as SetorId);
  const enviou = !!t.setor_origem && user.setores.includes(t.setor_origem as SetorId);
  if (!doSetor && !enviou) notFound();

  const [{ data: eventos }, equipe, { data: opp }, { data: imovel }] = await Promise.all([
    admin.from("task_events").select("id, tipo, texto, de_setor, para_setor, dados, created_at, autor").eq("task_id", id).order("created_at"),
    equipeAtiva(),
    t.opportunity_id ? admin.from("opportunities").select("id, codigo").eq("id", t.opportunity_id).maybeSingle() : Promise.resolve({ data: null }),
    t.property_id ? admin.from("properties").select("id, codigo, titulo").eq("id", t.property_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const linha: EventoLinha[] = (eventos ?? []).map((e) => ({
    id: e.id, tipo: e.tipo, texto: e.texto, quando: e.created_at,
    autor: e.autor ? nome.get(e.autor) ?? "Equipe" : "Sistema",
    de: e.de_setor ? nomeSetor(e.de_setor) : null, para: e.para_setor ? nomeSetor(e.para_setor) : null,
    dados: (e.dados ?? {}) as Record<string, unknown>,
  }));

  const esperandoAceite = t.origem === "encaminhada" && !t.aceite_em && t.status === "aberta";

  return (
    <div className="space-y-8 max-w-4xl">
      <Link href="/admin/tarefas" className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline underline-offset-4">
        <ArrowLeft className="size-4" /> Tarefas
      </Link>
      <CabecalhoPagina eyebrow={`${t.codigo ?? "Tarefa"} · ${nomeSetor(t.setor)}`} titulo={t.titulo}
        subtitulo={t.descricao ?? undefined}
        acoes={
          <div className="flex flex-wrap gap-2">
            <Etiqueta tom={t.status === "concluida" ? "verde" : t.status === "bloqueada" ? "critico" : "ouro"}>{TAREFA_STATUS_LABEL[t.status] ?? t.status}</Etiqueta>
            {t.prioridade === "alta" && <Etiqueta tom="critico">Prioridade {PRIORIDADE_LABEL.alta.toLowerCase()}</Etiqueta>}
            {t.escalonada_em && <Etiqueta tom="critico">Subiu para a Diretoria</Etiqueta>}
          </div>
        } />

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <Item rotulo="Origem">
          {t.origem === "automatica" && <Bot className="mr-1 inline size-4 text-ouro" />}
          {TAREFA_ORIGEM_LABEL[t.origem ?? "manual"]}{t.regra ? ` (${t.regra})` : ""}
          {t.setor_origem && <> · de {nomeSetor(t.setor_origem)}</>}
        </Item>
        <Item rotulo="Responsável">{t.responsavel ? nome.get(t.responsavel) ?? "—" : "Ninguém ainda"}</Item>
        <Item rotulo="Prazo">{t.prazo ? new Date(t.prazo + "T12:00:00").toLocaleDateString("pt-BR") : "Sem prazo"}</Item>
        {esperandoAceite && t.prazo_aceite && (
          <Item rotulo="Aceitar até">{new Date(t.prazo_aceite).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</Item>
        )}
        {t.criterio_conclusao && <Item rotulo="Critério de conclusão">{t.criterio_conclusao}</Item>}
        {t.evidencia && <Item rotulo="Evidência">{t.evidencia}</Item>}
        {t.motivo && <Item rotulo="Último motivo">{t.motivo}</Item>}
        {opp && (
          <Item rotulo="Oportunidade">
            <Link href={`/admin/oportunidades/${opp.id}`} className="inline-flex items-center gap-1 font-semibold text-verde hover:underline">{opp.codigo}<ArrowRight className="size-3.5" /></Link>
          </Item>
        )}
        {imovel && (
          <Item rotulo="Imóvel">
            <Link href={`/admin/imoveis/${imovel.id}`} className="inline-flex items-center gap-1 font-semibold text-verde hover:underline">{imovel.codigo}<ArrowRight className="size-3.5" /></Link>
          </Item>
        )}
      </dl>

      <TarefaDetalhe
        id={t.id}
        status={t.status}
        setor={t.setor}
        responsavel={t.responsavel}
        esperandoAceite={esperandoAceite}
        podeAgir={doSetor}
        devolvivel={!!t.setor_origem}
        equipe={equipe}
        setores={SETORES.filter((s) => s.id !== t.setor).map((s) => ({ id: s.id, nome: s.nome }))}
        linha={linha}
      />
      <Conversa entidade="tasks" id={t.id} />
    </div>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-linha bg-superficie-2/60 px-4 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-texto-2">{rotulo}</dt>
      <dd className="mt-1 text-texto">{children}</dd>
    </div>
  );
}
