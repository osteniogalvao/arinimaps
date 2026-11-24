"use client";

/**
 * Conversa com a equipe da ARINI pelo site (0171). Fica dentro do painel da
 * Ari, na aba "Falar com a equipe". O navegador guarda um código aleatório
 * (localStorage); a conversa cai no Atendimento da Central, com o mesmo menu
 * e as mesmas filas do WhatsApp. Atualiza a cada 8 s enquanto aberto.
 */
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, SendHorizontal } from "lucide-react";

type Mensagem = { id: string; de: "voce" | "arini"; texto: string; em: string };
const CHAVE = "arini:chat-site:codigo";
const CHAVE_NOME = "arini:chat-site:nome";

function codigoDoNavegador() {
  try {
    let c = localStorage.getItem(CHAVE);
    if (!c || !/^[A-Za-z0-9_-]{32,64}$/.test(c)) {
      const b = new Uint8Array(24);
      crypto.getRandomValues(b);
      c = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(CHAVE, c);
    }
    return c;
  } catch {
    return null;
  }
}

export default function ChatEquipe() {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [ativo, setAtivo] = useState(true);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = codigoDoNavegador();
    setCodigo(c);
    try { setNome(localStorage.getItem(CHAVE_NOME) ?? ""); } catch { /* sem storage */ }
  }, []);

  useEffect(() => {
    if (!codigo) return;
    let vivo = true;
    const ler = async () => {
      const r = await fetch(`/api/atendimento/site?codigo=${encodeURIComponent(codigo)}`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (!vivo || !j) return;
      setAtivo(j.ativo !== false);
      setMsgs(Array.isArray(j.mensagens) ? j.mensagens : []);
    };
    void ler();
    const t = setInterval(ler, 8000);
    return () => { vivo = false; clearInterval(t); };
  }, [codigo]);

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  async function enviar() {
    const t = texto.trim();
    if (!t || !codigo || enviando) return;
    setEnviando(true); setErro("");
    try { localStorage.setItem(CHAVE_NOME, nome.trim()); } catch { /* sem storage */ }
    const r = await fetch("/api/atendimento/site", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, nome: nome.trim(), texto: t }),
    }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setEnviando(false);
    if (!r?.ok) { setErro(j?.error ?? "Não foi possível enviar. Tente de novo."); return; }
    setTexto("");
    setMsgs((m) => [...m, { id: "local-" + Date.now(), de: "voce", texto: t, em: new Date().toISOString() }]);
  }

  if (!codigo) {
    return <p className="p-4 text-sm text-texto-2">Seu navegador bloqueou o armazenamento local. Fale com a equipe pelo WhatsApp no rodapé do site.</p>;
  }
  if (!ativo) {
    return <p className="p-4 text-sm text-texto-2">O chat com a equipe está desligado no momento. Fale pelo WhatsApp no rodapé do site.</p>;
  }

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[0.92rem]">
        {msgs.length === 0 && (
          <div>
            <p className="lp-display text-2xl text-verde">Fale com a equipe da ARINI</p>
            <p className="mt-1 leading-relaxed text-texto-2">Escreva sua mensagem. Uma pessoa da equipe responde por aqui, no horário de atendimento.</p>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={m.de === "voce" ? "flex justify-end" : "flex"}>
            <div className={m.de === "voce"
              ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-[#1F4535] bg-[#124431] px-4 py-2.5 text-[#F2F2EC]"
              : "max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-linha bg-superficie-2 px-4 py-2.5 text-texto-3"}>
              {m.texto}
            </div>
          </div>
        ))}
        <div ref={fimRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} className="shrink-0 space-y-2 border-t border-linha bg-superficie p-3">
        {msgs.length === 0 && (
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Seu nome (opcional)" aria-label="Seu nome"
            className="w-full rounded-full border border-linha-forte bg-superficie-2 px-4 py-2 text-sm text-texto placeholder:text-texto-2/70 focus:border-verde focus:outline-none" />
        )}
        <div className="flex items-end gap-2 rounded-3xl border border-linha-forte bg-superficie-2 p-1.5 transition focus-within:border-verde focus-within:ring-2 focus-within:ring-verde/30">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={1} maxLength={2000}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
            placeholder="Escreva para a equipe…" aria-label="Mensagem para a equipe"
            className="flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-texto placeholder:text-texto-2/70 focus:outline-none" />
          <button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar"
            className="btn-verde grid size-10 shrink-0 place-items-center p-0 disabled:opacity-50">
            {enviando ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
          </button>
        </div>
        {erro && <p role="alert" className="px-1 text-xs text-critico">{erro}</p>}
        <p className="px-1 text-[10px] leading-snug text-texto-2">A conversa fica registrada no atendimento da ARINI. Não envie senhas nem dados de cartão.</p>
      </form>
    </>
  );
}
