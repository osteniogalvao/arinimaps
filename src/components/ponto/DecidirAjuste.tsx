"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Aprovar ou recusar um ajuste de ponto (Diretoria). */
export default function DecidirAjuste({ id }: { id: string }) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  async function decidir(decisao: "aprovar" | "recusar") {
    const resposta = decisao === "recusar" ? window.prompt("Por que o ajuste foi recusado?") ?? "" : "";
    if (decisao === "recusar" && !resposta.trim()) return;
    const r = await fetch("/api/admin/ponto/ajustes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, decisao, resposta }) });
    if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? "Erro."); return; }
    router.refresh();
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => decidir("aprovar")} className="rounded-full border border-verde bg-verde px-3 py-1 text-xs font-semibold text-fundo">Aprovar</button>
      <button type="button" onClick={() => decidir("recusar")} className="rounded-full border border-critico/40 px-3 py-1 text-xs font-semibold text-critico">Recusar</button>
      {erro && <span className="text-xs text-critico">{erro}</span>}
    </span>
  );
}
