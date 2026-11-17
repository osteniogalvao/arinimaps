"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarClock, GripVertical, UserRound } from "lucide-react";
import { enviarJson } from "@/lib/api/enviar";
import { formatBRL } from "@/lib/format";
import { ETAPA_LABEL } from "@/lib/funil";

export type CartaoFunil = {
  id: string; codigo: string; etapa: string; cliente: string; imovel: string; valor: number | null;
  responsavel: string; temperatura: string | null; proximaAcaoEm: string | null;
};

const PONTO: Record<string, string> = { quente: "bg-critico", morno: "bg-ouro", frio: "bg-sky-500" };

/**
 * Quadro do funil com arrastar e soltar. Soltar numa coluna muda a etapa (a
 * mesma rota da oportunidade, com o mesmo registro na linha do tempo). Para
 * "Perdido", a oportunidade abre para escolher o motivo.
 */
export default function FunilQuadro({ colunas, cartoes }: { colunas: string[]; cartoes: CartaoFunil[] }) {
  const router = useRouter();
  const [lista, setLista] = useState(cartoes);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  async function mover(id: string, etapa: string) {
    const c = lista.find((x) => x.id === id);
    if (!c || c.etapa === etapa) return;
    if (etapa === "perdido") { router.push(`/admin/oportunidades/${id}`); return; }
    const antes = lista;
    setLista((l) => l.map((x) => (x.id === id ? { ...x, etapa } : x)));
    setErro("");
    const r = await enviarJson(`/api/oportunidades/${id}`, "PATCH", { acao: "etapa", etapa });
    if (!r.ok) { setLista(antes); setErro(`${c.codigo}: ${r.erro.mensagem}`); return; }
    router.refresh();
  }

  const [agora] = useState(() => Date.now());
  return (
    <>
      {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">{erro}</p>}
      <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-4 md:-mx-8 md:px-8">
        {colunas.map((etapa) => {
          const cards = lista.filter((c) => c.etapa === etapa);
          const perdido = etapa === "perdido";
          const ganho = etapa === "fechado" || etapa === "pos_venda";
          const total = cards.reduce((s, o) => s + Number(o.valor ?? 0), 0);
          return (
            <div key={etapa}
              onDragOver={(e) => { e.preventDefault(); setSobre(etapa); }}
              onDragLeave={() => setSobre((s) => (s === etapa ? null : s))}
              onDrop={(e) => { e.preventDefault(); setSobre(null); const id = e.dataTransfer.getData("text/plain"); if (id) void mover(id, etapa); }}
              className={"flex w-[17rem] shrink-0 flex-col rounded-2xl border bg-superficie-2/50 transition-colors " + (sobre === etapa && arrastando ? "border-verde bg-verde/5" : "border-linha")}>
              <div className={"rounded-t-2xl border-t-4 px-4 pt-3 pb-3 " + (perdido ? "border-t-critico" : ganho ? "border-t-verde" : "border-t-ouro")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-texto">{ETAPA_LABEL[etapa]}</p>
                  <span className={"grid min-w-7 h-6 place-items-center rounded-md px-1.5 text-xs font-bold tabular-nums " +
                    (perdido ? "bg-critico/14 text-critico" : ganho ? "bg-verde/14 text-verde" : "bg-superficie text-texto-2 border border-linha")}>
                    {cards.length}
                  </span>
                </div>
                {total > 0 && <p className="mt-1 text-xs text-texto-2 tabular-nums">{formatBRL(total)}</p>}
              </div>
              <div className="flex-1 space-y-2.5 px-2.5 pb-2.5 min-h-24">
                {cards.map((o) => {
                  const atrasada = o.proximaAcaoEm && +new Date(o.proximaAcaoEm) < agora;
                  return (
                    <div key={o.id} draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", o.id); e.dataTransfer.effectAllowed = "move"; setArrastando(o.id); }}
                      onDragEnd={() => setArrastando(null)}
                      className={"group relative rounded-xl border border-linha bg-superficie p-3.5 shadow-[0_1px_2px_var(--sombra-botao)] transition-colors hover:border-verde/60 " + (arrastando === o.id ? "opacity-50" : "")}>
                      <GripVertical className="absolute right-2 top-3 size-4 cursor-grab text-texto-2/50 group-hover:text-texto-2" aria-hidden />
                      <Link href={`/admin/oportunidades/${o.id}`} className="block">
                        <p className="flex items-center gap-1.5 font-mono text-[10px] text-texto-2 tabular-nums">
                          {o.temperatura && <span className={"size-2 rounded-full " + (PONTO[o.temperatura] ?? "bg-linha")} title={o.temperatura} />}
                          {o.codigo}
                        </p>
                        <p className="mt-1 pr-4 font-semibold leading-snug text-texto">{o.cliente}</p>
                        <p className="mt-1 flex items-start gap-1.5 text-sm leading-snug text-texto-2">
                          <Building2 className="mt-0.5 size-3.5 shrink-0" /><span className="line-clamp-2">{o.imovel}</span>
                        </p>
                        {o.proximaAcaoEm && (
                          <p className={"mt-1.5 flex items-center gap-1 text-[11px] " + (atrasada ? "font-semibold text-critico" : "text-texto-2")}>
                            <CalendarClock className="size-3" />{new Date(o.proximaAcaoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-linha pt-2.5">
                          <span className="text-sm font-bold text-verde tabular-nums">{formatBRL(o.valor)}</span>
                          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-texto-2">
                            <UserRound className="size-3 shrink-0" /><span className="truncate">{o.responsavel}</span>
                          </span>
                        </div>
                      </Link>
                    </div>
                  );
                })}
                {!cards.length && <p className="px-2 py-6 text-center text-xs text-texto-2">{arrastando ? "Solte aqui" : "Nenhuma oportunidade"}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
