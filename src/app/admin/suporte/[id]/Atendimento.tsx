"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { Send, StickyNote } from "lucide-react";

const input = CAMPO;

export default function Atendimento({
  id, situacao, prioridade, responsavel, equipe, semConta,
}: {
  id: string; situacao: string; prioridade: string; responsavel: string;
  equipe: { user_id: string; nome: string }[]; semConta: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [interno, setInterno] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(body: Record<string, unknown>) {
    setOcupado(true); setErro("");
    const r = await enviarJson("/api/admin/suporte", "PATCH", { id, ...body });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro.mensagem); return false; }
    router.refresh();
    return true;
  }

  return (
    <div className="cartao p-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className={ROTULO}>Situação</span>
          <select className={input} value={situacao} disabled={ocupado} onChange={(e) => salvar({ status: e.target.value })}>
            <option value="aberto">Aberto</option>
            <option value="em_atendimento">Em atendimento</option>
            <option value="aguardando_cliente">Aguardando cliente</option>
            <option value="resolvido">Resolvido</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={ROTULO}>Responsável</span>
          <select className={input} value={responsavel} disabled={ocupado} onChange={(e) => salvar({ responsavel: e.target.value })}>
            <option value="">Sem responsável</option>
            {equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome || "—"}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={ROTULO}>Prioridade</span>
          <select className={input} value={prioridade} disabled={ocupado} onChange={(e) => salvar({ prioridade: e.target.value })}>
            <option value="baixa">Baixa</option>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
          </select>
        </label>
      </div>

      <form className="space-y-3 border-t border-linha pt-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await salvar({ mensagem: texto, interno })) setTexto("");
        }}>
        <textarea required rows={5} className={input} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder={interno ? "Nota para a equipe — o cliente não vê" : "Resposta ao cliente"} />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="checkbox" checked={interno} onChange={(e) => setInterno(e.target.checked)} />
            Nota interna (não enviar ao cliente)
          </label>
          <button disabled={ocupado} className="btn-verde inline-flex items-center gap-2 px-6 py-3 text-sm disabled:opacity-60">
            {interno ? <StickyNote className="size-4" /> : <Send className="size-4" />}
            {interno ? "Salvar nota" : "Responder"}
          </button>
        </div>
        {!interno && (
          <p className="text-sm leading-relaxed text-texto-2">
            A resposta vai por e-mail{semConta ? " (este visitante não tem conta, então o e-mail é o único canal)" : " e aparece em Meus chamados"}.
            Sem o serviço de e-mail configurado, ela fica só registrada aqui.
          </p>
        )}
        {erro && <p className="text-sm text-critico">{erro}</p>}
      </form>
    </div>
  );
}
