"use client";

import type { CampoCrm } from "@/lib/crmSetores";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

/** Um campo configurável do CRM do setor. */
export default function CampoDado({ c, valor, onChange }: { c: CampoCrm; valor: unknown; onChange: (v: unknown) => void }) {
  const cls = CAMPO_COMPACTO + " w-full";
  const v = valor === null || valor === undefined ? "" : String(valor);
  switch (c.tipo) {
    case "textarea": return <textarea className={cls + " min-h-20"} value={v} onChange={(e) => onChange(e.target.value)} />;
    case "bool": return <input type="checkbox" className="size-5" checked={valor === true} onChange={(e) => onChange(e.target.checked)} />;
    case "select": return (
      <select className={cls} value={v} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {c.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    case "numero": case "dinheiro": return <input type="number" step="any" className={cls} value={v} onChange={(e) => onChange(e.target.value)} />;
    case "data": return <input type="date" className={cls} value={v} onChange={(e) => onChange(e.target.value)} />;
    default: return <input className={cls} value={v} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function mostrarDado(c: CampoCrm, v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (c.tipo === "dinheiro") return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (c.tipo === "bool") return v ? "Sim" : "Não";
  if (c.tipo === "data") return new Date(`${v}T12:00:00`).toLocaleDateString("pt-BR");
  return String(v);
}
