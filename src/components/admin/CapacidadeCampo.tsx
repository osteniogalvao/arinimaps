"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Capacidade de uma pessoa, editável em linha (Diretoria). */
export default function CapacidadeCampo({ userId, valor }: { userId: string; valor: number }) {
  const router = useRouter();
  const [v, setV] = useState(valor);
  return (
    <input type="number" min={1} max={200} value={v} aria-label="Capacidade"
      className="w-16 rounded-lg border border-linha-forte bg-superficie-2 px-2 py-1 text-sm tabular-nums"
      onChange={(e) => setV(Number(e.target.value))}
      onBlur={async () => {
        if (v === valor) return;
        const r = await fetch("/api/admin/capacidade", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, capacidade: v }) });
        if (r.ok) router.refresh(); else setV(valor);
      }} />
  );
}
