"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Bot, CalendarClock, Check, CheckCircle2, Inbox, ListChecks, Plus, Send, UserRound, X } from "lucide-react";
import { PRIORIDADE_LABEL, TAREFA_STATUS_LABEL } from "@/lib/setores";
import { Etiqueta } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO } from "./estilos";

export type Tarefa = {
  id: string; titulo: string; descricao: string | null; setor: string; status: string;
  prioridade: string; prazo: string | null; responsavel: string | null; responsavel_nome?: string | null;
  codigo?: string | null; origem?: string | null; setor_origem?: string | null; aceite_em?: string | null;
  prazo_aceite?: string | null; regra?: string | null; escalonada_em?: string | null;
};
export type Membro = { user_id: string; nome: string };

const hoje = () => new Date().toISOString().slice(0, 10);
const ABERTOS = ["aberta", "andamento", "aguardando", "bloqueada"];

/**
 * Lista de tarefas de um setor, com criação rápida e encaminhamento para outro
 * setor (Central operacional, migration 0065). Tarefa encaminhada chega na
 * caixa de entrada do setor e precisa ser aceita ou devolvida com motivo.
 */
export default function Tarefas({
  setor, tarefas, equipe, souEu, mostrarSetor = false, setoresNome = {}, meusSetores = [],
}: {
  setor: string | null;
  tarefas: Tarefa[];
  equipe: Membro[];
  souEu: string;
  mostrarSetor?: boolean;
  setoresNome?: Record<string, string>;
  /** setores em que quem vê atua: decide se mostra "Aceitar" ou só acompanha */
  meusSetores?: string[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [nova, setNova] = useState({ titulo: "", prazo: "", prioridade: "normal", responsavel: souEu, para: setor ?? "" });

  async function chamar(method: "POST" | "PATCH", body: unknown) {
    setOcupado(true); setErro("");
    const res = await fetch("/api/admin/tarefas", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setOcupado(false);
    if (!res.ok) { setErro((await res.json().catch(() => ({}))).error ?? "Não foi possível salvar."); return false; }
    router.refresh();
    return true;
  }

  const input = CAMPO_COMPACTO;
  const abertas = tarefas.filter((t) => ABERTOS.includes(t.status));
  const feitas = tarefas.filter((t) => t.status === "concluida").slice(0, 5);
  const encaminhando = !!setor && !!nova.para && nova.para !== setor;
  const nomeSetor = (id: string | null | undefined) => (id ? setoresNome[id] ?? id : "");

  return (
    <div className="space-y-4">
      {setor && (
        <form className="cartao flex flex-wrap items-center gap-2.5 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const corpo = encaminhando
              ? { titulo: nova.titulo, prazo: nova.prazo, prioridade: nova.prioridade, setor: nova.para, setor_origem: setor }
              : { titulo: nova.titulo, prazo: nova.prazo, prioridade: nova.prioridade, responsavel: nova.responsavel, setor };
            if (await chamar("POST", corpo)) setNova({ ...nova, titulo: "", prazo: "", para: setor });
          }}>
          <input required className={input + " flex-1 min-w-56"} placeholder={encaminhando ? "O que o outro setor precisa fazer…" : "Nova tarefa do setor…"}
            value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} />
          <select className={input} value={nova.para} aria-label="Para o setor"
            onChange={(e) => setNova({ ...nova, para: e.target.value })}>
            {Object.entries(setoresNome).map(([id, nome]) => (
              <option key={id} value={id}>{id === setor ? `Este setor (${nome})` : `Encaminhar a ${nome}`}</option>
            ))}
          </select>
          {!encaminhando && (
            <select className={input} value={nova.responsavel} aria-label="Responsável"
              onChange={(e) => setNova({ ...nova, responsavel: e.target.value })}>
              <option value="">Sem responsável</option>
              {equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome || "—"}</option>)}
            </select>
          )}
          <input type="date" className={input} value={nova.prazo} aria-label="Prazo"
            onChange={(e) => setNova({ ...nova, prazo: e.target.value })} />
          <select className={input} value={nova.prioridade} aria-label="Prioridade"
            onChange={(e) => setNova({ ...nova, prioridade: e.target.value })}>
            {Object.entries(PRIORIDADE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button disabled={ocupado} className="btn-verde inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {encaminhando ? <><Send className="size-4" /> Encaminhar</> : <><Plus className="size-4" /> Adicionar</>}
          </button>
          {encaminhando && (
            <p className="basis-full px-1 text-xs text-texto-2">
              O setor {nomeSetor(nova.para)} recebe na caixa de entrada e escolhe quem faz. Se ninguém aceitar no prazo, a tarefa sobe para a Diretoria.
            </p>
          )}
        </form>
      )}
      {erro && <p className="text-sm text-critico">{erro}</p>}

      <div className="cartao overflow-hidden divide-y divide-linha">
        {abertas.map((t) => {
          const atrasada = !!t.prazo && t.prazo < hoje();
          const esperandoAceite = t.origem === "encaminhada" && !t.aceite_em;
          const possoAgir = !meusSetores.length || meusSetores.includes(t.setor);
          return (
            <div key={t.id} className={"px-5 py-3.5 flex items-start gap-3.5 flex-wrap transition-colors hover:bg-superficie-2/70 " + (esperandoAceite ? "bg-ouro/5" : "")}>
              {esperandoAceite
                ? <Inbox className="mt-1 size-4 shrink-0 text-ouro" aria-label="Aguardando aceite" />
                : <input type="checkbox" className="mt-1 size-4 accent-[var(--verde)] cursor-pointer" disabled={ocupado || !possoAgir} aria-label="Concluir tarefa"
                    onChange={() => chamar("PATCH", { id: t.id, status: "concluida" })} />}
              <div className="flex-1 min-w-52">
                <p className="text-[0.95rem] font-medium text-texto leading-snug">
                  <Link href={`/admin/tarefas/${t.id}`} className="hover:text-verde hover:underline underline-offset-4">{t.titulo}</Link>
                  {t.prioridade === "alta" && <Etiqueta tom="critico" className="ml-2 align-middle !py-0.5">Alta</Etiqueta>}
                  {t.status !== "aberta" && (
                    <Etiqueta tom={t.status === "bloqueada" ? "critico" : t.status === "aguardando" ? "alerta" : "verde"} className="ml-2 align-middle !py-0.5">
                      {TAREFA_STATUS_LABEL[t.status] ?? t.status}
                    </Etiqueta>
                  )}
                  {t.escalonada_em && <Etiqueta tom="critico" className="ml-2 align-middle !py-0.5">Subiu para a Diretoria</Etiqueta>}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texto-2">
                  {t.codigo && <span className="font-mono">{t.codigo}</span>}
                  {mostrarSetor && <span className="font-semibold uppercase tracking-[0.1em] text-ouro">{nomeSetor(t.setor)}</span>}
                  {t.origem === "encaminhada" && t.setor_origem && (
                    <span className="inline-flex items-center gap-1"><ArrowRightLeft className="size-3.5" />de {nomeSetor(t.setor_origem)}</span>
                  )}
                  {t.origem === "automatica" && (
                    <span className="inline-flex items-center gap-1"><Bot className="size-3.5" />{t.regra ?? "automática"}</span>
                  )}
                  <span className="inline-flex items-center gap-1"><UserRound className="size-3.5" />{t.responsavel_nome ?? "sem responsável"}</span>
                  {t.prazo && (
                    <span className={"inline-flex items-center gap-1 " + (atrasada ? "font-semibold text-critico" : "")}>
                      <CalendarClock className="size-3.5" />
                      {atrasada ? "atrasada desde " : "até "}
                      {new Date(t.prazo + "T12:00:00").toLocaleDateString("pt-BR")}
                    </span>
                  )}
                  {esperandoAceite && t.prazo_aceite && (
                    <span className={"inline-flex items-center gap-1 " + (new Date(t.prazo_aceite) < new Date() ? "font-semibold text-critico" : "text-ouro")}>
                      aceitar até {new Date(t.prazo_aceite).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  )}
                </p>
              </div>
              {esperandoAceite && possoAgir ? (
                <div className="flex items-center gap-2">
                  <button disabled={ocupado} onClick={() => chamar("PATCH", { id: t.id, acao: "aceitar" })}
                    className="btn-verde inline-flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-60">
                    <Check className="size-3.5" /> Aceitar
                  </button>
                  <button disabled={ocupado}
                    onClick={() => {
                      const motivo = prompt("Por que o setor devolve esta tarefa?");
                      if (motivo) chamar("PATCH", { id: t.id, acao: "recusar", motivo });
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-linha-forte px-3 py-1.5 text-xs font-semibold text-texto-2 hover:text-critico disabled:opacity-60">
                    <X className="size-3.5" /> Devolver
                  </button>
                </div>
              ) : esperandoAceite ? (
                <Etiqueta tom="ouro">Esperando {nomeSetor(t.setor)} aceitar</Etiqueta>
              ) : (
                <select value={t.status} disabled={ocupado || !possoAgir} aria-label="Situação"
                  onChange={(e) => {
                    const status = e.target.value;
                    const precisa = ["aguardando", "bloqueada", "cancelada"].includes(status);
                    const motivo = precisa ? prompt("Qual o motivo?") : null;
                    if (precisa && !motivo?.trim()) return;
                    chamar("PATCH", { id: t.id, status, ...(motivo ? { motivo } : {}) });
                  }}
                  className="rounded-lg border border-linha-forte bg-superficie-2 px-2.5 py-1.5 text-xs font-medium text-texto focus:border-verde focus:outline-none">
                  {Object.entries(TAREFA_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
            </div>
          );
        })}
        {!abertas.length && (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <ListChecks className="size-6 text-verde" />
            <p className="text-[0.95rem] text-texto-2">Nenhuma tarefa aberta.</p>
          </div>
        )}
      </div>

      {feitas.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-texto-2">
          <CheckCircle2 className="size-3.5 shrink-0 mt-px text-verde" />
          <span>Concluídas recentemente: {feitas.map((t) => t.titulo).join(" · ")}</span>
        </p>
      )}
    </div>
  );
}
