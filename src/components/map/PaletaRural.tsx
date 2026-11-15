"use client";

import { useState } from "react";
import { ChevronDown, Layers2, Lock } from "lucide-react";
import { CAMADAS_OFICIAIS, CORES_RURAIS, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import type { EstadoCamada } from "./camadasOficiaisMapa";

const grupos = [
  { nome: "SIGEF", cor: CORES_RURAIS.sigef, ids: ["sigef"] },
  { nome: "SNCI", cor: CORES_RURAIS.snci, ids: ["snci"] },
  { nome: "CAR", cor: CORES_RURAIS.car, ids: ["car"] },
  { nome: "Crédito rural", cor: CORES_RURAIS.credito_rural, ids: ["credito_rural"] },
  { nome: "Indígenas", cor: CORES_RURAIS.funai, ids: ["funai"] },
  { nome: "Outorgas", cor: CORES_RURAIS.outorgas_federais, ids: ["outorgas_federais"] },
  { nome: "Ambiental", cor: CORES_RURAIS.ambiental, ids: ["ucs","ibama_embargos","prodes_cerrado","inpe_queimadas","ibge_biomas"] },
];

export default function PaletaRural({ car, alternarCar, ativas, alternar, estados, bloqueado, abrirCatalogo }: {
  car: boolean; alternarCar: () => void; ativas: Set<CamadaOficialId>;
  alternar: (id: CamadaOficialId) => void; estados: Partial<Record<CamadaOficialId,EstadoCamada>>;
  bloqueado: boolean; abrirCatalogo: () => void;
}) {
  const [aberto,setAberto] = useState<string | null>(null);
  return <section aria-label="Camadas rurais" className="absolute left-3 top-[var(--abaixo-chips,4rem)] z-10 flex max-h-[calc(100%-var(--abaixo-chips,4rem)-5rem)] max-w-[calc(100%-4rem)] flex-col items-start gap-1 overflow-y-auto py-1 pr-1">
    {grupos.map(g => {
      const itens = CAMADAS_OFICIAIS.filter(c => g.ids.includes(c.id));
      const ehCar = g.nome === "CAR";
      if (!ehCar && !itens.length) return null;
      const grupo = itens.length > 1;
      const ligado = ehCar ? car : itens.some(c => ativas.has(c.id));
      const expandido = aberto === g.nome;
      const indisponivel = !ehCar && bloqueado;
      return <div key={g.nome}>
        <button type="button" aria-pressed={grupo ? undefined : ligado} aria-expanded={grupo ? expandido : undefined}
          title={indisponivel ? "Ver acesso a esta camada" : g.nome}
          onClick={() => { if (grupo) setAberto(expandido ? null : g.nome); else if (ehCar) alternarCar(); else if (indisponivel) abrirCatalogo(); else alternar(itens[0].id); }}
          className="flex min-h-7 min-w-[6.6rem] items-center gap-2 rounded-md border border-black/15 px-2 text-left text-[12px] font-bold text-[#13241c] shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
          style={{ background: ligado ? `color-mix(in srgb, ${g.cor} 20%, white)` : "#fff", borderColor: ligado ? g.cor : undefined }}>
          <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] border-2" style={{ borderColor:g.cor, background:ligado ? g.cor : "transparent" }} />
          {g.nome}{grupo && <ChevronDown className="ml-auto size-3"/>}
          {!grupo && indisponivel && <Lock className="ml-auto size-2.5" aria-label="Ver acesso"/>}
        </button>
        {grupo && expandido && <div className="mt-1 grid max-w-56 gap-1 rounded-lg bg-superficie p-2 text-xs text-texto shadow">
          {itens.map(c => <button key={c.id} type="button" aria-pressed={ativas.has(c.id)} className="flex items-center gap-2 py-1 text-left" onClick={() => bloqueado ? abrirCatalogo() : alternar(c.id)}>
            <span className="size-2 rounded-sm border" style={{borderColor:c.cor,background:ativas.has(c.id)?c.cor:"transparent"}}/>{c.nome}
          </button>)}
        </div>}
        {ligado && !grupo && estados[itens[0]?.id]?.aviso && <p role="status" className="mt-0.5 max-w-44 rounded bg-superficie px-2 py-1 text-[10px] text-texto">{estados[itens[0].id]?.aviso}</p>}
      </div>;
    })}
    <button onClick={abrirCatalogo} className="mt-1 flex items-center gap-1 rounded-md bg-superficie px-2 py-1.5 text-xs font-semibold text-texto shadow">
      <Layers2 className="size-3.5"/> Todas as camadas
    </button>
  </section>;
}
