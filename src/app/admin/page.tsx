import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { SETORES, setorPorId, type SetorId } from "@/lib/setores";
import { formatBRL } from "@/lib/format";
import { ArrowRight, CalendarClock, CircleAlert, ListChecks, UsersRound } from "lucide-react";
import { contar, ICONE_SETOR, LinkAcao, Secao } from "@/components/admin/Painel";
import { CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import { LISTA, LINHA_LISTA } from "@/components/admin/estilos";
import { STATUS_ABERTOS } from "@/lib/cartografia/solicitacoes";
import Excecoes from "@/components/admin/Excecoes";

type Fila = { rotulo: string; n: number | string; href: string; urgente?: boolean };

/**
 * Matriz: a visão de quem administra a empresa inteira. Um cartão por setor,
 * cada um com as filas que pedem ação agora. O membro da equipe vê os
 * setores em que atua; a diretoria vê todos.
 */
export default async function Matriz({ searchParams }: PageProps<"/admin">) {
  const user = await exigirEquipe();
  const semAcesso = (await searchParams).sem_acesso;
  const admin = supabaseAdmin();
  const hoje = new Date().toISOString().slice(0, 10);
  const em30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const ha24h = new Date(Date.now() - 86_400_000).toISOString();

  const [
    emAnalise, cadastros, docsPendentes,
    leadsNovos, emNegociacao,
    comissoesAberto, faturasVencidas,
    lgpdAbertos, autVencendo,
    publicados, leads30,
    chamadosAbertos, falhasLogin,
    cartAbertas, cartRecebidas,
    minhasTarefas, tarefasPorSetor,
  ] = await Promise.all([
    contar("properties", (q) => q.in("status", ["pendente", "em_analise", "correcao"])),
    Promise.all([
      contar("partners", (q) => q.in("status", ["solicitado", "em_analise"])),
      contar("owners", (q) => q.in("status", ["solicitado", "em_analise"])),
    ]).then(([a, b]) => a + b),
    contar("property_documents", (q) => q.eq("verificado", false).is("substituido_por", null)),
    contar("opportunities", (q) => q.eq("etapa", "novo_lead")),
    contar("opportunities", (q) => q.in("etapa", ["proposta_enviada", "contraproposta", "negociacao", "aceite", "contrato"])),
    admin.from("commissions").select("valor").in("status", ["registrada", "cobrada"])
      .then(({ data }) => (data ?? []).reduce((s, c) => s + Number(c.valor), 0)),
    contar("invoices", (q) => q.eq("status", "vencida")),
    contar("lgpd_requests", (q) => q.in("status", ["recebido", "em_analise"])),
    contar("property_authorizations", (q) => q.gte("validade", hoje).lte("validade", em30)),
    contar("properties", (q) => q.in("status", ["publicado", "em_negociacao"])),
    contar("leads", (q) => q.gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())),
    contar("support_tickets", (q) => q.in("status", ["aberto", "em_atendimento"])),
    contar("auth_events", (q) => q.in("evento", ["login_falhou", "login_bloqueado", "mfa_falhou"]).gte("created_at", ha24h)),
    // requisitos cartográficos §2: fila de "não encontrei meu imóvel" / "mapa divergente"
    contar("cartographic_requests", (q) => q.in("status", STATUS_ABERTOS)),
    contar("cartographic_requests", (q) => q.eq("status", "recebida")),
    admin.from("tasks").select("id, titulo, setor, prazo, prioridade")
      .eq("responsavel", user.id).in("status", ["aberta", "andamento", "aguardando", "bloqueada"])
      .order("prazo", { ascending: true, nullsFirst: false }).limit(8)
      .then(({ data }) => data ?? []),
    admin.from("tasks").select("setor").in("status", ["aberta", "andamento", "aguardando", "bloqueada"])
      .then(({ data }) => {
        const m = new Map<string, number>();
        for (const t of data ?? []) m.set(t.setor, (m.get(t.setor) ?? 0) + 1);
        return m;
      }),
  ]);

  const filas: Record<SetorId, Fila[]> = {
    operacoes: [
      { rotulo: "anúncios aguardando análise", n: emAnalise, href: "/admin/imoveis?filtro=analise", urgente: emAnalise > 0 },
      { rotulo: "cadastros para aprovar", n: cadastros, href: "/admin/cadastros", urgente: cadastros > 0 },
      { rotulo: "documentos sem conferência", n: docsPendentes, href: "/admin/operacoes" },
    ],
    comercial: [
      { rotulo: "leads novos", n: leadsNovos, href: "/admin/leads", urgente: leadsNovos > 0 },
      { rotulo: "negociações em andamento", n: emNegociacao, href: "/admin/funil" },
    ],
    financeiro: [
      { rotulo: "em comissões a receber", n: formatBRL(comissoesAberto), href: "/admin/comissoes" },
      { rotulo: "faturas vencidas", n: faturasVencidas, href: "/admin/mensalidades", urgente: faturasVencidas > 0 },
    ],
    juridico: [
      { rotulo: "pedidos LGPD em aberto", n: lgpdAbertos, href: "/admin/juridico/lgpd", urgente: lgpdAbertos > 0 },
      { rotulo: "autorizações vencendo em 30 dias", n: autVencendo, href: "/admin/juridico" },
    ],
    marketing: [
      { rotulo: "imóveis no ar", n: publicados, href: "/admin/marketing" },
      { rotulo: "interessados nos últimos 30 dias", n: leads30, href: "/admin/marketing" },
    ],
    cartografia: [
      { rotulo: "solicitações cartográficas abertas", n: cartAbertas, href: "/admin/cartografia/solicitacoes", urgente: cartRecebidas > 0 },
      { rotulo: "plantas e malha do CAR", n: "→", href: "/admin/cartografia" },
    ],
    suporte: [
      { rotulo: "chamados em aberto", n: chamadosAbertos, href: "/admin/suporte", urgente: chamadosAbertos > 0 },
    ],
    seguranca: [
      { rotulo: "tentativas de acesso recusadas em 24 h", n: falhasLogin, href: "/admin/seguranca", urgente: falhasLogin > 20 },
    ],
    diretoria: [
      { rotulo: "indicadores gerais", n: "→", href: "/admin/relatorios" },
      { rotulo: "equipe e setores", n: "→", href: "/admin/usuarios" },
    ],
  };

  const meus = SETORES.filter((s) => user.setores.includes(s.id));

  const urgentes = meus.reduce((n, s) => n + filas[s.id].filter((f) => f.urgente).length, 0);

  return (
    <div className="space-y-10 md:space-y-12">
      <CabecalhoPagina
        eyebrow="Matriz"
        titulo={`Olá, ${user.nome?.split(" ")[0] || "equipe"}`}
        subtitulo={user.role === "admin_central"
          ? "Visão de todos os setores da empresa. Os números em destaque pedem ação."
          : "Estes são os setores em que você atua. Os números em destaque pedem ação."}
        acoes={urgentes > 0
          ? <Etiqueta tom="ouro" className="!px-3 !py-1.5 !text-sm"><CircleAlert className="size-4" />{urgentes} fila{urgentes === 1 ? "" : "s"} pedindo ação</Etiqueta>
          : undefined}
      />

      {semAcesso && (
        <p className="-mt-4 flex items-start gap-3 rounded-xl border border-alerta/40 bg-alerta/10 px-5 py-4 text-[0.95rem] text-alerta">
          <CircleAlert className="size-5 shrink-0 mt-0.5" />
          <span>
            Você não atua no setor {setorPorId(String(semAcesso))?.nome ?? semAcesso}. Se precisar desse acesso, peça à diretoria
            em Equipe e usuários.
          </span>
        </p>
      )}

      {!meus.length && (
        <Vazio icone={UsersRound} titulo="Nenhum setor ainda"
          texto="Sua conta ainda não foi colocada em nenhum setor. Peça à diretoria para definir os seus setores." />
      )}

      {meus.length > 0 && <Excecoes userId={user.id} setores={user.setores} />}

      {meus.length > 0 && (
        <Secao titulo="Setores">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {meus.map((s) => {
              const tarefas = tarefasPorSetor.get(s.id) ?? 0;
              const Icone = ICONE_SETOR[s.id];
              const temUrgente = filas[s.id].some((f) => f.urgente);
              return (
                <div key={s.id} className={"cartao flex flex-col p-6 border-t-4 " + (temUrgente ? "border-t-ouro" : "border-t-verde/60")}>
                  <Link href={s.href} className="group flex items-start gap-4">
                    <span className={"grid size-11 shrink-0 place-items-center rounded-xl " + (temUrgente ? "bg-ouro/15 text-ouro" : "bg-verde/12 text-verde")}>
                      <Icone className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="lp-display text-xl text-texto transition-colors group-hover:text-verde">{s.nome}</span>
                        <ArrowRight className="size-4 text-texto-2 transition-colors group-hover:text-verde" />
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-texto-2">{s.descricao}</span>
                    </span>
                  </Link>
                  <div className="mt-auto space-y-2 pt-5">
                    {filas[s.id].map((f) => (
                      <Link key={f.rotulo} href={f.href}
                        className={"flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors " +
                          (f.urgente
                            ? "border-ouro/45 bg-ouro/10 hover:border-ouro"
                            : "border-linha bg-superficie-2/60 hover:border-linha-forte hover:bg-superficie-2")}>
                        <span className={"text-sm " + (f.urgente ? "font-semibold text-texto" : "text-texto-2")}>{f.rotulo}</span>
                        <span className={"lp-display text-xl leading-none tabular-nums " + (f.urgente ? "text-ouro" : "text-texto")}>
                          {f.n === "→" ? <ArrowRight className="size-5 text-verde" /> : f.n}
                        </span>
                      </Link>
                    ))}
                    {tarefas > 0 && (
                      <Link href={`/admin/tarefas?setor=${s.id}`}
                        className="inline-flex items-center gap-1.5 px-1 pt-1.5 text-sm font-semibold text-verde hover:underline underline-offset-4">
                        <ListChecks className="size-4" />
                        {tarefas} tarefa{tarefas === 1 ? "" : "s"} aberta{tarefas === 1 ? "" : "s"} no setor
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Secao>
      )}

      <Secao titulo="Minhas tarefas" acao={<LinkAcao href="/admin/tarefas">Ver todas</LinkAcao>}>
        <div className={LISTA}>
          {minhasTarefas.map((t) => {
            const atrasada = !!t.prazo && t.prazo < hoje;
            return (
              <Link key={t.id} href={`/admin/tarefas/${t.id}`} className={LINHA_LISTA}>
                <span className="flex-1 min-w-48 font-medium text-texto">
                  {t.titulo}
                  {t.prioridade === "alta" && <Etiqueta tom="critico" className="ml-2 align-middle !py-0.5">Alta</Etiqueta>}
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ouro">{setorPorId(t.setor)?.nome}</span>
                {t.prazo && (
                  <span className={"inline-flex items-center gap-1 text-xs tabular-nums " + (atrasada ? "font-semibold text-critico" : "text-texto-2")}>
                    <CalendarClock className="size-3.5" />
                    {new Date(t.prazo + "T12:00:00").toLocaleDateString("pt-BR")}
                  </span>
                )}
              </Link>
            );
          })}
          {!minhasTarefas.length && (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <ListChecks className="size-6 text-verde" />
              <p className="text-[0.95rem] text-texto-2">Nenhuma tarefa com você no momento.</p>
            </div>
          )}
        </div>
      </Secao>
    </div>
  );
}
