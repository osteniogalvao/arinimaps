"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Bot, Check, CheckCircle2, Inbox, MessageSquare, Paperclip, Send, ShieldAlert, UserRound, X } from "lucide-react";
import { TAREFA_STATUS_LABEL } from "@/lib/setores";
import { CAMPO_COMPACTO } from "./estilos";
import type { Membro } from "./Tarefas";

export type EventoLinha = {
  id: string; tipo: string; texto: string | null; quando: string; autor: string;
  de: string | null; para: string | null; dados: Record<string, unknown>;
};

const ICONE: Record<string, typeof Check> = {
  criada: Inbox, encaminhada: ArrowRightLeft, aceita: Check, recusada: X, status: CheckCircle2,
  responsavel: UserRound, comentario: MessageSquare, evidencia: Paperclip, escalonada: ShieldAlert, prazo: CheckCircle2,
};

function descrever(e: EventoLinha): string {
  switch (e.tipo) {
    case "criada": return e.autor === "Sistema" ? "Tarefa criada pelo sistema" : `${e.autor} criou a tarefa`;
    case "encaminhada": return `${e.autor} encaminhou${e.de ? ` de ${e.de}` : ""} para ${e.para ?? "outro setor"}`;
    case "aceita": return `${e.autor} aceitou e assumiu`;
    case "recusada": return `${e.autor} devolveu${e.para ? ` para ${e.para}` : ""}`;
    case "status": {
      const para = String(e.dados.para ?? e.dados.status ?? "");
      return `${e.autor} mudou para "${TAREFA_STATUS_LABEL[para] ?? para}"`;
    }
    case "responsavel": return `${e.autor} trocou o responsável`;
    case "prazo": return `${e.autor} mudou o prazo`;
    case "comentario": return `${e.autor} comentou`;
    case "evidencia": return `${e.autor} registrou o que foi feito`;
    case "escalonada": return "Ninguém aceitou no prazo: subiu para a Diretoria";
    default: return e.tipo;
  }
}

/**
 * Ações e linha do tempo de uma tarefa. Quem encaminhou pode comentar;
 * o setor que recebeu aceita, devolve, encaminha, registra evidência e conclui.
 */
