"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import BotaoMapaOnr from "./BotaoMapaOnr";

type Matricula = {
  matricula: string; matriculas: string[]; nome: string; codigoIncra: string;
  situacao: string; cobreDoImovel: number; dentroDoImovel: number;
};

/**
 * Número da matrícula da área do CAR, pelo SIGEF (pedido do Carlos, 20/10/2026):
 * quem clica no imóvel vê o número para pedir o espelho no cartório. Busca ao
 * abrir (o INCRA leva de 2 a 15 s); sem certificação no SIGEF, diz isso.
 */
export default function MatriculaSigef({ cod, compacto = false }: { cod: string; compacto?: boolean }) {
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [lista, setLista] = useState<Matricula[]>([]);
  const [ponto, setPonto] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/geo/car/${encodeURIComponent(cod)}/matricula`, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json() as { matriculas?: Matricula[]; ponto?: { lat: number; lng: number } };
        setLista(j.matriculas ?? []);
        setPonto(j.ponto ?? null);
        setEstado("ok");
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setEstado("erro"); });
    return () => ctl.abort();
  }, [cod]);

  const rotulo = <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-texto-2">Matrícula do imóvel</p>;

  if (estado === "carregando") {
    return (
      <div className="space-y-1.5">
        {rotulo}
        <p className="flex items-center gap-2 text-sm text-texto-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Buscando no SIGEF do INCRA…
        </p>
      </div>
    );
  }
  if (estado === "erro") {
    return (
      <div className="space-y-1.5">
        {rotulo}
        <p className="text-sm text-texto-2">O SIGEF do INCRA não respondeu agora. Feche e abra de novo em instantes.</p>
      </div>
    );
  }
  if (!lista.length) {
    return (
      <div className="space-y-1.5">
        {rotulo}
        <p className="text-sm text-texto-2 leading-relaxed">
          Esta área não tem parcela certificada no SIGEF. O mapa oficial dos cartórios pode ter a matrícula.
        </p>
        {ponto && <BotaoMapaOnr lat={ponto.lat} lng={ponto.lng} compacto={compacto} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rotulo}
      <ul className="space-y-2">
        {lista.slice(0, compacto ? 2 : 6).map((m, i) => (
          <li key={i} className="rounded-2xl border border-[#D9BD6F]/70 px-3.5 py-2.5">
            <p className="flex items-center gap-2 lp-display text-2xl text-texto tabular-nums">
              <FileText className="size-4 shrink-0 text-ouro" aria-hidden />
              {m.matriculas.length > 1 ? `Matrículas nº ${m.matriculas.join(", ")}` : `Matrícula nº ${m.matricula}`}
            </p>
            <p className="mt-0.5 text-xs text-texto-2">
              {m.nome} · cobre {m.cobreDoImovel}% da área
              {!compacto && m.codigoIncra ? ` · código INCRA ${m.codigoIncra}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-relaxed text-texto-2">
        Fonte: INCRA / SIGEF (parcela certificada). Com o número, peça o espelho da matrícula no cartório de registro de imóveis.
      </p>
      {ponto && !compacto && <BotaoMapaOnr lat={ponto.lat} lng={ponto.lng} />}
      {!compacto && (
        <Link href="/ferramentas/matricula" className="block text-xs font-semibold text-verde hover:underline">
          Já tem a certidão? A Ari lê e resume os ônus →
        </Link>
      )}
    </div>
  );
}
