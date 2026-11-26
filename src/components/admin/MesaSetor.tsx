import Link from "next/link";
import { ArrowRight, CalendarDays, CalendarPlus, Kanban, ListChecks, MessagesSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Setor, SetorId } from "@/lib/setores";
import type { CompromissoSetor } from "@/lib/agenda-setores";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";

const TZ = "America/Sao_Paulo";
const diaMes = (iso: string) => iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/");
const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: TZ }) === d.toLocaleDateString("pt-BR", { timeZone: TZ });
  return d.toLocaleString("pt-BR", hoje ? { timeZone: TZ, timeStyle: "short" } : { timeZone: TZ, day: "2-digit", month: "2-digit" });
};

export type Faixa = { rotulo: string; n: number; atrasados?: number };
export type Funil = { id: string; nome: string; href: string; faixas: Faixa[]; abertos: number; atrasados: number };
export type ConversaMesa = { id: string; codigo: string; nome: string | null; telefone: string; responsavel: string | null; nao_lidas: number; ultimo_texto: string | null; ultima_mensagem_em: string };
export type TarefaMesa = { id: string; titulo: string; prazo: string | null; prioridade: string | null; status: string };

/** Desenho da visão geral do setor (dados vêm de app/admin/setor/[id]). */
export default function MesaSetor({ setor, hoje, conversas, conversasErro, funis, agenda, tarefas, tarefasErro }: {
  setor: Setor; hoje: string;
  conversas: ConversaMesa[]; conversasErro: boolean;
  funis: Funil[];
  agenda: { itens: CompromissoSetor[]; falhas: string[] };
  tarefas: TarefaMesa[]; tarefasErro: boolean;
}) {
  const id: SetorId = setor.id;
  const diretoria = id === "diretoria";
  const listaConversas = conversas;
  const semDono = listaConversas.filter((c) => !c.responsavel).length;
  const naoLidas = listaConversas.filter((c) => c.nao_lidas > 0).length;
  const caixa = diretoria ? "central" : `setor:${id}`;
  const listaTarefas = tarefas;
  const tarefasAtrasadas = listaTarefas.filter((t) => t.prazo && t.prazo.slice(0, 10) < hoje).length;
  const rConversas = { error: conversasErro };
  const rTarefas = { error: tarefasErro };

  return (
    <div className="space-y-8">
      <CabecalhoPagina eyebrow="Setor" titulo={setor.nome} subtitulo={setor.descricao}
        acoes={<>
          <Link href={`/admin/atendimento?caixa=${encodeURIComponent(caixa)}`} className="btn-verde inline-flex items-center gap-2 px-4 py-2 text-sm">
            <MessagesSquare className="size-4" /> Atender
          </Link>
          <Link href={`/admin/agenda-setores?setor=${id}&agendar=1#reuniao`} className="btn-contorno inline-flex items-center gap-2 px-4 py-2 text-sm">
            <CalendarPlus className="size-4" /> Agendar
          </Link>
        </>} />

      {/* o caminho do trabalho, na ordem em que ele acontece */}
      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Etapas do trabalho no setor">
        {[
          ["Atender", `${listaConversas.length} conversa${listaConversas.length === 1 ? "" : "s"}`, "#atendimento"],
          ["Conduzir no funil", `${funis.reduce((s, f) => s + f.abertos, 0)} em aberto`, "#funil"],
          ["Agendar", `${agenda.itens.length} nos próximos 14 dias`, "#agenda"],
          ["Cumprir tarefas", `${listaTarefas.length} aberta${listaTarefas.length === 1 ? "" : "s"}`, "#tarefas"],
        ].map(([t, sub, href], k) => (
          <li key={t}>
            <a href={href} className="cartao cartao-link flex h-full items-center gap-3 p-3 sm:p-4">
              <span className="lp-display grid size-9 shrink-0 place-items-center rounded-full bg-verde/12 text-verde">{k + 1}</span>
              <span className="min-w-0">
                <span className="block font-semibold text-texto">{t}</span>
                <span className="block truncate text-sm text-texto-2">{sub}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 1. atendimento */}
        <Bloco id="atendimento" numero={1} icone={MessagesSquare} titulo={diretoria ? "Caixa central" : "Atendimento do setor"}
          acao={{ href: `/admin/atendimento?caixa=${encodeURIComponent(caixa)}`, rotulo: "Abrir atendimento" }}>
          {rConversas.error ? <p className="text-sm text-texto-2">Atendimento indisponível no momento.</p> : <>
            <div className="flex flex-wrap gap-2">
              <Etiqueta tom="verde">{listaConversas.length} em aberto</Etiqueta>
              {semDono > 0 && <Etiqueta tom="ouro">{semDono} sem responsável</Etiqueta>}
              {naoLidas > 0 && <Etiqueta tom="alerta">{naoLidas} com mensagem nova</Etiqueta>}
            </div>
            <Lista vazio="Nenhuma conversa esperando o setor.">
              {listaConversas.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/atendimento?caixa=${encodeURIComponent(caixa)}&c=${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-superficie-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-texto">{c.nome || c.telefone}</span>
                      {c.ultimo_texto && <span className="block truncate text-sm text-texto-2">{c.ultimo_texto}</span>}
                    </span>
                    {c.nao_lidas > 0 && <span className="size-2 shrink-0 rounded-full bg-ouro" aria-label="Mensagem nova" />}
                    <time className="shrink-0 text-xs text-texto-2" dateTime={c.ultima_mensagem_em}>{quando(c.ultima_mensagem_em)}</time>
                  </Link>
                </li>
              ))}
            </Lista>
          </>}
        </Bloco>

        {/* 2. funil (pipeline), etapa por etapa */}
        <Bloco id="funil" numero={2} icone={Kanban} titulo="CRM do setor"
          acao={funis.length === 1 ? { href: funis[0].href, rotulo: "Abrir o funil" } : { href: "/admin/crm", rotulo: "Todos os funis" }}>
          {!funis.length && <p className="text-sm text-texto-2">O setor ainda não tem funil. A Diretoria cria em Todos os funis.</p>}
          {funis.map((f) => (
            <div key={f.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={f.href} className="font-semibold text-texto hover:text-verde">{f.nome}</Link>
                <Etiqueta tom="verde">{f.abertos} em aberto</Etiqueta>
                {f.atrasados > 0 && <Etiqueta tom="critico">{f.atrasados} com prazo vencido</Etiqueta>}
              </div>
              <ol className="flex gap-1.5 overflow-x-auto pb-1">
                {f.faixas.map((e, k) => (
                  <li key={e.rotulo + k} className="shrink-0">
                    <Link href={f.href} title={`${e.rotulo}: ${e.n}`}
                      className={`block min-w-[6.5rem] rounded-xl border px-3 py-2 text-center transition-colors hover:border-verde ${e.n ? "border-linha-forte bg-superficie-2" : "border-linha text-texto-2"}`}>
                      <span className="lp-display block text-xl leading-none tabular-nums">{e.n}</span>
                      <span className="mt-1 block truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-texto-2">{e.rotulo}</span>
                      {!!e.atrasados && <span className="mt-0.5 block text-[11px] font-semibold text-critico">{e.atrasados} vencido{e.atrasados === 1 ? "" : "s"}</span>}
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Bloco>

        {/* 3. agenda e agendamento */}
        <Bloco id="agenda" numero={3} icone={CalendarDays} titulo="Agenda do setor"
          acao={{ href: `/admin/agenda-setores?setor=${id}`, rotulo: "Agenda compartilhada" }}>
          {!!agenda.falhas.length && <p className="text-sm text-alerta">Não foi possível consultar: {agenda.falhas.join(", ")}.</p>}
          <Lista vazio="Nada marcado nos próximos 14 dias.">
            {agenda.itens.slice(0, 6).map((i) => (
              <li key={`${i.tipo}:${i.id}`}>
                <Link href={i.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-superficie-2">
                  <time className={`w-12 shrink-0 text-sm tabular-nums ${i.data.slice(0, 10) <= hoje ? "font-semibold text-ouro" : "text-texto-2"}`} dateTime={i.data}>{diaMes(i.data)}</time>
                  <span className="min-w-0 flex-1 truncate font-medium text-texto">{i.titulo}</span>
                  <span className="shrink-0 text-xs text-texto-2">{i.tipo}</span>
                </Link>
              </li>
            ))}
          </Lista>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={`/admin/agenda-setores?setor=${id}&agendar=1#reuniao`} className="btn-contorno inline-flex items-center gap-1.5 px-3 py-1.5"><CalendarPlus className="size-4" /> Agendar reunião</Link>
            {id === "comercial" && <Link href="/admin/agenda" className="btn-contorno px-3 py-1.5">Visitas e próximos contatos</Link>}
          </div>
        </Bloco>

        {/* 4. tarefas */}
        <Bloco id="tarefas" numero={4} icone={ListChecks} titulo="Tarefas do setor"
          acao={{ href: `/admin/tarefas?setor=${id}`, rotulo: "Abrir tarefas" }}>
          {rTarefas.error ? <p className="text-sm text-texto-2">Tarefas indisponíveis no momento.</p> : <>
            <div className="flex flex-wrap gap-2">
              <Etiqueta tom="verde">{listaTarefas.length} aberta{listaTarefas.length === 1 ? "" : "s"}</Etiqueta>
              {tarefasAtrasadas > 0 && <Etiqueta tom="critico">{tarefasAtrasadas} atrasada{tarefasAtrasadas === 1 ? "" : "s"}</Etiqueta>}
            </div>
            <Lista vazio="Nenhuma tarefa aberta no setor.">
              {listaTarefas.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <Link href={`/admin/tarefas/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-superficie-2">
                    <time className={`w-12 shrink-0 text-sm tabular-nums ${t.prazo && t.prazo.slice(0, 10) < hoje ? "font-semibold text-critico" : "text-texto-2"}`}>{t.prazo ? diaMes(t.prazo) : "—"}</time>
                    <span className="min-w-0 flex-1 truncate font-medium text-texto">{t.titulo}</span>
                    {t.prioridade === "alta" && <Etiqueta tom="ouro">Alta</Etiqueta>}
                  </Link>
                </li>
              ))}
            </Lista>
          </>}
        </Bloco>
      </div>

    </div>
  );
}

function Bloco({ id, numero, icone: Icone, titulo, acao, children }: {
  id: string; numero: number; icone: LucideIcon; titulo: string; acao: { href: string; rotulo: string }; children: React.ReactNode;
}) {
  return (
    <section id={id} className="cartao scroll-mt-24 space-y-4 p-5">
      <header className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-verde/10 text-verde"><Icone className="size-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ouro">Etapa {numero}</p>
          <h2 className="lp-display truncate text-xl text-texto">{titulo}</h2>
        </div>
        <Link href={acao.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-verde hover:underline">
          {acao.rotulo} <ArrowRight className="size-4" />
        </Link>
      </header>
      {children}
    </section>
  );
}

function Lista({ vazio, children }: { vazio: string; children: React.ReactNode[] }) {
  return children.length
    ? <ul className="divide-y divide-linha overflow-hidden rounded-xl border border-linha">{children}</ul>
    : <p className="rounded-xl border border-dashed border-linha px-4 py-6 text-center text-sm text-texto-2">{vazio}</p>;
}
