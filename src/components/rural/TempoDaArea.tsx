"use client";

import { useEffect, useState } from "react";
import { CloudRain, Loader2, TriangleAlert, Wind } from "lucide-react";
import type { AvisoMeteorologico, Previsao } from "@/lib/clima/tempo";

type Resposta = { previsao: Previsao | null; previsao_erro: string | null; avisos: AvisoMeteorologico[] | null; avisos_erro: string | null };

const dia = (iso: string) => new Date(iso + "T12:00:00-03:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" });
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const um = (v: number | null, sufixo: string, casas = 0) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: casas })}${sufixo}`);

/**
 * Previsão de 7 dias (NOAA GFS) e avisos oficiais do INMET para a área
 * (item 19 do PDF do Carlos, 17/11/2026). Aviso oficial e previsão de modelo
 * ficam separados; falha de uma fonte aparece como falha, nunca como "tudo normal".
 */
export default function TempoDaArea({ lat, lng, ibge }: { lat: number; lng: number; ibge: number | null }) {
  const [r, setR] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    const qs = new URLSearchParams({ lat: lat.toFixed(4), lng: lng.toFixed(4), ...(ibge ? { ibge: String(ibge) } : {}) });
    fetch(`/api/geo/tempo?${qs}`, { signal: ctl.signal })
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
      .then(setR)
      .catch((e) => { if ((e as Error).name !== "AbortError") setErro(true); });
    return () => ctl.abort();
  }, [lat, lng, ibge]);

  return (
    <section className="space-y-5">
      <div>
        <p className="lp-eyebrow text-xs">Tempo e alertas</p>
        <h2 className="lp-display mt-2 text-2xl text-texto md:text-[1.75rem]">Previsão e avisos para a área</h2>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-texto-2">
          Previsão do modelo global GFS da NOAA para o centro da área e avisos oficiais do INMET para o município.
          A previsão é regional (grade de cerca de 25 km) e não mede a chuva de um talhão.
        </p>
      </div>
      {!r && !erro && <p className="flex items-center gap-2 text-sm text-texto-2"><Loader2 className="size-4 animate-spin" /> Consultando NOAA e INMET…</p>}
      {erro && <p className="text-sm text-texto-2">As fontes de tempo não responderam agora. Abra a página de novo em instantes.</p>}
      {r && <>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-texto">Avisos oficiais do INMET</p>
          {r.avisos_erro ? <p className="text-sm text-texto-2">{r.avisos_erro} Isso não significa ausência de risco.</p>
            : r.avisos == null ? <p className="text-sm text-texto-2">Município não identificado para os avisos.</p>
            : !r.avisos.length ? <p className="text-sm text-texto-2">Nenhum aviso ativo do INMET para o município nesta consulta.</p>
            : <ul className="space-y-2">{r.avisos.map((a) => (
                <li key={a.id} className="cartao flex gap-3 p-4" style={a.cor ? { borderLeft: `6px solid ${a.cor}` } : undefined}>
                  <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alerta" />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-texto">{a.evento} · {a.severidade}</p>
                    <p className="text-texto-2">De {hora(a.inicio)} a {hora(a.fim)}</p>
                    {a.riscos.length > 0 && <p className="mt-1 text-texto-2">{a.riscos.slice(0, 3).join(" ")}</p>}
                    <a href={a.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-verde underline">Ver aviso oficial</a>
                  </div>
                </li>))}</ul>}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-texto">Previsão para 7 dias</p>
          {r.previsao_erro || !r.previsao ? <p className="text-sm text-texto-2">{r.previsao_erro ?? "Previsão indisponível."}</p> : <>
            <div className="flex snap-x gap-2 overflow-x-auto pb-2">
              {r.previsao.dias.map((d) => (
                <div key={d.data} className="cartao w-32 shrink-0 snap-start p-3 text-sm">
                  <p className="font-semibold capitalize text-texto">{dia(d.data)}</p>
                  <p className="mt-1 tabular-nums text-texto">{um(d.tmin, "°")} / {um(d.tmax, "°")}</p>
                  <p className="mt-1 flex items-center gap-1 tabular-nums text-texto-2"><CloudRain className="size-3.5" /> {um(d.chuvaMm, " mm", 1)}{d.chanceChuva != null ? ` · ${d.chanceChuva}%` : ""}</p>
                  <p className="flex items-center gap-1 tabular-nums text-texto-2"><Wind className="size-3.5" /> {um(d.ventoMaxKmh, " km/h")}</p>
                </div>))}
            </div>
            <p className="text-xs text-texto-2">Fonte: {r.previsao.fonte} · consultado em {hora(r.previsao.consultado_em)}.</p>
          </>}
        </div>
      </>}
    </section>
  );
}
