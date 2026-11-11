import Link from "next/link";
import { Bell, Clock, Gauge, ListChecks, UserRound } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { buscarTarefas } from "@/lib/central";
import { TAREFA_STATUS_ABERTOS, TAREFA_STATUS_LABEL } from "@/lib/setores";
import { diaSP, horaSP } from "@/lib/ponto";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";
import { Indicadores, Secao } from "@/components/admin/Painel";
import { LISTA, LINHA_LISTA, LISTA_VAZIA } from "@/components/admin/estilos";
import ResumoIa from "@/components/admin/ResumoIa";

const FECHADAS = ["fechado", "pos_venda", "perdido"];

/**
 * Painel individual do colaborador (Central de CRMs): o que é meu hoje.
 * Tarefas, leads, itens de CRM, ponto, avisos e a minha carga contra a
 * capacidade definida pela Diretoria.
 */
export default async function MeuPainel() {
  const user = await exigirEquipe();
  const admin = supabaseAdmin();
  const hoje = diaSP(new Date());
  const [tarefas, { data: leads }, { data: perfil }, { data: ponto }, { count: avisos }, { data: itens }] = await Promise.all([
    buscarTarefas((q) => q.eq("responsavel", user.id).in("status", TAREFA_STATUS_ABERTOS).order("prazo", { ascending: true, nullsFirst: false }), 50),
    admin.from("opportunities").select("id, codigo, etapa, prazo_atendimento, primeiro_atendimento_em, lead:leads(nome)")
      .eq("responsavel_user_id", user.id).not("etapa", "in", `(${FECHADAS.join(",")})`).order("created_at", { ascending: false }).limit(30),
    admin.from("profiles").select("capacidade_tarefas").eq("user_id", user.id).maybeSingle(),
    admin.from("ponto_marcacoes").select("marcado_em").eq("user_id", user.id).gte("marcado_em", new Date(`${hoje}T00:00:00-03:00`).toISOString()).order("marcado_em"),
    admin.from("notificacoes").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("lida_em", null),
    admin.from("crm_itens").select("id, codigo, titulo, prazo_etapa, etapa:crm_etapas(nome)").eq("responsavel", user.id).eq("status", "aberto").order("prazo_etapa").limit(30),
  ]);
  const carga = tarefas.length + (leads?.length ?? 0) + (itens?.length ?? 0);
  const capacidade = Number(perfil?.capacidade_tarefas ?? 15);
  const agora = Date.now();
  const atrasada = (p: string | null | undefined) => !!p && +new Date(p.length === 10 ? `${p}T23:59:59` : p) < agora;

  return (
    <div className="max-w-6xl space-y-10">
      <CabecalhoPagina eyebrow="Central" titulo={`Olá, ${(user.nome ?? "").split(" ")[0] || "equipe"}`} subtitulo="O que é seu agora, em um lugar só." />
      <Indicadores itens={[
        { rotulo: "Minhas tarefas", icone: ListChecks, valor: tarefas.length, href: "/admin/tarefas?visao=minhas", destaque: tarefas.some((t) => atrasada(t.prazo)) },
        { rotulo: "Meus leads", icone: UserRound, valor: leads?.length ?? 0, href: "/admin/leads?aba=meus", destaque: (leads ?? []).some((l) => !l.primeiro_atendimento_em && atrasada(l.prazo_atendimento)) },
        { rotulo: "Carga / capacidade", icone: Gauge, valor: `${carga} / ${capacidade}`, destaque: carga > capacidade, nota: carga > capacidade ? "acima da capacidade" : undefined },
        { rotulo: "Avisos não lidos", icone: Bell, valor: avisos ?? 0 },
      ]} />

      <ResumoIa escopo="eu" />

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-6">
        <Secao titulo="Minhas tarefas">
          <div className={LISTA}>
            {tarefas.map((t) => (
              <Link key={t.id} href={`/admin/tarefas/${t.id}`} className={LINHA_LISTA}>
                <span className="min-w-0 flex-1 font-medium text-texto">{t.titulo}</span>
                {t.prazo && <span className={"text-xs " + (atrasada(t.prazo) ? "text-critico" : "text-texto-2")}>{new Date(`${t.prazo.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}</span>}
                <Etiqueta tom={t.status === "bloqueada" ? "critico" : "neutro"}>{TAREFA_STATUS_LABEL[t.status] ?? t.status}</Etiqueta>
              </Link>
            ))}
            {!tarefas.length && <p className={LISTA_VAZIA}>Nenhuma tarefa com você.</p>}
          </div>
        </Secao>
        <Secao titulo="Meus leads">
          <div className={LISTA}>
            {(leads ?? []).map((o) => (
              <Link key={o.id} href={`/admin/oportunidades/${o.id}`} className={LINHA_LISTA}>
                <span className="min-w-0 flex-1 font-medium text-texto">{(o.lead as unknown as { nome: string } | null)?.nome ?? o.codigo}</span>
                {!o.primeiro_atendimento_em && <Etiqueta tom={atrasada(o.prazo_atendimento) ? "critico" : "ouro"}>sem contato</Etiqueta>}
                <span className="text-xs text-texto-2">{o.etapa.replace(/_/g, " ")}</span>
              </Link>
            ))}
            {!leads?.length && <p className={LISTA_VAZIA}>Nenhum lead com você.</p>}
          </div>
        </Secao>
        {!!itens?.length && (
          <Secao titulo="Meus itens nos CRMs dos setores">
            <div className={LISTA}>
              {itens.map((i) => (
                <Link key={i.id} href={`/admin/crm/item/${i.id}`} className={LINHA_LISTA}>
                  <span className="font-mono text-xs text-texto-2">{i.codigo}</span>
                  <span className="min-w-0 flex-1 font-medium text-texto">{i.titulo}</span>
                  <span className={"text-xs " + (atrasada(i.prazo_etapa) ? "text-critico" : "text-texto-2")}>{(i.etapa as unknown as { nome: string } | null)?.nome}</span>
                </Link>
              ))}
            </div>
          </Secao>
        )}
        <Secao titulo="Ponto de hoje">
          <Link href="/admin/ponto" className="cartao flex items-center gap-3 p-5 hover:bg-superficie-2/70">
            <Clock className="size-5 text-ouro" />
            <span className="text-texto">{ponto?.length ? ponto.map((m) => horaSP(m.marcado_em)).join(" · ") : "Nenhuma marcação hoje"}</span>
          </Link>
        </Secao>
      </div>
    </div>
  );
}
