"use client";
import { useEffect, useState } from "react";
export default function RetomarCadastro({ volta, telefone }: { volta: string | null; telefone: string }) {
  const [habilitado, setHabilitado] = useState(false),
    [aceite, setAceite] = useState(false),
    [msg, setMsg] = useState(""),
    [ocupado, setOcupado] = useState(false);
  const url = new URL(volta || "/", "https://arinibrasil.com.br");
  const plano = url.pathname === "/planos" && url.searchParams.get("pacote"),
    perfil = url.searchParams.get("perfil");
  useEffect(() => {
    if (plano && perfil)
      fetch("/api/planos/retomar")
        .then((r) => r.json())
        .then((j) => setHabilitado(j.disponivel === true))
        .catch(() => {});
  }, [plano, perfil]);
  if (!plano || !perfil || !habilitado || telefone.replace(/\D/g, "").length < 10) return null;
  async function abrir() {
    setOcupado(true);
    setMsg("");
    try {
      const r = await fetch("/api/planos/retomar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano, perfil, telefone, autorizar: aceite }),
      });
      const j = await r.json();
      if (!r.ok || typeof j.link !== "string" || !j.link.startsWith("https://wa.me/"))
        throw Error(j.error || "Falha ao abrir o WhatsApp.");
      window.location.assign(j.link);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Falha de conexão.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <details className="rounded-lg border border-linha p-3 text-sm">
      <summary className="cursor-pointer font-semibold">Quero terminar meu cadastro depois</summary>
      <label className="my-3 flex gap-2">
        <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
        Autorizo até dois lembretes deste plano no meu WhatsApp. Posso cancelar enviando PARAR LEMBRETES.
      </label>
      <button
        type="button"
        disabled={!aceite || ocupado}
        className="underline disabled:opacity-50"
        onClick={abrir}
      >
        Confirmar no WhatsApp
      </button>
      <p className="text-xs">Envie a mensagem que aparece no WhatsApp para confirmar seu número.</p>
      <p role="status">{msg}</p>
    </details>
  );
}
