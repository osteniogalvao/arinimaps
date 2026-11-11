"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

/** Pedido de ajuste de ponto: incluir, desconsiderar ou abonar o dia. */
export default function PedirAjuste({ marcacoes }: { marcacoes: { id: string; rotulo: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ tipo: "incluir", data: "", hora: "", marcacao_id: "", motivo: "" });
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <form className="cartao grid gap-3 p-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault(); setOcupado(true); setMsg("");
        const r = await fetch("/api/admin/ponto/ajustes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
        setOcupado(false);
        if (!r.ok) { setMsg((await r.json().catch(() => ({}))).error ?? "Não foi possível pedir."); return; }
        setF({ tipo: "incluir", data: "", hora: "", marcacao_id: "", motivo: "" });
        setMsg("Pedido enviado para a Diretoria.");
        router.refresh();
      }}>
      <p className="font-semibold text-texto sm:col-span-2">Pedir ajuste</p>
      <select className={CAMPO_COMPACTO} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
        <option value="incluir">Incluir marcação esquecida</option>
        <option value="desconsiderar">Desconsiderar marcação errada</option>
        <option value="abono">Abonar o dia (atestado, folga combinada)</option>
      </select>
      <input type="date" required className={CAMPO_COMPACTO} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
      {f.tipo === "incluir" && <input type="time" required className={CAMPO_COMPACTO} value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} />}
      {f.tipo === "desconsiderar" && (
        <select required className={CAMPO_COMPACTO} value={f.marcacao_id} onChange={(e) => setF({ ...f, marcacao_id: e.target.value })}>
          <option value="">Escolha a marcação</option>
          {marcacoes.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
        </select>
      )}
      <textarea required minLength={5} placeholder="Motivo" className={CAMPO_COMPACTO + " sm:col-span-2"} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={ocupado} className="btn-verde px-4 py-2 text-sm disabled:opacity-60">Enviar pedido</button>
        {msg && <span className="text-sm text-texto-2">{msg}</span>}
      </div>
    </form>
  );
}
