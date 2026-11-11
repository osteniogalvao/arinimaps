"use client";

import { useCallback, useEffect, useState } from "react";
import { MessagesSquare, Send } from "lucide-react";
import { CAMPO_COMPACTO } from "./estilos";

type Msg = { id: string; autor_nome: string; texto: string; created_at: string; minha: boolean };

/** Conversa da equipe dentro do registro. "@Nome" avisa a pessoa. */
export default function Conversa({ entidade, id }: { entidade: string; id: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [indisponivel, setIndisponivel] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/admin/conversa?entidade=${entidade}&id=${id}`).catch(() => null);
    if (!r?.ok) return;
    const j = await r.json();
    setMsgs(j.mensagens ?? []); setIndisponivel(!!j.indisponivel);
  }, [entidade, id]);
  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  if (indisponivel) return null;
  return (
    <section className="cartao space-y-3 p-5">
      <p className="flex items-center gap-2 font-semibold text-texto"><MessagesSquare className="size-4 text-ouro" /> Conversa da equipe</p>
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {msgs.map((m) => (
          <div key={m.id} className={"rounded-xl px-3 py-2 text-sm " + (m.minha ? "ml-8 bg-verde/10" : "mr-8 bg-superficie-2")}>
            <p className="text-[11px] font-semibold text-texto-2">{m.autor_nome} · {new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
            <p className="whitespace-pre-wrap text-texto">{m.texto}</p>
          </div>
        ))}
        {!msgs.length && <p className="text-sm text-texto-2">Nenhuma mensagem. Use @Nome para chamar alguém.</p>}
      </div>
      <form className="flex gap-2" onSubmit={async (e) => {
        e.preventDefault(); setErro("");
        const r = await fetch("/api/admin/conversa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entidade, id, texto }) });
        if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? "Não foi possível enviar."); return; }
        setTexto(""); void carregar();
      }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva… (@Nome avisa a pessoa)" className={CAMPO_COMPACTO + " flex-1"} />
        <button aria-label="Enviar" className="btn-verde px-3 py-2"><Send className="size-4" /></button>
      </form>
      {erro && <p className="text-xs text-critico">{erro}</p>}
    </section>
  );
}
