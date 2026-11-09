"use client";

/**
 * Assistente de IA (PENDÊNCIA 5.1). Onde fica o botão que abre (08/10/2026):
 *  · sistema (AppShell): ícone na barra do topo, ao lado do sino;
 *  · mapa: ferramenta "Perguntar" na barra do mapa;
 *  · site: botão redondo flutuante só com o ícone (`flutuante`), que mostra
 *    o texto ao passar o mouse.
 * Qualquer botão abre o mesmo painel chamando `abrirAssistente()`.
 *
 * Resposta por streaming (SSE) de POST /api/ia/chat; se o navegador não der
 * acesso ao corpo em fluxo, lê tudo de uma vez e mostra no fim. A conversa
 * da aba fica no sessionStorage para sobreviver à troca de página — o
 * histórico que o modelo vê vem do banco, não daqui.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Database, FileText, Home, LoaderCircle, Lock, SendHorizontal, SquarePen, X } from "lucide-react";
import MarcaArini from "@/components/marca/MarcaArini";

type Fonte = { tipo: "imovel" | "car" | "conhecimento"; rotulo: string; href?: string };
/** `aviso`: recado neutro do sistema (assistente ocupado), não falha — aparece sem o vermelho de erro. */
type Msg = { papel: "user" | "assistant"; texto: string; fontes?: Fonte[]; erro?: boolean; aviso?: boolean; status?: string };
type Estado = {
  ligado: boolean; motivo?: "sem_chave" | "desligado"; sessao: boolean; permitido: boolean;
  negacao?: { mensagem: string; solucao: string }; cota?: { limite: number; usado: number } | null;
};

const CHAVE = "arini:ia:conversa";
const EVENTO = "arini:ia:abrir";

/** Abre o painel do assistente de qualquer lugar da tela (barra do topo, mapa). */
export function abrirAssistente() {
  window.dispatchEvent(new Event(EVENTO));
}
const SUGESTOES = [
  "Lotes até R$ 400 mil em Iturama",
  "Fazendas acima de 50 ha na região",
  "Qual a comissão da Arini?",
  "O CAR comprova a propriedade?",
];

// ---------------------------------------------------------------- markdown mínimo e seguro
// só negrito, listas, quebras e links INTERNOS (começando por "/"); nada de HTML.
function Inline({ texto }: { texto: string }) {
  const partes: React.ReactNode[] = [];
  const re = /\[([^\]]{1,200})\]\((\/[^\s)]{1,200})\)|(\/(?:imovel|consulta\/car)\/[A-Za-z0-9%.\-]+)|\*\*([^*]{1,300})\*\*/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(texto))) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    if (m[1] && m[2]) partes.push(<Link key={k++} href={m[2]} className="text-verde underline underline-offset-2">{m[1]}</Link>);
    else if (m[3]) partes.push(<Link key={k++} href={m[3]} className="text-verde underline underline-offset-2">{m[3]}</Link>);
    else if (m[4]) partes.push(<strong key={k++} className="font-semibold text-texto">{m[4]}</strong>);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return <>{partes}</>;
}

function Markdown({ texto }: { texto: string }) {
  const linhas = texto.split("\n");
  const blocos: React.ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length) {
      blocos.push(<ul key={blocos.length} className="list-disc pl-5 space-y-0.5">{lista.map((l, i) => <li key={i}><Inline texto={l} /></li>)}</ul>);
      lista = [];
    }
  };
  for (const l of linhas) {
    const item = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) { lista.push(item[1]); continue; }
    fecharLista();
    if (!l.trim()) continue;
    const titulo = l.match(/^#{1,4}\s+(.*)$/);
    blocos.push(titulo
      ? <p key={blocos.length} className="font-semibold text-texto"><Inline texto={titulo[1]} /></p>
      : <p key={blocos.length}><Inline texto={l} /></p>);
  }
  fecharLista();
  return <div className="space-y-1.5">{blocos}</div>;
}

