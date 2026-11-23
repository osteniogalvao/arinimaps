"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

/** Botões da parcela de aluguel: pagar, repassar, reter, cancelar e desfazer. */
export default function AcoesParcela({ id, status, repasse, valor }: { id: string; status: string; repasse: string; valor: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState<"" | "pagar">("");
  const [valorPago, setValorPago] = useState(String(valor));
  const [data, setData] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function agir(corpo: Record<string, unknown>) {
    setOcupado(true); setErro("");
    const r = await fetch("/api/admin/financeiro/alugueis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...corpo }) }).catch(() => null);
    setOcupado(false);
    if (!r?.ok) { setErro((await r?.json().catch(() => ({})))?.error ?? "Não foi possível salvar."); return; }
    setAberto(""); router.refresh();
  }
  const motivo = (pergunta: string) => window.prompt(pergunta)?.trim();
  const btn = "rounded-full border border-linha px-3 py-1 text-xs font-semibold hover:border-verde hover:text-verde disabled:opacity-50";

  return (
    <div className="flex min-w-[180px] flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        {["pendente", "atrasado"].includes(status) && <button disabled={ocupado} className={btn} onClick={() => setAberto(aberto ? "" : "pagar")}>Recebido</button>}
        {status === "pago" && repasse !== "repassado" && <button disabled={ocupado} className={btn} onClick={() => agir({ acao: "repassar", data })}>Repassado</button>}
        {status === "pago" && repasse === "pendente" && <button disabled={ocupado} className={btn} onClick={() => { const m = motivo("Por que reter o repasse?"); if (m) void agir({ acao: "reter", motivo: m }); }}>Reter</button>}
        {status === "pago" && repasse === "repassado" && <button disabled={ocupado} className={btn} onClick={() => agir({ acao: "desfazer_repasse" })}>Desfazer repasse</button>}
        {status === "pago" && repasse !== "repassado" && <button disabled={ocupado} className={btn} onClick={() => agir({ acao: "desfazer_pagamento" })}>Desfazer pagamento</button>}
        {["pendente", "atrasado"].includes(status) && <button disabled={ocupado} className={btn} onClick={() => { const m = motivo("Por que cancelar esta parcela?"); if (m) void agir({ acao: "cancelar", motivo: m }); }}>Cancelar</button>}
      </div>
      {aberto === "pagar" && (
        <form className="flex flex-wrap justify-end gap-1.5" onSubmit={(e) => { e.preventDefault(); void agir({ acao: "pagar", valor: valorPago, data }); }}>
          <input aria-label="Valor recebido" value={valorPago} onChange={(e) => setValorPago(e.target.value.replace(",", "."))} className={CAMPO_COMPACTO + " w-24"} inputMode="decimal" />
          <input aria-label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} className={CAMPO_COMPACTO} />
          <button disabled={ocupado} className="btn-verde px-3 py-1 text-xs">Confirmar</button>
        </form>
      )}
      {erro && <p className="text-xs text-critico">{erro}</p>}
    </div>
  );
}
