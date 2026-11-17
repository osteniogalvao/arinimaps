"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Matricula = { matricula: string; matriculas: string[]; nome: string };

/**
 * Linhas "Imóvel" e "Matrícula" do cartão enxuto do CAR (item 14 do PDF do
 * Carlos, 17/11/2026, no modelo do Geomart): o nome da fazenda e a matrícula
 * vêm da parcela certificada no SIGEF, pela mesma rota do MatriculaSigef.
 */
export default function ResumoSigef({ cod, linha }: { cod: string; linha: string }) {
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [m, setM] = useState<Matricula | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/geo/car/${encodeURIComponent(cod)}/matricula`, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json() as { matriculas?: Matricula[] };
        setM(j.matriculas?.[0] ?? null);
        setEstado("ok");
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setEstado("erro"); });
    return () => ctl.abort();
  }, [cod]);

  const carregando = <Loader2 className="inline size-3.5 animate-spin text-texto-2" aria-label="Buscando no SIGEF" />;
  const matricula = m ? (m.matriculas.length > 1 ? m.matriculas.slice(0, 3).join(", ") : m.matricula) : null;
  return <>
    <div className={linha}>
      <dt className="text-texto-2">Imóvel</dt>
      <dd className="min-w-0 truncate text-right font-medium text-texto" title={m?.nome}>
        {estado === "carregando" ? carregando : m?.nome || "—"}
      </dd>
    </div>
    <div className={linha}>
      <dt className="text-texto-2">Matrícula</dt>
      <dd className="text-right font-medium tabular-nums text-texto">
        {estado === "carregando" ? carregando : matricula ? `nº ${matricula}` : estado === "erro" ? "SIGEF fora do ar" : "sem certificação no SIGEF"}
      </dd>
    </div>
  </>;
}