export default function TarefaDetalhe(props: {
  id: string; status: string; setor: string; responsavel: string | null;
  esperandoAceite: boolean; podeAgir: boolean; devolvivel: boolean;
  equipe: Membro[]; setores: { id: string; nome: string }[]; linha: EventoLinha[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [comentario, setComentario] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const [encaminhar, setEncaminhar] = useState({ setor: props.setores[0]?.id ?? "", motivo: "" });

  async function chamar(body: Record<string, unknown>) {
    setOcupado(true); setErro("");
    const res = await fetch("/api/admin/tarefas", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: props.id, ...body }),
    });
    setOcupado(false);
    if (!res.ok) { setErro((await res.json().catch(() => ({}))).error ?? "Não foi possível salvar."); return false; }
    router.refresh();
    return true;
  }

  const fechada = ["concluida", "cancelada"].includes(props.status);
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-60";

  return (
    <div className="space-y-8">
      {props.podeAgir && !fechada && (
        <section className="cartao space-y-5 p-5">
          {props.esperandoAceite ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 min-w-60 text-sm text-texto-2">Esta tarefa chegou de outro setor. Aceite para assumir, ou devolva explicando o motivo.</p>
              <button disabled={ocupado} onClick={() => chamar({ acao: "aceitar" })} className={`${btn} btn-verde`}>
                <Check className="size-4" /> Aceitar e assumir
              </button>
              {props.devolvivel && (
                <button disabled={ocupado} className={`${btn} border border-linha-forte text-texto-2 hover:text-critico`}
                  onClick={() => { const motivo = prompt("Por que o setor devolve esta tarefa?"); if (motivo) chamar({ acao: "recusar", motivo }); }}>
                  <X className="size-4" /> Devolver
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="text-sm text-texto-2" htmlFor="sit">Situação</label>
              <select id="sit" value={props.status} disabled={ocupado} className={CAMPO_COMPACTO}
                onChange={(e) => {
                  const status = e.target.value;
                  const precisa = ["aguardando", "bloqueada", "cancelada"].includes(status);
                  const motivo = precisa ? prompt("Qual o motivo?") : null;
                  if (precisa && !motivo?.trim()) return;
                  chamar({ status, ...(motivo ? { motivo } : {}) });
                }}>
                {Object.entries(TAREFA_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label className="ml-2 text-sm text-texto-2" htmlFor="resp">Responsável</label>
              <select id="resp" value={props.responsavel ?? ""} disabled={ocupado} className={CAMPO_COMPACTO}
                onChange={(e) => chamar({ responsavel: e.target.value })}>
                <option value="">Ninguém</option>
                {props.equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome || "—"}</option>)}
              </select>
            </div>
          )}

          {!props.esperandoAceite && (
            <form className="flex flex-wrap items-start gap-2.5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await chamar({ status: "concluida", evidencia })) setEvidencia("");
              }}>
              <textarea className={CAMPO_COMPACTO + " flex-1 min-w-64"} rows={2} required
                placeholder="O que foi feito? (link do documento, número do protocolo, resultado…)"
                value={evidencia} onChange={(e) => setEvidencia(e.target.value)} />
              <button disabled={ocupado || !evidencia.trim()} className={`${btn} btn-verde`}>
                <CheckCircle2 className="size-4" /> Concluir com evidência
              </button>
            </form>
          )}

          <form className="flex flex-wrap items-center gap-2.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await chamar({ acao: "encaminhar", ...encaminhar })) setEncaminhar({ ...encaminhar, motivo: "" });
            }}>
            <select className={CAMPO_COMPACTO} value={encaminhar.setor} aria-label="Encaminhar para"
              onChange={(e) => setEncaminhar({ ...encaminhar, setor: e.target.value })}>
              {props.setores.map((s) => <option key={s.id} value={s.id}>Encaminhar a {s.nome}</option>)}
            </select>
            <input className={CAMPO_COMPACTO + " flex-1 min-w-56"} placeholder="O que o outro setor precisa saber"
              value={encaminhar.motivo} onChange={(e) => setEncaminhar({ ...encaminhar, motivo: e.target.value })} />
            <button disabled={ocupado} className={`${btn} border border-verde text-verde hover:bg-verde/10`}>
              <ArrowRightLeft className="size-4" /> Encaminhar
            </button>
          </form>
        </section>
      )}
      {erro && <p className="text-sm text-critico">{erro}</p>}

      <section className="space-y-4">
        <h2 className="lp-display text-xl text-texto">Linha do tempo</h2>
        <ol className="relative space-y-4 border-l border-linha pl-6">
          {props.linha.map((e) => {
            const Icone = e.autor === "Sistema" && e.tipo === "criada" ? Bot : ICONE[e.tipo] ?? CheckCircle2;
            return (
              <li key={e.id} className="relative">
                <span className="absolute -left-[34px] grid size-6 place-items-center rounded-full border border-linha bg-superficie text-verde">
                  <Icone className="size-3.5" />
                </span>
                <p className="text-sm font-medium text-texto">{descrever(e)}</p>
                {e.texto && <p className="mt-1 whitespace-pre-line text-sm text-texto-2">{e.texto}</p>}
                <p className="mt-0.5 text-xs text-texto-2 tabular-nums">
                  {new Date(e.quando).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </p>
              </li>
            );
          })}
          {!props.linha.length && <li className="text-sm text-texto-2">Sem histórico ainda.</li>}
        </ol>

        <form className="flex flex-wrap items-start gap-2.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await chamar({ acao: "comentar", texto: comentario })) setComentario("");
          }}>
          <textarea className={CAMPO_COMPACTO + " flex-1 min-w-64"} rows={2} placeholder="Escreva um comentário para quem acompanha esta tarefa"
            value={comentario} onChange={(e) => setComentario(e.target.value)} />
          <button disabled={ocupado || !comentario.trim()} className={`${btn} btn-verde`}>
            <Send className="size-4" /> Comentar
          </button>
        </form>
      </section>
    </div>
  );
}
