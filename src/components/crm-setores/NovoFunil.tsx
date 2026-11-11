"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

/** Criar um funil novo para um setor (Diretoria). */
export default function NovoFunil({ setores }: { setores: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState({ setor: setores[0]?.id ?? "", nome: "", descricao: "" });
  const [erro, setErro] = useState("");
  if (!aberto) return <button type="button" onClick={() => setAberto(true)} className="btn-verde inline-flex items-center gap-1.5 px-4 py-2.5 text-sm"><Plus className="size-4" /> Novo funil</button>;
  return (
    <form className="cartao flex flex-wrap items-center gap-2 p-4" onSubmit={async (e) => {
      e.preventDefault(); setErro("");
      const r = await fetch("/api/admin/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "salvar_pipeline", ...f }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error ?? "Erro."); return; }
      router.push(`/admin/crm/${j.id}?config=1`);
    }}>
      <select className={CAMPO_COMPACTO} value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value })}>
        {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
      </select>
      <input required placeholder="Nome do funil" className={CAMPO_COMPACTO + " min-w-56 flex-1"} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      <input placeholder="Para que serve (opcional)" className={CAMPO_COMPACTO + " min-w-56 flex-1"} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
      <button className="btn-verde px-4 py-2 text-sm">Criar</button>
      <button type="button" onClick={() => setAberto(false)} className="btn-contorno px-4 py-2 text-sm">Cancelar</button>
      {erro && <p className="w-full text-sm text-critico">{erro}</p>}
    </form>
  );
}
