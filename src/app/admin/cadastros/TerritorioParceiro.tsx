"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";

/**
 * Franquia territorial: a Matriz transforma um parceiro aprovado em franqueado
 * de uma região. O franqueado continua vendo só os próprios imóveis; aprovar
 * e publicar segue sendo da Matriz.
 */
export default function TerritorioParceiro({
  id, tipo, regionId, regioes,
}: { id: string; tipo: string; regionId: string; regioes: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(region_id: string) {
    setOcupado(true); setErro("");
    const r = await enviarJson("/api/admin/parceiros", "PATCH", { id, region_id });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro.mensagem); return; }
    router.refresh();
  }

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-texto-2" title="Região que este parceiro representa como franqueado">
      {tipo === "franqueado" ? "Franqueado de" : "Território"}
      <select value={regionId} disabled={ocupado} onChange={(e) => salvar(e.target.value)}
        className="max-w-48 rounded-lg border border-linha-forte bg-superficie-2 px-3 py-2 text-sm text-texto focus:border-verde focus:outline-none focus:ring-2 focus:ring-verde/30">
        <option value="">— nenhum —</option>
        {regioes.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
      </select>
      {erro && <span className="text-xs text-critico">{erro}</span>}
    </label>
  );
}
