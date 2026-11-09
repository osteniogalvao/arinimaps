"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Send } from "lucide-react";
import { enviarJson } from "@/lib/api/enviar";
import { CAMPO } from "@/components/ui/Pagina";
import { linkWhatsApp } from "@/lib/acompanhamento/textos";

/**
 * O intermediador registra os próximos passos para o proprietário (aparece na
 * aba Acompanhamento e vai por e-mail) e, se quiser, abre o WhatsApp com a
 * mesma mensagem pronta — sem Business API, quem envia é ele.
 */
export default function AtualizarProprietario({ propertyId, codigo, telefone, nome, atual }: {
  propertyId: string; codigo: string; telefone: string | null; nome: string; atual: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(atual);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState("");

  const primeiro = nome.trim().split(/\s+/)[0] || "";
  const mensagem = `Olá${primeiro ? `, ${primeiro}` : ""}! Atualização do seu imóvel ${codigo} na Arini Imóveis Brasil: ${texto.trim() || "seguimos com o atendimento dos interessados."}`;
  const whats = linkWhatsApp(telefone, mensagem);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setMsg("");
    const r = await enviarJson(`/api/imoveis/${propertyId}/acompanhamento`, "POST", { proximos_passos: texto });
    setOcupado(false);
    if (!r.ok) { setMsg(r.erro.mensagem); return; }
    setMsg("Atualização registrada e enviada ao proprietário por e-mail.");
    setAberto(false);
    router.refresh();
  }

  return (
    <div className="mt-3">
      {!aberto ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAberto(true)} className="btn-verde inline-flex items-center gap-2 px-4 py-2 text-sm">
            <Send className="size-4" /> Registrar atualização
          </button>
          {whats && (
            <a href={whats} target="_blank" rel="noopener noreferrer" className="btn-contorno inline-flex items-center gap-2 px-4 py-2 text-sm">
              <MessageCircle className="size-4" /> Abrir no WhatsApp
            </a>
          )}
        </div>
      ) : (
        <form onSubmit={salvar} className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-texto">Próximos passos para o proprietário</span>
            <textarea className={CAMPO} rows={3} maxLength={2000} required value={texto}
              placeholder="Ex.: dois interessados pediram nova visita; retorno da proposta até sexta."
              onChange={(e) => setTexto(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={ocupado} className="btn-verde px-4 py-2 text-sm disabled:opacity-50">
              {ocupado ? "Enviando…" : "Salvar e avisar por e-mail"}
            </button>
            {whats && (
              <a href={whats} target="_blank" rel="noopener noreferrer" className="btn-contorno inline-flex items-center gap-2 px-4 py-2 text-sm">
                <MessageCircle className="size-4" /> Abrir no WhatsApp
              </a>
            )}
            <button type="button" onClick={() => setAberto(false)} className="btn-contorno px-4 py-2 text-sm">Voltar</button>
          </div>
        </form>
      )}
      {msg && <p className="mt-2 text-sm text-texto-2">{msg}</p>}
    </div>
  );
}
