"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

const ROTULO: Record<string, string> = {
  leads_atribuidos: "leads entregues", leads_repassados: "leads repassados", leads_sem_atendimento: "leads para a gerência",
  visitas_sem_relatorio: "visitas sem relatório", encaminhamentos_sem_aceite: "encaminhamentos escalonados", cadastros_parados: "cadastros parados",
};

/** Botão "Rodar agora" das automações, com o resumo do que foi feito. */
export default function RodarAutomacoes() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <span className="flex flex-col items-end gap-1.5">
      <button disabled={ocupado} className="btn-verde inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60"
        onClick={async () => {
          setOcupado(true); setMsg("");
          const r = await fetch("/api/admin/automacoes", { method: "POST" });
          const j = await r.json().catch(() => ({}));
          setOcupado(false);
          if (!r.ok) { setMsg(j.error ?? "Não foi possível rodar."); return; }
          const feitos = Object.entries(j.resultado ?? {})
            .filter(([k, v]) => k in ROTULO && Number(v) > 0).map(([k, v]) => `${v} ${ROTULO[k]}`);
          setMsg(feitos.length ? feitos.join(" · ") : "Nada parado agora.");
          router.refresh();
        }}>
        <Play className="size-4" /> {ocupado ? "Rodando…" : "Rodar agora"}
      </button>
      {msg && <span className="max-w-72 text-right text-xs text-texto-2">{msg}</span>}
    </span>
  );
}
