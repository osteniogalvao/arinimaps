"use client";

import { useState } from "react";
import { competenciaMensal, formatarData, formatarValor, type CotacaoAtual } from "@/lib/mercado/formato";

export default function CalculadoraCotacao({ serie }: { serie: CotacaoAtual }) {
  const [quantidade, setQuantidade] = useState("");
  const unidade = serie.unidade.slice(3);
  const n = Number(quantidade);
  const total = n * serie.valor;

  return (
    <section aria-labelledby="calcular-receita" className="mt-6 border-t border-linha pt-4">
      <h3 id="calcular-receita" className="text-base font-semibold">
        Calculadora de valor bruto
      </h3>
      <p className="mt-1 text-sm text-texto-2">
        Preço de {formatarData(serie.data, false, competenciaMensal(serie))} multiplicado pela quantidade, antes de frete, taxas e descontos.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          Quantidade em {unidade}
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            className="mt-1 block w-40 rounded-xl border border-linha-forte bg-superficie px-3 py-2 text-texto focus:border-verde"
          />
        </label>
        <output className="py-2 font-semibold tabular-nums" aria-live="polite">
          {quantidade && n > 0 && Number.isFinite(total)
            ? `R$ ${formatarValor(total, 2)}`
            : "Informe uma quantidade positiva."}
        </output>
      </div>
    </section>
  );
}
