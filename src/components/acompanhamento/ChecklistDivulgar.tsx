"use client";

import { useEffect, useState } from "react";

/** Checklist de preparo do imóvel para as visitas. Fica guardado só neste navegador. */
export default function ChecklistDivulgar({ chave, itens }: { chave: string; itens: string[] }) {
  const [feitos, setFeitos] = useState<string[]>([]);
  const id = "arini-checklist-" + chave;
  useEffect(() => {
    // o que foi marcado fica no navegador: só dá para ler depois de montar (sem divergir do servidor)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const v = JSON.parse(localStorage.getItem(id) ?? "[]"); if (Array.isArray(v)) setFeitos(v); } catch { /* sem armazenamento */ }
  }, [id]);
  function alternar(t: string) {
    const novo = feitos.includes(t) ? feitos.filter((x) => x !== t) : [...feitos, t];
    setFeitos(novo);
    try { localStorage.setItem(id, JSON.stringify(novo)); } catch { /* sem armazenamento */ }
  }
  return <ul className="space-y-2">{itens.map((t) => <li key={t}>
    <label className="flex items-center gap-2.5 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--verde)]" checked={feitos.includes(t)} onChange={() => alternar(t)} />
      <span className={feitos.includes(t) ? "text-texto-2 line-through" : "text-texto"}>{t}</span>
    </label>
  </li>)}</ul>;
}
