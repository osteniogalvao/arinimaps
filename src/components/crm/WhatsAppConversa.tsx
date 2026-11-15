"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

type Msg = { id: string; direcao: "entrada" | "saida"; texto: string | null; status: string | null; erro: string | null; created_at: string };

/** WhatsApp do cliente dentro da oportunidade (Cloud API). Some se não houver integração nem mensagem. */
export default function WhatsAppConversa({ opp, entrada }: { opp?: string; entrada?:string }) {
  const [ficha,setFicha]=useState<{nome:string;plano:string|null;vencido:boolean;recursos:string[];faturas:{inicio:string;valor:number;status:string}[]}|null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [configurado, setConfigurado] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch("/api/admin/whatsapp?" + (opp?"opp="+encodeURIComponent(opp):"entrada="+encodeURIComponent(entrada??""))).catch(() => null);
    if (!r?.ok) return;
    const j = await r.json();
    setFicha(j.ficha??null); setMsgs(j.mensagens); setConfigurado(j.configurado);
  }, [opp,entrada]);
  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 20_000);
    return () => clearInterval(t);
  }, [carregar]);
  if (!configurado && !msgs.length && !ficha) return null;
  return (
    <section className="cartao space-y-3 p-5">
      <p className="flex items-center gap-2 font-semibold text-texto"><MessageCircle className="size-4 text-verde" /> WhatsApp do cliente</p>
      {ficha && <details className="rounded-xl border border-linha p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Conta de {ficha.nome} · {ficha.plano || "Acesso básico"}</summary>
        <p className="mt-2">{ficha.vencido ? "Período do plano encerrado." : "Acesso vigente."}</p>
        <p>{ficha.faturas.length ? ficha.faturas.map(f=>f.status+" · "+(f.valor/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})+" · "+f.inicio.slice(0,10).split("-").reverse().join("/")).join(" | ") : "Nenhuma fatura de plano em aberto."}</p>
        <p className="mt-2">Recursos disponíveis: {ficha.recursos.join(", ")}</p>
      </details>}
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {msgs.map((m) => (
          <div key={m.id} className={"rounded-xl px-3 py-2 text-sm " + (m.direcao === "saida" ? "ml-10 bg-verde/12" : "mr-10 bg-superficie-2")}>
            <p className="whitespace-pre-wrap text-texto">{m.texto}</p>
            <p className="mt-0.5 text-[11px] text-texto-2">
              {new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              {m.direcao === "saida" && m.status ? ` · ${m.status === "read" ? "lida" : m.status === "delivered" ? "entregue" : m.status === "failed" ? "falhou" : "enviada"}` : ""}
              {m.erro && <span className="text-critico"> · {m.erro}</span>}
            </p>
          </div>
        ))}
        {!msgs.length && <p className="text-sm text-texto-2">Nenhuma mensagem ainda.</p>}
      </div>
      {configurado && (
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault(); setOcupado(true); setErro("");
          const r = await fetch("/api/admin/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opp, entrada, texto }) });
          setOcupado(false);
          if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? "Não foi possível enviar."); return; }
          setTexto(""); void carregar();
        }}>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Responder pelo WhatsApp…" className={CAMPO_COMPACTO + " flex-1"} />
          <button disabled={ocupado} aria-label="Enviar" className="btn-verde px-3 py-2 disabled:opacity-60"><Send className="size-4" /></button>
        </form>
      )}
      {erro && <p className="text-xs text-critico">{erro}</p>}
    </section>
  );
}
