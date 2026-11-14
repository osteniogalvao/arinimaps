"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, Info, Siren } from "lucide-react";
import { lerFila, sincronizar } from "@/lib/filaOffline";

type Item = { id: string; nivel: "info" | "atencao" | "critico"; titulo: string; texto: string | null; link: string | null; lida_em: string | null; created_at: string };

const ICONE = { info: Info, atencao: AlertTriangle, critico: Siren };
const COR = { info: "text-texto-2", atencao: "text-ouro", critico: "text-critico" };

/**
 * Sino de notificações da Central (3 níveis) e envio do que ficou guardado
 * sem internet (modo de campo). Atualiza a cada minuto e quando a aba volta.
 */
export default function Sino({ userId }: { userId: string }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [fila, setFila] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    let sincronizando = false;
    const total = () => lerFila().filter((i) => !i.corpo.user_id || i.corpo.user_id === userId).length;
    async function carregar() {
      const r = await fetch("/api/admin/notificacoes").catch(() => null);
      if (!r?.ok || !vivo) return;
      const j = await r.json();
      setItens(j.itens); setNaoLidas(j.naoLidas);
    }
    async function sync() {
      setFila(total());
      if (navigator.onLine && total() && !sincronizando) {
        sincronizando = true;
        try { await sincronizar(userId); } finally { sincronizando = false; if (vivo) setFila(total()); }
      }
    }
    void carregar(); void sync();
    const t = setInterval(() => { void carregar(); void sync(); }, 60_000);
    const vis = () => { if (document.visibilityState === "visible") { void carregar(); void sync(); } };
    const mudouFila = () => setFila(total());
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("online", sync);
    window.addEventListener("arini-fila", mudouFila);
    return () => { vivo = false; clearInterval(t); document.removeEventListener("visibilitychange", vis); window.removeEventListener("online", sync); window.removeEventListener("arini-fila", mudouFila); };
  }, [userId]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  async function lerTodas() {
    await fetch("/api/admin/notificacoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
    setNaoLidas(0); setItens((x) => x.map((i) => ({ ...i, lida_em: i.lida_em ?? new Date().toISOString() })));
  }
  const critica = itens.some((i) => i.nivel === "critico" && !i.lida_em);

  return (
    <div className="relative" ref={caixa}>
      <button type="button" aria-label={`Notificações${naoLidas ? `: ${naoLidas} novas` : ""}`} onClick={() => setAberto(!aberto)}
        className="relative grid size-10 place-items-center rounded-full border border-linha-forte text-texto-2 transition-colors hover:border-verde hover:text-verde">
        <Bell className="size-[18px]" />
        {naoLidas > 0 && (
          <span className={"absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold text-white " + (critica ? "bg-critico" : "bg-ouro")}>
            {naoLidas > 9 ? "9+" : naoLidas}
          </span>
        )}
        {fila > 0 && <span className="absolute -bottom-1 -right-1 size-3 rounded-full border-2 border-superficie bg-alerta" title={`${fila} registro(s) esperando internet`} />}
      </button>
      {aberto && (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-linha bg-superficie shadow-xl">
          <div className="flex items-center justify-between border-b border-linha px-4 py-3">
            <p className="text-sm font-semibold text-texto">Notificações</p>
            {naoLidas > 0 && <button type="button" onClick={lerTodas} className="text-xs font-semibold text-verde hover:underline">Marcar todas como lidas</button>}
          </div>
          {fila > 0 && <p className="border-b border-linha bg-alerta/10 px-4 py-2 text-xs text-alerta">{fila} registro(s) no aparelho. <Link className="underline" href="/admin/ponto">Conferir marcações de ponto</Link></p>}
          <div className="max-h-[60vh] divide-y divide-linha overflow-y-auto">
            {itens.map((i) => {
              const Icone = ICONE[i.nivel];
              const corpo = (
                <span className={"flex gap-3 px-4 py-3 text-sm " + (i.lida_em ? "opacity-70" : "")}>
                  <Icone className={"mt-0.5 size-4 shrink-0 " + COR[i.nivel]} />
                  <span className="min-w-0">
                    <span className="block font-medium text-texto">{i.titulo}</span>
                    {i.texto && <span className="mt-0.5 block text-xs text-texto-2 line-clamp-2">{i.texto}</span>}
                    <span className="mt-0.5 block text-[11px] text-texto-2">{new Date(i.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                  </span>
                </span>
              );
              return i.link ? (
                <Link key={i.id} href={i.link} className="block hover:bg-superficie-2/70"
                  onClick={() => { setAberto(false); if (!i.lida_em) void fetch("/api/admin/notificacoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: i.id }) }); }}>
                  {corpo}
                </Link>
              ) : <div key={i.id}>{corpo}</div>;
            })}
            {!itens.length && <p className="px-4 py-8 text-center text-sm text-texto-2">Nada por aqui.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
