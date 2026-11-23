"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

type Conversa = {
  id: string; tipo: "direta" | "setor"; titulo: string; outro: string | null;
  ultima_em: string; ultima_previa: string | null; ultima_autor: string | null; nao_lida: boolean;
};
type Mensagem = { id: string; texto: string | null; minha: boolean; autor_nome: string; created_at: string };
type Pessoa = { user_id: string; nome: string };

const FUSO = "America/Sao_Paulo";
const hora = (iso: string) => {
  const d = new Date(iso);
  const hoje = d.toLocaleDateString("pt-BR", { timeZone: FUSO }) === new Date().toLocaleDateString("pt-BR", { timeZone: FUSO });
  return d.toLocaleString("pt-BR", hoje ? { timeZone: FUSO, timeStyle: "short" } : { timeZone: FUSO, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** Lista de conversas + conversa aberta; atualiza sozinho a cada 5 s. */
export default function ChatInterno({ inicial }: { inicial: string | null }) {
  const [aberta, setAberta] = useState<string | null>(inicial);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [equipe, setEquipe] = useState<Pessoa[]>([]);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const ultimaVista = useRef<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/admin/chat" + (aberta ? `?conversa=${aberta}` : ""), { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? "Falha ao carregar o chat."); return; }
    setErro(null);
    setConversas(j.conversas ?? []);
    setEquipe(j.equipe ?? []);
    setMensagens(j.mensagens ?? []);
  }, [aberta]);

  useEffect(() => {
    let vivo = true;
    const ciclo = () => { if (vivo && document.visibilityState === "visible") void carregar(); };
    ciclo();
    const t = setInterval(ciclo, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [carregar]);

  useEffect(() => {
    const ultima = mensagens.at(-1)?.id ?? null;
    if (ultima && ultima !== ultimaVista.current) fim.current?.scrollIntoView({ block: "end" });
    ultimaVista.current = ultima;
  }, [mensagens]);

  const abrir = (id: string) => {
    setAberta(id); setMensagens([]); ultimaVista.current = null;
    window.history.replaceState(null, "", `?c=${id}`);
  };

  async function direta(com: string) {
    if (!com) return;
    const r = await fetch("/api/admin/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "direta", com }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? "Falha ao abrir a conversa."); return; }
    abrir(j.conversa);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!aberta || !texto.trim() || enviando) return;
    setEnviando(true);
    const r = await fetch("/api/admin/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "enviar", conversa: aberta, texto }) });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) { setErro(j.error ?? "Falha ao enviar."); return; }
    setTexto("");
    void carregar();
  }

  const atual = conversas.find((c) => c.id === aberta) ?? null;
  const semConversa = equipe.filter((p) => !conversas.some((c) => c.outro === p.user_id));

  return (
    <div className="space-y-3">
      {erro && <p className="cartao p-4 text-sm text-alerta" role="alert">{erro}</p>}
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={"space-y-3 " + (aberta ? "hidden lg:block" : "")}>
          <ul className="cartao max-h-[65vh] divide-y divide-linha overflow-y-auto">
            {conversas.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => abrir(c.id)}
                  className={"block w-full px-4 py-3 text-left transition-colors " + (c.id === aberta ? "bg-verde/12" : "hover:bg-superficie-2")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className={"truncate " + (c.nao_lida ? "font-bold text-texto" : "font-semibold text-texto")}>{c.titulo}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-texto-2">
                      {c.nao_lida && <span className="size-2 rounded-full bg-ouro" aria-label="não lida" />}
                      {c.ultima_previa && hora(c.ultima_em)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-texto-2">
                    {c.ultima_previa ? `${c.ultima_autor ? c.ultima_autor + ": " : ""}${c.ultima_previa}` : "Sem mensagens"}
                  </span>
                </button>
              </li>
            ))}
            {!conversas.length && !erro && <li className="px-4 py-6 text-center text-sm text-texto-2">Carregando…</li>}
          </ul>
          {!!semConversa.length && (
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-texto">Nova conversa</span>
              <select className={CAMPO_COMPACTO + " w-full"} value="" onChange={(e) => void direta(e.target.value)}>
                <option value="">Escolha alguém da equipe…</option>
                {semConversa.map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
              </select>
            </label>
          )}
        </aside>

        <section className={"cartao flex min-h-[60vh] flex-col " + (aberta ? "" : "hidden lg:flex")}>
          {atual ? (
            <>
              <header className="flex items-center gap-3 border-b border-linha px-4 py-3">
                <button type="button" onClick={() => { setAberta(null); window.history.replaceState(null, "", "?"); }} className="text-sm text-verde lg:hidden">← Voltar</button>
                <h2 className="font-semibold text-texto">{atual.titulo}</h2>
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" style={{ maxHeight: "55vh" }}>
                {mensagens.map((m, i) => {
                  const mesmoAutor = i > 0 && mensagens[i - 1].autor_nome === m.autor_nome && mensagens[i - 1].minha === m.minha;
                  return (
                    <div key={m.id} className={"flex " + (m.minha ? "justify-end" : "justify-start")}>
                      <div className={"max-w-[80%] rounded-2xl px-3.5 py-2 " + (m.minha ? "bg-verde/15" : "bg-superficie-2")}>
                        {!m.minha && !mesmoAutor && atual.tipo === "setor" && <p className="text-xs font-semibold text-verde">{m.autor_nome}</p>}
                        <p className="whitespace-pre-wrap break-words text-[0.95rem] text-texto">{m.texto ?? <em className="text-texto-2">Mensagem apagada</em>}</p>
                        <p className="mt-0.5 text-right text-[11px] text-texto-2">{hora(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                {!mensagens.length && <p className="py-10 text-center text-sm text-texto-2">Nenhuma mensagem ainda. Escreva a primeira.</p>}
                <div ref={fim} />
              </div>
              <form onSubmit={enviar} className="flex gap-2 border-t border-linha p-3">
                <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={4000}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                  placeholder="Mensagem (Enter envia, Shift+Enter quebra a linha)" className={CAMPO_COMPACTO + " flex-1 resize-none"} />
                <button disabled={enviando || !texto.trim()} className="btn-verde px-4 py-2 text-sm disabled:opacity-50">Enviar</button>
              </form>
            </>
          ) : (
            <p className="m-auto px-6 text-center text-texto-2">Escolha uma conversa ou comece uma nova com alguém da equipe.</p>
          )}
        </section>
      </div>
    </div>
  );
}
