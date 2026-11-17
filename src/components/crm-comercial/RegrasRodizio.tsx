"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { enviarJson } from "@/lib/api/enviar";

export type Regras = { peso: number; tipos: string[]; ufs: string[]; limite_dia: number | null; pausa_ate: string | null };

/** Regras do corretor no rodízio (migration 0147): peso, tipo de imóvel, UFs, limite diário e pausa. */
export default function RegrasRodizio({ userId, regras }: { userId: string; regras: Regras }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [agora] = useState(() => Date.now());
  const [f, setF] = useState({
    peso: String(regras.peso), tipos: regras.tipos, ufs: regras.ufs.join(", "),
    limite_dia: regras.limite_dia ? String(regras.limite_dia) : "",
    pausa_ate: regras.pausa_ate ? new Date(regras.pausa_ate).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "",
  });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const resumo = [
    regras.peso > 1 ? `peso ${regras.peso}` : null,
    regras.tipos.length === 1 ? (regras.tipos[0] === "rural" ? "só rural" : "só urbano") : null,
    regras.ufs.length ? regras.ufs.join("/") : null,
    regras.limite_dia ? `até ${regras.limite_dia}/dia` : null,
    regras.pausa_ate && +new Date(regras.pausa_ate) > agora ? `pausa até ${new Date(regras.pausa_ate).toLocaleDateString("pt-BR")}` : null,
  ].filter(Boolean).join(" · ");

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="text-left text-xs text-texto-2 hover:text-verde">
        {resumo || "sem regras"} <span className="font-semibold text-verde">· editar</span>
      </button>
    );
  }
  const tipo = (t: string) => setF((x) => ({ ...x, tipos: x.tipos.includes(t) ? x.tipos.filter((y) => y !== t) : [...x.tipos, t] }));
  return (
    <form className="flex min-w-72 flex-col gap-2 text-xs"
      onSubmit={async (e) => {
        e.preventDefault();
        setOcupado(true); setErro("");
        const r = await enviarJson("/api/admin/rodizio", "PATCH", { user_id: userId, regras: f });
        setOcupado(false);
        if (!r.ok) { setErro(r.erro.mensagem); return; }
        setAberto(false);
        router.refresh();
      }}>
      <label className="flex items-center justify-between gap-2">Peso na fila (1 a 10)
        <input className={CAMPO_COMPACTO + " w-20"} type="number" min={1} max={10} value={f.peso} onChange={(e) => setF((x) => ({ ...x, peso: e.target.value }))} />
      </label>
      <span className="flex items-center gap-3">Recebe
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={f.tipos.includes("rural")} onChange={() => tipo("rural")} /> rural</label>
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={f.tipos.includes("urbano")} onChange={() => tipo("urbano")} /> urbano</label>
        <span className="text-texto-2">(nenhum = todos)</span>
      </span>
      <label className="flex items-center justify-between gap-2">UFs (vazio = todas)
        <input className={CAMPO_COMPACTO + " w-32"} value={f.ufs} placeholder="MG, SP" onChange={(e) => setF((x) => ({ ...x, ufs: e.target.value }))} />
      </label>
      <label className="flex items-center justify-between gap-2">Limite de leads por dia
        <input className={CAMPO_COMPACTO + " w-20"} type="number" min={1} max={500} value={f.limite_dia} onChange={(e) => setF((x) => ({ ...x, limite_dia: e.target.value }))} />
      </label>
      <label className="flex items-center justify-between gap-2">Pausado até (férias)
        <input className={CAMPO_COMPACTO} type="date" value={f.pausa_ate} onChange={(e) => setF((x) => ({ ...x, pausa_ate: e.target.value }))} />
      </label>
      <span className="flex gap-3">
        <button disabled={ocupado} className="lp-btn lp-btn-verde !px-3 !py-1.5 text-xs disabled:opacity-50">Salvar</button>
        <button type="button" onClick={() => setAberto(false)} className="text-texto-2">Cancelar</button>
      </span>
      {erro && <span className="text-critico">{erro}</span>}
    </form>
  );
}
