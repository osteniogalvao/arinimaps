"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Chave liga/desliga do corretor no rodízio de leads. */
export default function RodizioToggle({ userId, ligado }: { userId: string; ligado: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" role="switch" aria-checked={ligado} disabled={ocupado}
        aria-label={ligado ? "Tirar do rodízio" : "Colocar no rodízio"}
        onClick={async () => {
          setOcupado(true); setErro("");
          const r = await fetch("/api/admin/rodizio", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, ligado: !ligado }),
          });
          setOcupado(false);
          if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? "Não foi possível salvar."); return; }
          router.refresh();
        }}
        className={"relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 " + (ligado ? "bg-verde" : "bg-linha-forte")}>
        <span className={"absolute top-0.5 size-5 rounded-full bg-white shadow transition-all " + (ligado ? "left-[22px]" : "left-0.5")} />
      </button>
      {erro && <span className="text-xs text-critico">{erro}</span>}
    </span>
  );
}
