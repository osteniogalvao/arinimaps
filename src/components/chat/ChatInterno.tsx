"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { Hash, MessageSquare, Plus, Search } from "lucide-react";

type Conversa = {
  id: string; tipo: "direta" | "setor"; titulo: string; outro: string | null;
  ultima_em: string; ultima_previa: string | null; ultima_autor: string | null; nao_lida: boolean;
};
type Mensagem = { id: string; texto: string | null; minha: boolean; autor_nome: string; created_at: string };
type Pessoa = { user_id: string; nome: string; setor?: string };

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
  const [busca, setBusca] = useState("");
  const casa = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(busca.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim());
  const setores = conversas.filter((c) => c.tipo === "setor" && casa(c.titulo));
  const diretas = conversas.filter((c) => c.tipo === "direta" && casa(c.titulo));
  const semConversa = equipe.filter((p) => !conversas.some((c) => c.outro === p.user_id) && (casa(p.nome) || casa(p.setor ?? "")));
  const letra = (n: string) => (n.replace(/^#\s*/, "").trim()[0] ?? "?").toUpperCase();
  const titulo = (children: string) => (
    <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-texto-2">{children}</p>
  );
  const linha = (c: Conversa) => (
    <button key={c.id} type="button" onClick={() => abrir(c.id)}
      className={"flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors " + (c.id === aberta ? "bg-verde/12" : "hover:bg-superficie-2")}>
      <span className={"grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold " + (c.tipo === "setor" ? "bg-ouro/15 text-ouro" : "bg-superficie-2 text-texto-2")}>
        {c.tipo === "setor" ? <Hash className="size-4" /> : letra(c.titulo)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={"truncate text-sm " + (c.nao_lida ? "font-bold text-texto" : "font-medium text-texto")}>{c.titulo.replace(/^#\s*/, "")}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-texto-2">
            {c.nao_lida && <span className="size-2 rounded-full bg-ouro" aria-label="não lida" />}
            {c.ultima_previa && hora(c.ultima_em)}
          </span>
        </span>
        <span className="block truncate text-xs text-texto-2">
          {c.ultima_previa ? `${c.ultima_autor ? c.ultima_autor + ": " : ""}${c.ultima_previa}` : "Sem mensagens ainda"}
        </span>
      </span>
    </button>
  );

  return (
    <div className="space-y-3">
      {erro && <p className="cartao p-4 text-sm text-alerta" role="alert">{erro}</p>}
      <div className="cartao grid min-h-[70vh] overflow-hidden !p-0 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={"flex flex-col border-linha lg:border-r " + (aberta ? "hidden lg:flex" : "")}>
          <div className="border-b border-linha p-4">
            <h2 className="font-semibold text-texto">Chat</h2>
            <label className="relative mt-2 block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-texto-2" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa ou setor…"
                className={CAMPO_COMPACTO + " w-full !pl-8"} aria-label="Buscar pessoa ou setor" />
            </label>
          </div>
          <div className="max-h-[70vh] flex-1 overflow-y-auto pb-3">
            {!!setores.length && <>{titulo("Setores")}{setores.map(linha)}</>}
            {!!diretas.length && <>{titulo("Conversas")}{diretas.map(linha)}</>}
            {!!semConversa.length && (
              <>
                {titulo("Começar conversa")}
                {semConversa.map((p) => (
                  <button key={p.user_id} type="button" onClick={() => void direta(p.user_id)}
                    className="group flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-superficie-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-superficie-2 text-xs font-semibold text-texto-2">{letra(p.nome)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-texto">{p.nome}</span>
                      <span className="block truncate text-xs text-texto-2">{p.setor}</span>
                    </span>
                    <Plus className="size-4 text-texto-2 group-hover:text-verde" aria-label="Começar conversa" />
                  </button>
                ))}
              </>
            )}
            {!conversas.length && !equipe.length && !erro && <p className="px-4 py-6 text-center text-sm text-texto-2">Carregando…</p>}
          </div>
        </aside>

        <section className={"flex min-h-[60vh] flex-col " + (aberta ? "" : "hidden lg:flex")}>
          {atual ? (
            <>
              <header className="flex items-center gap-3 border-b border-linha px-4 py-3">
                <button type="button" onClick={() => { setAberta(null); window.history.replaceState(null, "", "?"); }} className="text-sm text-verde lg:hidden">← Voltar</button>
                <h2 className="font-semibold text-texto">{atual.titulo}</h2>
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" style={{ maxHeight: "60vh" }}>
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
            <div className="m-auto px-6 text-center text-sm text-texto-2">
              <MessageSquare className="mx-auto mb-3 size-8 opacity-40" />
              Escolha uma conversa à esquerda, ou comece<br />uma nova com alguém da equipe.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
