"use client";
import { useState, useRef, useEffect, type RefObject } from "react";

type Referencia = { nome: string; contexto: string; fonte: string; lng: number; lat: number };

export default function BuscaUrbana({
  termo,
  centro,
  abrir,
  botao,
}: {
  botao: RefObject<HTMLButtonElement | null>;
  termo: string;
  centro: () => { lng: number; lat: number } | undefined;
  abrir: (lng: number, lat: number) => void;
}) {
  const [resultados, setResultados] = useState<Referencia[]>([]);
  const [estado, setEstado] = useState("inicial");
  const anterior = useRef<AbortController | null>(null);
  useEffect(() => () => anterior.current?.abort(), []);
  async function pesquisar() {
    const ponto = centro();
    if (!ponto) return;
    anterior.current?.abort();
    const ctrl = new AbortController();
    anterior.current = ctrl;
    setResultados([]);
    setEstado("buscando");
    const params = new URLSearchParams({ q: termo, lng: ponto.lng.toFixed(3), lat: ponto.lat.toFixed(3) });
    try {
      const res = await fetch("/api/geo/busca-urbana?" + params, { signal: ctrl.signal });
      if (!res.ok) throw Error();
      const { resultados } = await res.json();
      if (!ctrl.signal.aborted) {
        setResultados(resultados);
        setEstado("pronto");
      }
    } catch {
      if (!ctrl.signal.aborted) setEstado("erro");
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <button
        type="button"
        ref={botao}
        onClick={pesquisar}
        disabled={estado === "buscando"}
        className="btn-contorno w-full px-3 py-2"
      >
        {estado === "buscando" ? "Buscando…" : "Buscar rua, bairro, quadra ou lote"}
      </button>
      <div aria-live="polite">
        {estado === "erro" && "A busca urbana está indisponível. Tente novamente."}
        {estado === "pronto" &&
          !resultados.length &&
          "Nenhum lugar encontrado na base regional. Tente o nome da rua ou acrescente o município."}
      </div>
      {resultados.length > 0 && (
        <ul className="max-h-64 overflow-auto divide-y divide-linha">
          {resultados.map((r) => (
            <li key={[r.fonte, r.nome, r.contexto, r.lng, r.lat].join("|")}>
              <button
                type="button"
                className="block w-full rounded-lg p-2 text-left hover:bg-verde/10"
                onClick={() => abrir(r.lng, r.lat)}
              >
                <strong>{r.nome}</strong>
                <span className="block text-xs text-texto-2">
                  {r.contexto} · {r.fonte}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
