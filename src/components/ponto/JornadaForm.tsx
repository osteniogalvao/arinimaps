"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

const DIAS: [number, string][] = [[1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"]];

/** Jornada de um colaborador, editada em linha na tela da equipe. */
export default function JornadaForm({ userId, inicial }: {
  userId: string;
  inicial: { carga_diaria_min: number; intervalo_min: number; dias_semana: number[]; entrada_prevista: string; tolerancia_min: number; ativo: boolean } | null;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    carga_horas: (inicial?.carga_diaria_min ?? 480) / 60, intervalo_min: inicial?.intervalo_min ?? 60,
    dias_semana: inicial?.dias_semana ?? [1, 2, 3, 4, 5], entrada_prevista: (inicial?.entrada_prevista ?? "08:00").slice(0, 5),
    tolerancia_min: inicial?.tolerancia_min ?? 10, ativo: inicial?.ativo ?? false,
  });
  const [msg, setMsg] = useState("");
  return (
    <form className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault(); setMsg("");
        const r = await fetch("/api/admin/ponto/jornada", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, user_id: userId }) });
        setMsg(r.ok ? "Salvo" : (await r.json().catch(() => ({}))).error ?? "Erro");
        if (r.ok) router.refresh();
      }}>
      <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Bate ponto</label>
      <input type="number" min={1} max={12} className={CAMPO_COMPACTO + " w-16"} value={f.carga_horas} onChange={(e) => setF({ ...f, carga_horas: Number(e.target.value) })} aria-label="Horas por dia" />
      <span className="text-texto-2">h/dia, entrada</span>
      <input type="time" className={CAMPO_COMPACTO} value={f.entrada_prevista} onChange={(e) => setF({ ...f, entrada_prevista: e.target.value })} aria-label="Entrada prevista" />
      <span className="flex gap-1">
        {DIAS.map(([d, rot]) => (
          <button key={d} type="button" onClick={() => setF({ ...f, dias_semana: f.dias_semana.includes(d) ? f.dias_semana.filter((x) => x !== d) : [...f.dias_semana, d] })}
            className={"rounded-full border px-2 py-0.5 text-xs " + (f.dias_semana.includes(d) ? "border-verde bg-verde/15 text-verde" : "border-linha text-texto-2")}>{rot}</button>
        ))}
      </span>
      <button className="btn-contorno px-3 py-1.5 text-xs">Salvar</button>
      {msg && <span className="text-xs text-texto-2">{msg}</span>}
    </form>
  );
}
