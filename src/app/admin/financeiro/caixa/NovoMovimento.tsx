"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

/** Entrada/saída avulsa ou transferência entre contas do caixa. */
export default function NovoMovimento({ contas, plano }: { contas: { id: string; nome: string }[]; plano: { id: string; codigo: string; nome: string }[] }) {
  const router = useRouter();
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [tipo, setTipo] = useState<"" | "entrada" | "saida" | "transferencia">("");
  const [f, setF] = useState({ conta: contas[0]?.id ?? "", para: contas[1]?.id ?? "", valor: "", data: hoje, historico: "", plano: "" });
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true); setAviso("");
    const corpo = tipo === "transferencia"
      ? { acao: "transferencia", de: f.conta, para: f.para, valor: f.valor, data: f.data, historico: f.historico }
      : { acao: "movimento", conta_bancaria_id: f.conta, natureza: tipo, valor: f.valor, data: f.data, historico: f.historico, conta_id: f.plano || null };
    const r = await fetch("/api/admin/financeiro/caixa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }).catch(() => null);
    setOcupado(false);
    if (!r?.ok) { setAviso((await r?.json().catch(() => ({})))?.error ?? "Não foi possível salvar."); return; }
    setTipo(""); setF({ ...f, valor: "", historico: "" }); router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTipo(tipo === "entrada" ? "" : "entrada")} className="btn-contorno px-3 py-1.5 text-sm">+ Entrada</button>
        <button onClick={() => setTipo(tipo === "saida" ? "" : "saida")} className="btn-contorno px-3 py-1.5 text-sm">− Saída</button>
        {contas.length > 1 && <button onClick={() => setTipo(tipo === "transferencia" ? "" : "transferencia")} className="btn-contorno px-3 py-1.5 text-sm">⇄ Transferência</button>}
      </div>
      {tipo && (
        <form onSubmit={salvar} className="cartao grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs">{tipo === "transferencia" ? "Sai da conta" : "Conta"}
            <select value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })} className={CAMPO_COMPACTO + " mt-1 w-full"}>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          {tipo === "transferencia" ? (
            <label className="text-xs">Entra na conta
              <select value={f.para} onChange={(e) => setF({ ...f, para: e.target.value })} className={CAMPO_COMPACTO + " mt-1 w-full"}>
                {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
          ) : (
            <label className="text-xs">Plano de contas (opcional)
              <select value={f.plano} onChange={(e) => setF({ ...f, plano: e.target.value })} className={CAMPO_COMPACTO + " mt-1 w-full"}>
                <option value="">—</option>
                {plano.map((p) => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs">Valor<input value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} inputMode="decimal" className={CAMPO_COMPACTO + " mt-1 w-full"} placeholder="0,00" /></label>
          <label className="text-xs">Data<input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} className={CAMPO_COMPACTO + " mt-1 w-full"} /></label>
          <label className="text-xs sm:col-span-2">Histórico<input value={f.historico} onChange={(e) => setF({ ...f, historico: e.target.value })} className={CAMPO_COMPACTO + " mt-1 w-full"} placeholder={tipo === "transferencia" ? "Opcional" : "Ex.: sinal recebido do cliente"} /></label>
          <button disabled={ocupado} className="btn-verde px-4 py-2 text-sm sm:col-span-2 lg:col-span-3 lg:justify-self-start">Lançar</button>
          {aviso && <p className="text-xs text-critico sm:col-span-2">{aviso}</p>}
        </form>
      )}
    </section>
  );
}
