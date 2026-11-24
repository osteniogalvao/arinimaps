"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Send } from "lucide-react";
import { useConversa, type MsgSuporte } from "@/components/suporte/useConversa";
import { CAMPO, Etiqueta } from "@/components/ui/Pagina";
import Avaliacao,{type AvaliacaoSuporte} from "@/components/suporte/Avaliacao";

export type Chamado = {
  id: string; codigo: string; assunto: string; status: string; created_at: string; updated_at: string;
  mensagens: MsgSuporte[];
  avaliacao?: AvaliacaoSuporte|null;
};

const SITUACAO: Record<string, string> = {
  aberto: "Recebido", em_atendimento: "Em atendimento", aguardando_cliente: "Aguardando você", resolvido: "Resolvido",
};
const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const tomSituacao = (s: string) =>
  s === "aguardando_cliente" ? "ouro" as const : s === "resolvido" ? "verde" as const : "neutro" as const;

export default function MeusChamados({ chamados }: { chamados: Chamado[] }) {
  const [aberto, setAberto] = useState<string | null>(chamados.find((c) => c.status === "aguardando_cliente")?.id ?? chamados.find(c=>c.status==="resolvido"&&!c.avaliacao)?.id ?? null);

  if (!chamados.length) return null;
  return (
    <section className="space-y-5">
      <div>
        <p className="lp-eyebrow !text-xs">Histórico</p>
        <h2 className="lp-display mt-2 text-2xl text-texto md:text-[1.75rem]">Meus chamados</h2>
      </div>
      <div className="cartao divide-y divide-linha overflow-hidden">
        {chamados.map((c) => (
          <div key={c.id} className="text-[15px]">
            <button type="button" aria-expanded={aberto === c.id}
              className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left transition hover:bg-superficie-2"
              onClick={() => setAberto(aberto === c.id ? null : c.id)}>
              <span className="font-mono text-xs text-texto-2">{c.codigo}</span>
              <span className="min-w-40 flex-1 font-semibold text-texto">{c.assunto}</span>
              <Etiqueta tom={tomSituacao(c.status)}>{SITUACAO[c.status]}</Etiqueta>
              {c.status==="resolvido"&&!c.avaliacao&&<span className="text-sm text-verde">Avaliar atendimento</span>}
              <ChevronDown className={"size-4 shrink-0 text-texto-2 transition " + (aberto === c.id ? "rotate-180" : "")} />
            </button>
            {aberto === c.id && <div className="px-5 pb-5"><Conversa chamado={c} /></div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Conversa ao vivo de um chamado: atualiza sozinha a cada 5 s enquanto aberta. */
function Conversa({ chamado }: { chamado: Chamado }) {
  const { mensagens, extra, adicionar } = useConversa<MsgSuporte, { status: string; atendente_online: boolean;avaliacao:AvaliacaoSuporte|null }>(
    `/api/suporte/${chamado.id}`, chamado.mensagens,
  );
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const status = extra.status ?? chamado.status;

  useEffect(() => { fim.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [mensagens.length]);

  async function responder() {
    setOcupado(true); setErro("");
    const res = await fetch(`/api/suporte/${chamado.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mensagem: texto }),
    });
    setOcupado(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErro(d.error ?? "Não foi possível enviar."); return; }
    setTexto("");
    if (d.mensagem) adicionar([d.mensagem]);
  }

  return (
    <div className="space-y-4 border-t border-linha pt-4">
      <p className="flex items-center gap-2 text-sm text-texto-2">
        <span className={"w-2 h-2 rounded-full " + (extra.atendente_online ? "bg-verde" : "bg-texto-2/40")} aria-hidden />
        {extra.atendente_online === undefined
          ? "Conectando…"
          : extra.atendente_online
            ? "Atendente online — a resposta aparece aqui sem recarregar."
            : "Equipe fora agora — respondemos aqui e por e-mail assim que possível."}
        {status !== chamado.status && <Etiqueta tom={tomSituacao(status)} className="ml-auto">{SITUACAO[status]}</Etiqueta>}
      </p>
      <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
        {mensagens.map((m) => (
          <div key={m.id} className={"rounded-2xl border p-4 " + (m.da_equipe ? "mr-6 rounded-tl-md border-verde/30 bg-verde/5" : "ml-6 rounded-tr-md border-linha bg-superficie-2")}>
            <p className="mb-1.5 text-xs font-semibold text-texto-2">{m.da_equipe ? `${m.autor_nome} · equipe Arini` : "Você"} · {quando(m.created_at)}</p>
            <p className="whitespace-pre-wrap leading-relaxed text-texto">{m.corpo}</p>
          </div>
        ))}
        <div ref={fim} />
      </div>
      {(status==="resolvido"||extra.avaliacao||chamado.avaliacao)&&<Avaliacao id={chamado.id} valor={extra.avaliacao??chamado.avaliacao??null}/>}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); responder(); }}>
        <textarea required rows={3} value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra a linha
            if (e.key === "Enter" && !e.shiftKey && texto.trim().length >= 2 && !ocupado) { e.preventDefault(); responder(); }
          }}
          placeholder={status === "resolvido" ? "Escreva para reabrir o chamado" : "Sua mensagem (Enter envia, Shift+Enter quebra a linha)"}
          className={CAMPO} />
        {erro && <p className="text-sm text-critico">{erro}</p>}
        <button disabled={ocupado} className="lp-btn lp-btn-contorno !px-5 !py-2.5 text-sm disabled:opacity-60">{ocupado ? "Enviando…" : <>Enviar <Send /></>}</button>
      </form>
    </div>
  );
}
