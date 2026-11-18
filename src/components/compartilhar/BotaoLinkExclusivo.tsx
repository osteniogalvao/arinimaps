"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle, MessageCircle, X } from "lucide-react";
import { linkWhatsApp } from "@/lib/compartilhar";

/**
 * Link exclusivo do Tour 3D (áudio do Carlos, 18/11/2026, 9h25): "liberar o link
 * para ela encaminhar para uma pessoa apenas". O link abre em um aparelho só;
 * repassado, avisa que já foi usado. Cada clique gera um link novo.
 */
export default function BotaoLinkExclusivo({ codigo, titulo }: { codigo: string; titulo: string }) {
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState("");
  const [dias, setDias] = useState(7);
  const [gerando, setGerando] = useState(false);
  const [link, setLink] = useState<{ url: string; token: string; expira_em: string } | null>(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [revogado, setRevogado] = useState(false);

  async function gerar() {
    setGerando(true); setErro(""); setRevogado(false);
    const r = await fetch("/api/links-exclusivos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, destinatario: para, dias }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setGerando(false);
    if (!r?.ok || !j.url) { setErro(j.error ?? "Não foi possível gerar o link."); return; }
    setLink(j);
  }

  async function revogar() {
    if (!link) return;
    const r = await fetch(`/api/links-exclusivos/${link.token}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) setRevogado(true); else setErro("Não foi possível cancelar o link.");
  }

  const texto = link ? `${para ? `${para}, ` : ""}preparei o Tour 3D de ${titulo} só para você. O link abre em um aparelho:\n${link.url}` : "";

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
        className="btn-contorno flex w-full items-center justify-center gap-2 py-3 text-sm print:hidden">
        <KeyRound className="size-4" /> Link exclusivo do tour (1 pessoa)
      </button>
    );
  }
  return (
    <div className="cartao space-y-3 p-4 text-sm print:hidden">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-texto">Link exclusivo do Tour 3D</p>
        <button type="button" aria-label="Fechar" onClick={() => { setAberto(false); setLink(null); }} className="text-texto-2 hover:text-texto"><X className="size-4" /></button>
      </div>
      <p className="text-xs text-texto-2">Abre em um aparelho só. Se a pessoa repassar, o link avisa que já foi usado. Quem recebe não precisa de conta.</p>
      {!link && <>
        <label className="block space-y-1">
          <span className="text-xs text-texto-2">Para quem (opcional)</span>
          <input value={para} onChange={(e) => setPara(e.target.value)} maxLength={80} placeholder="Ex.: João, comprador de Iturama"
            className="w-full rounded-lg border border-linha-forte bg-superficie px-3 py-2" />
        </label>
        <label className="flex items-center gap-2 text-xs text-texto-2">Vale por
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="rounded-lg border border-linha-forte bg-superficie px-2 py-1 text-texto">
            {[1, 3, 7, 15, 30].map((d) => <option key={d} value={d}>{d} {d === 1 ? "dia" : "dias"}</option>)}
          </select>
        </label>
        <button type="button" onClick={gerar} disabled={gerando} className="btn-verde flex w-full items-center justify-center gap-2 py-2.5 disabled:opacity-60">
          {gerando ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Gerar link exclusivo
        </button>
      </>}
      {link && !revogado && <>
        <p className="break-all rounded-lg bg-superficie-2 px-3 py-2 font-mono text-xs">{link.url}</p>
        <p className="text-xs text-texto-2">Vale até {new Date(link.expira_em).toLocaleDateString("pt-BR")}.</p>
        <div className="grid grid-cols-2 gap-2">
          <a href={linkWhatsApp(texto)} target="_blank" rel="noopener noreferrer" className="btn-whatsapp flex items-center justify-center gap-1.5 py-2 text-xs">
            <MessageCircle className="size-4" /> WhatsApp
          </a>
          <button type="button" className="btn-contorno flex items-center justify-center gap-1.5 py-2 text-xs"
            onClick={async () => { await navigator.clipboard?.writeText(link.url).catch(() => undefined); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
            {copiado ? <Check className="size-4" /> : <Copy className="size-4" />} {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
        <div className="flex justify-between text-xs">
          <button type="button" onClick={() => { setLink(null); setPara(""); }} className="text-verde underline">Gerar outro</button>
          <button type="button" onClick={revogar} className="text-alerta underline">Cancelar este link</button>
        </div>
      </>}
      {revogado && <p className="text-xs text-texto-2">Link cancelado. Quem tentar abrir verá o aviso.</p>}
      {erro && <p role="alert" className="text-xs text-alerta">{erro}</p>}
    </div>
  );
}
