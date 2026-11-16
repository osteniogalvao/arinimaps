"use client";

import { useState } from "react";

export default function RelatorioPersonalizado({ caminho, raioM, completo, desenho = false }: { caminho: string; raioM: number; completo: boolean; desenho?: boolean }) {
  const opcoes = [
    ["cadastro", desenho ? "Dados da área desenhada" : "Dados cadastrais"], ["mapa", "Imagem de satélite e divisa"],
    ...(completo && !desenho ? [["ambiente", "Ambiente no perímetro"]] : []),
    ...(completo ? [["fontes", "Consultas às fontes oficiais"]] : []),
  ];
  const [secoes, setSecoes] = useState(new Set(opcoes.map(([id]) => id)));
  return <details className="mt-3 text-sm">
    <summary className="cursor-pointer font-semibold text-verde">Personalizar relatório</summary>
    <form action={caminho} method="get" className="mt-3 space-y-2">
      <input type="hidden" name="modelo" value={completo ? "completo" : "simples"} />
      <input type="hidden" name="raio_m" value={raioM} />
      <input type="hidden" name="personalizar" value="1" />
      {opcoes.map(([id, titulo]) => <label key={id} className="block"><input name="secao" value={id} type="checkbox" checked={secoes.has(id)}
        onChange={e => { const novo = new Set(secoes); if (e.target.checked) novo.add(id); else novo.delete(id); setSecoes(novo); }} /> {titulo}</label>)}
      <button className="rounded-lg border border-verde px-3 py-2 font-semibold text-verde disabled:opacity-50" disabled={!secoes.size}>Baixar PDF personalizado</button>
    </form>
  </details>;
}
