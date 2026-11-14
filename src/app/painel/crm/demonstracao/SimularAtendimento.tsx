"use client";
import { useState } from "react";
const etapas = ["Triagem","Em atendimento","Concluído"];
export default function SimularAtendimento() {
  const [historico,setHistorico] = useState<string[]>([etapas[0]]);
  const atual = historico[historico.length-1];
  return <article className="cartao max-w-xl space-y-4 p-6">
    <h2 className="lp-display text-2xl">Consulta de limites da propriedade</h2>
    <p>Cliente de exemplo · Fazenda Modelo</p>
    <p>Etapa atual · <strong>{atual}</strong></p>
    <div className="flex gap-3">{historico.length < etapas.length && <button className="lp-btn lp-btn-verde" onClick={() => setHistorico(h => h.length < etapas.length ? [...h,etapas[h.length]] : h)}>{historico.length === 1 ? "Iniciar atendimento" : "Concluir atendimento"}</button>}
      {historico.length > 1 && <button className="lp-btn lp-btn-contorno" onClick={() => setHistorico([etapas[0]])}>Reiniciar exemplo</button>}</div>
    <p aria-live="polite">Histórico · {historico.join(" → ")}</p>
  </article>;
}
