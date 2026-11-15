"use client";
import { useState } from "react";
export default function ConfirmarWhatsapp() {
  const [aviso, setAviso] = useState(""),
    [ocupado, setOcupado] = useState(false),
    [link, setLink] = useState("");
  async function preparar() {
    setOcupado(true);
    setAviso("");
    setLink("");
    try {
      const r = await fetch("/api/conta/confirmar-whatsapp", { method: "POST" });
      const j = await r.json();
      if (!r.ok || typeof j.link !== "string" || !j.link.startsWith("https://wa.me/"))
        throw Error(j.error || "Não foi possível confirmar.");
      setLink(j.link);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Falha de conexão.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="space-y-1 text-sm">
      <button type="button" disabled={ocupado} onClick={preparar} className="underline">
        Confirmar meu número com a ARINI
      </button>
      {link && (
        <p>
          <a href={link} target="_blank" rel="noreferrer" className="text-verde underline">
            Abrir o WhatsApp oficial e enviar a confirmação
          </a>
          . Depois, volte e atualize o Pix.
        </p>
      )}
      {aviso && <p role="status">{aviso}</p>}
    </div>
  );
}
