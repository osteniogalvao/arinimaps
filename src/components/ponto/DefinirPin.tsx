"use client";

import { useState } from "react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

/** Cria ou troca o PIN usado no terminal de ponto da recepção. */
export default function DefinirPin({ temPin }: { temPin: boolean }) {
  const [pin, setPin] = useState("");
  const [confirma, setConfirma] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [definido, setDefinido] = useState(temPin);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== confirma) { setMsg({ tipo: "erro", texto: "Os dois PINs não batem." }); return; }
    setOcupado(true); setMsg(null);
    const r = await fetch("/api/admin/ponto/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) { setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível salvar." }); return; }
    setPin(""); setConfirma(""); setDefinido(true);
    setMsg({ tipo: "ok", texto: "PIN salvo. Use-o no terminal de ponto da recepção." });
  }

  return (
    <form onSubmit={salvar} className="cartao space-y-3 p-5">
      <div>
        <h2 className="font-semibold text-texto">PIN do terminal de ponto</h2>
        <p className="text-sm text-texto-2">{definido ? "Você já tem um PIN. Para trocar, digite um novo." : "Crie um PIN de 4 a 6 números para marcar o ponto no computador da recepção."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,6}" maxLength={6} required value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Novo PIN" aria-label="Novo PIN" className={CAMPO_COMPACTO + " w-32"} />
        <input type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,6}" maxLength={6} required value={confirma}
          onChange={(e) => setConfirma(e.target.value.replace(/\D/g, ""))} placeholder="Repita" aria-label="Repita o PIN" className={CAMPO_COMPACTO + " w-32"} />
        <button disabled={ocupado} className="btn-verde px-4 py-2 text-sm disabled:opacity-60">{definido ? "Trocar PIN" : "Criar PIN"}</button>
      </div>
      {msg && <p className={"text-sm " + (msg.tipo === "ok" ? "text-verde" : "text-critico")}>{msg.texto}</p>}
    </form>
  );
}
