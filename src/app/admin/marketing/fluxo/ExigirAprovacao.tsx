"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Diretoria: publicar só com o material aprovado. */
export default function ExigirAprovacao({ ligado }: { ligado: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  return (
    <label className="cartao flex items-center gap-3 px-4 py-3 text-sm">
      <input type="checkbox" checked={ligado} disabled={ocupado} onChange={async (e) => {
        setOcupado(true);
        await fetch("/api/admin/imoveis/fluxo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "exigir", ligado: e.target.checked }) }).catch(() => null);
        setOcupado(false); router.refresh();
      }} />
      <span><strong>Só publicar com aprovação da Diretoria.</strong> Ligado, Operações não consegue publicar um imóvel cujo material ainda não foi aprovado aqui.</span>
    </label>
  );
}
