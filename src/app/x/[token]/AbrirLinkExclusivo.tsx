"use client";

import { useEffect, useRef, useState } from "react";

/** Abre o link neste aparelho (POST) e segue para o tour; a prévia do WhatsApp não roda JS, então não gasta o link. */
export default function AbrirLinkExclusivo({ token }: { token: string }) {
  const [estado, setEstado] = useState<{ fase: "abrindo" | "erro"; msg?: string }>({ fase: "abrindo" });
  const feito = useRef(false);
  const abrir = async () => {
    setEstado({ fase: "abrindo" });
    const r = await fetch(`/api/links-exclusivos/${token}/abrir`, { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) as { destino?: string; error?: string } : {};
    if (r?.ok && j.destino) { window.location.replace(j.destino); return; }
    setEstado({ fase: "erro", msg: j.error ?? "Não foi possível abrir agora. Verifique a conexão e tente de novo." });
  };
  useEffect(() => { if (!feito.current) { feito.current = true; void abrir(); } });
  if (estado.fase === "abrindo") return <p className="text-sm">Abrindo o tour…</p>;
  return (
    <div className="space-y-3">
      <p role="alert" className="rounded-xl bg-[#D80B0B]/20 px-4 py-3 text-sm">{estado.msg}</p>
      <button type="button" onClick={abrir} className="rounded-full bg-[#D9BD6F] px-5 py-2 text-sm font-bold text-[#124431]">Tentar de novo</button>
    </div>
  );
}