// ---------------------------------------------------------------- SSE
function eventosDe(bloco: string): Record<string, unknown>[] {
  return bloco.split("\n\n").flatMap((parte) => {
    const dados = parte.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    if (!dados) return [];
    try { return [JSON.parse(dados)]; } catch { return []; }
  });
}

export default function ChatIA({ flutuante = false }: { flutuante?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // a conversa da aba é restaurada ao abrir (não no carregamento da página)
  const restaurado = useRef(false);
  function abrir() {
    if (!restaurado.current) {
      restaurado.current = true;
      try {
        const salvo = JSON.parse(sessionStorage.getItem(CHAVE) ?? "null");
        if (salvo?.msgs) { setMsgs(salvo.msgs); setConversaId(salvo.conversaId ?? null); }
      } catch { /* sem armazenamento: começa vazio */ }
    }
    setAberto(true);
  }
  // os botões de fora (topo, mapa) abrem por evento; a função é recriada a
  // cada render, então o ouvinte guarda a versão mais recente
  const abrirRef = useRef(abrir);
  abrirRef.current = abrir;
  useEffect(() => {
    const ouvir = () => abrirRef.current();
    window.addEventListener(EVENTO, ouvir);
    return () => window.removeEventListener(EVENTO, ouvir);
  }, []);
  useEffect(() => {
    if (!restaurado.current) return;
    try { sessionStorage.setItem(CHAVE, JSON.stringify({ conversaId, msgs: msgs.slice(-30) })); } catch { /* ignore */ }
  }, [msgs, conversaId]);
  useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [msgs, aberto]);

  useEffect(() => {
    if (!aberto || estado) return;
    fetch("/api/ia/estado").then((r) => r.json()).then(setEstado)
      .catch(() => setEstado({ ligado: false, sessao: false, permitido: false }));
  }, [aberto, estado]);

  const atualizarUltima = (fn: (m: Msg) => Msg) =>
    setMsgs((lista) => lista.map((m, i) => (i === lista.length - 1 ? fn(m) : m)));

  async function enviar(pergunta: string) {
    const q = pergunta.trim();
    if (!q || enviando) return;
    setTexto("");
    setEnviando(true);
    setMsgs((l) => [...l, { papel: "user", texto: q }, { papel: "assistant", texto: "", status: "Pensando…" }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const suportaFluxo = typeof ReadableStream !== "undefined" && typeof TextDecoder !== "undefined";

    const aplicar = (ev: Record<string, unknown>) => {
      if (ev.tipo === "inicio" && typeof ev.conversaId === "string") setConversaId(ev.conversaId);
      if (ev.tipo === "texto") atualizarUltima((m) => ({ ...m, texto: m.texto + String(ev.texto ?? ""), status: undefined }));
      if (ev.tipo === "ferramenta") atualizarUltima((m) => ({ ...m, status: `${String(ev.rotulo ?? "Consultando")}…` }));
      if (ev.tipo === "fim") {
        atualizarUltima((m) => ({ ...m, fontes: (ev.fontes as Fonte[]) ?? [], status: undefined }));
        if (typeof ev.restante === "number") setEstado((e) => e?.cota ? { ...e, cota: { ...e.cota, usado: e.cota.limite - (ev.restante as number) } } : e);
      }
      if (ev.tipo === "erro") atualizarUltima((m) => ({ ...m, texto: (m.texto ? m.texto + "\n\n" : "") + String(ev.mensagem ?? "Falhou."), erro: true, status: undefined }));
    };

    try {
      const res = await fetch(`/api/ia/chat${suportaFluxo ? "" : "?stream=0"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagem: q, conversaId }),
        signal: ctrl.signal,
      });
      const tipo = res.headers.get("content-type") ?? "";
      if (!res.ok || !tipo.includes("text/event-stream")) {
        const corpo = await res.json().catch(() => null) as Record<string, unknown> | null;
        if (res.ok && corpo) {
          // resposta inteira (sem streaming)
          if (typeof corpo.conversaId === "string") setConversaId(corpo.conversaId);
          atualizarUltima((m) => ({ ...m, texto: String(corpo.texto ?? ""), fontes: (corpo.fontes as Fonte[]) ?? [], status: undefined }));
        } else if (corpo?.codigo === "ia_ocupada") {
          // pico de uso (teto de conversas simultâneas do servidor): não é erro
          // da pessoa nem do sistema — devolve a pergunta à caixa para reenviar
          atualizarUltima((m) => ({
            ...m, aviso: true, status: undefined,
            texto: String(corpo.error ?? "O assistente está atendendo muita gente agora. Tente de novo em instantes."),
          }));
          setTexto(q);
        } else {
          const msg = [corpo?.error, corpo?.solucao].filter(Boolean).join(" ") || `O assistente não respondeu (${res.status}).`;
          atualizarUltima((m) => ({ ...m, texto: msg, erro: true, status: undefined }));
          if (corpo?.codigo === "ia_desligada" || corpo?.codigo === "cota_esgotada") setEstado(null);
        }
        return;
      }
      if (!res.body) {
        // sem corpo em fluxo: processa tudo de uma vez
        eventosDe(await res.text()).forEach(aplicar);
        return;
      }
      const leitor = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const corte = buffer.lastIndexOf("\n\n");
        if (corte >= 0) {
          eventosDe(buffer.slice(0, corte + 2)).forEach(aplicar);
          buffer = buffer.slice(corte + 2);
        }
      }
      if (buffer.trim()) eventosDe(buffer).forEach(aplicar);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        atualizarUltima((m) => ({ ...m, texto: (m.texto ? m.texto + "\n\n" : "") + "A conexão caiu antes do fim da resposta. Tente de novo.", erro: true, status: undefined }));
      }
    } finally {
      setEnviando(false);
      abortRef.current = null;
      atualizarUltima((m) => (m.status ? { ...m, status: undefined, texto: m.texto || "Sem resposta." } : m));
    }
  }

  function novaConversa() {
    abortRef.current?.abort();
    setMsgs([]); setConversaId(null);
  }

  const restante = estado?.cota ? Math.max(0, estado.cota.limite - estado.cota.usado) : null;
  const podeConversar = !!estado?.ligado && estado.permitido && restante !== 0;

  return (
    <>
      {/* Revisão do Carlos (29/10): a IA se chama "Ari" e precisa ser vista — o
          nome fica sempre à mostra, com o radar da marca pulsando de leve */}
      {flutuante && !aberto && (
        <button type="button" onClick={abrir} aria-label="Pergunte à Ari, a assistente de IA da Arini"
          className="group fixed bottom-3 right-3 z-50 flex h-12 items-center gap-2.5 rounded-full pl-2 pr-4 sm:bottom-5 sm:right-5 sm:h-14 sm:pr-5 text-[#F2F2EC] shadow-[0_1px_2px_rgba(10,34,25,0.25),0_12px_24px_-14px_rgba(10,34,25,0.5)] ring-2 ring-[#D9BD6F]/70 transition hover:-translate-y-0.5 hover:ring-[#D9BD6F]"
          style={{ background: "#124431" }}>
          <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-[#0B2A1E] sm:size-10" aria-hidden>
            <span className="absolute inset-0 animate-ping rounded-full bg-[#D9BD6F]/25 motion-reduce:hidden" />
            <MarcaArini variante="radar" titulo="" className="relative size-5 sm:size-6" />
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[15px] font-bold">Pergunte à Ari</span>
            <span className="hidden text-[11px] text-[#F2F2EC]/70 sm:block">sua assistente de IA</span>
          </span>
        </button>
      )}

      {aberto && (
        <div role="dialog" aria-label="Ari, assistente de IA da Arini"
          className="fixed z-50 inset-x-2 bottom-20 top-20 sm:inset-x-auto sm:right-4 sm:top-auto sm:w-[420px] sm:h-[620px] sm:max-h-[calc(100vh-7rem)] lg:bottom-6 flex flex-col overflow-hidden rounded-3xl border border-linha bg-superficie shadow-[0_1px_2px_var(--sombra-botao),0_24px_56px_-24px_var(--sombra-popup)]">
          <div className="lp-escuro lp-malha-escura relative flex items-center gap-3 px-4 py-3.5 shrink-0">
            <div className="lp-grade pointer-events-none absolute inset-0 opacity-50" aria-hidden />
            <span className="relative grid size-10 shrink-0 place-items-center rounded-full border border-[#D9BD6F]/40 bg-[#124431]" aria-hidden>
              <MarcaArini variante="radar" titulo="" className="size-6" />
            </span>
            <div className="relative flex-1 min-w-0 leading-tight">
              <p className="lp-display text-xl text-texto">Ari</p>
              <p className="mt-0.5 truncate text-[11px] text-texto-2">Assistente de IA da Arini · imóveis, CAR e base de conhecimento</p>
            </div>
            {msgs.length > 0 && (
              <button type="button" onClick={novaConversa} title="Nova conversa"
                className="relative inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-texto-2 transition hover:bg-white/10 hover:text-texto">
                <SquarePen className="size-3.5" /> Nova
              </button>
            )}
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar"
              className="relative grid size-9 place-items-center rounded-full text-texto-2 transition hover:bg-white/10 hover:text-texto">
              <X className="size-[18px]" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-[0.92rem]">
            {!estado && (
              <p className="flex items-center gap-2 text-texto-2"><LoaderCircle className="size-4 animate-spin" /> Carregando…</p>
            )}

            {estado && !estado.ligado && (
              <div className="rounded-2xl border border-linha bg-superficie-2 p-4 space-y-1.5">
                <p className="lp-display text-xl text-verde">{estado.motivo === "desligado" ? "Assistente desligado" : "Assistente em configuração"}</p>
                <p className="text-texto-2 leading-relaxed">
                  {estado.motivo === "desligado"
                    ? "A Arini desligou a Ari por enquanto."
                    : "A Ari, nossa assistente de IA, ainda está sendo configurada."}{" "}
                  Enquanto isso, use a <Link href="/imoveis" className="text-verde underline">busca de imóveis</Link> ou o{" "}
                  <Link href="/mapa" className="text-verde underline">mapa</Link>.
                </p>
              </div>
            )}

            {estado?.ligado && !estado.permitido && estado.negacao && (
              <div className="rounded-2xl border border-ouro/30 bg-ouro/8 p-4 space-y-2">
                <p className="flex items-start gap-2 font-bold text-texto">
                  <Lock className="mt-0.5 size-4 shrink-0 text-ouro" /> {estado.negacao.mensagem}
                </p>
                <p className="text-texto-2 leading-relaxed">{estado.negacao.solucao}</p>
                {estado.sessao
                  ? <Link href="/planos" className="btn-ouro inline-flex items-center gap-1.5 px-4 py-2 text-xs">Ver planos <ArrowRight className="size-3.5" /></Link>
                  : <Link href="/entrar" className="btn-verde inline-flex items-center gap-1.5 px-4 py-2 text-xs">Entrar <ArrowRight className="size-3.5" /></Link>}
              </div>
            )}

            {estado?.ligado && estado.permitido && msgs.length === 0 && (
              <div className="space-y-4">
                <div>
                  <p className="lp-display text-2xl text-verde">Oi, eu sou a Ari. Como posso ajudar?</p>
                  <p className="mt-1 text-texto-2 leading-relaxed">
                    Pergunte sobre imóveis publicados, uma área do CAR ou como o Arini Imóveis Brasil funciona.
                  </p>
                </div>
                <div className="grid gap-2">
                  {SUGESTOES.map((s) => (
                    <button key={s} type="button" onClick={() => enviar(s)} disabled={!podeConversar}
                      className="group flex items-center justify-between gap-3 rounded-full border border-linha-forte bg-superficie px-4 py-2.5 text-left text-sm text-texto-3 transition hover:border-verde/50 hover:text-texto disabled:opacity-50">
                      {s}
                      <ArrowRight className="size-4 shrink-0 text-texto-2 transition group-hover:translate-x-0.5 group-hover:text-verde" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={m.papel === "user" ? "flex justify-end" : "flex gap-2.5"}>
                {m.papel === "assistant" && (
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#124431]" aria-hidden>
                    <MarcaArini variante="radar" titulo="" className="size-5" />
                  </span>
                )}
                <div className={
                  m.papel === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-md bg-[#124431] border border-[#1F4535] text-[#F2F2EC] px-4 py-2.5 whitespace-pre-wrap"
                    : "min-w-0 max-w-[92%] rounded-2xl rounded-bl-md border border-linha bg-superficie-2 px-4 py-2.5 text-texto-3 leading-relaxed " + (m.erro ? "text-critico" : m.aviso ? "text-texto-2 italic" : "")
                }>
                  {m.papel === "user" ? m.texto : <Markdown texto={m.texto} />}
                  {m.status && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-texto-2 animate-pulse">
                      <LoaderCircle className="size-3.5 animate-spin" /> {m.status}
                    </p>
                  )}
                  {!!m.fontes?.length && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {m.fontes.slice(0, 8).map((f, j) => {
                        const Icone = f.tipo === "imovel" ? Home : f.tipo === "car" ? FileText : Database;
                        return f.href ? (
                          <Link key={j} href={f.href} className="inline-flex items-center gap-1 rounded-full border border-linha bg-superficie px-2.5 py-1 text-[11px] text-texto-2 transition hover:border-verde/50 hover:text-texto">
                            <Icone className="size-3 shrink-0" />
                            {f.tipo === "car" ? "CAR" : f.tipo === "imovel" ? "Imóvel" : "Base"} · {f.rotulo.length > 42 ? f.rotulo.slice(0, 42) + "…" : f.rotulo}
                          </Link>
                        ) : (
                          <span key={j} className="inline-flex items-center gap-1 rounded-full border border-linha bg-superficie px-2.5 py-1 text-[11px] text-texto-2">
                            <Database className="size-3 shrink-0" /> Base · {f.rotulo}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={fimRef} />
          </div>

          {estado?.ligado && estado.permitido && (
            <form onSubmit={(e) => { e.preventDefault(); enviar(texto); }} className="border-t border-linha bg-superficie p-3 space-y-2 shrink-0">
              <div className="flex items-end gap-2 rounded-3xl border border-linha-forte bg-superficie-2 p-1.5 transition focus-within:border-verde focus-within:ring-2 focus-within:ring-verde/30">
                <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={1} maxLength={1500}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(texto); } }}
                  placeholder={restante === 0 ? "Cota do mês esgotada" : "Escreva sua pergunta…"}
                  disabled={!podeConversar}
                  aria-label="Sua pergunta"
                  className="flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-texto placeholder:text-texto-2/70 focus:outline-none" />
                <button type="submit" disabled={!podeConversar || enviando || !texto.trim()} aria-label="Enviar"
                  className="btn-verde grid size-10 shrink-0 place-items-center p-0 disabled:opacity-50">
                  {enviando ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                </button>
              </div>
              <p className="px-1 text-[10px] text-texto-2 leading-snug">
                Respostas automáticas: confira na ficha do imóvel. Não envie dados pessoais. Conversas ficam registradas.
                {restante != null && ` · ${restante === 1 ? "1 pergunta restante" : `${restante} perguntas restantes`} no mês.`}
              </p>
            </form>
          )}
        </div>
      )}
    </>
  );
}
