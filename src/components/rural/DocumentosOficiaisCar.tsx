"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

/**
 * Atalhos para baixar os documentos no órgão (vídeo do Carlos, 17/11/2026
 * 16h37: "tenho que ter a opção de baixar um CAR, baixar as plantas"). O SICAR
 * não tem link direto por código: copiamos o código e abrimos a consulta
 * pública; o recibo e o demonstrativo completos saem na Central do
 * Proprietário, com o login do dono. A planta e o memorial da parcela
 * certificada ficam na matrícula (SIGEF), logo abaixo.
 */
export default function DocumentosOficiaisCar({ cod }: { cod: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = () => navigator.clipboard?.writeText(cod).then(() => {
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }).catch(() => {});
  const links = [
    { href: "https://consultapublica.car.gov.br/publico/imoveis/index", nome: "Consulta pública do SICAR", dica: "Cole o código para ver o imóvel e baixar o shapefile" },
    { href: "https://car.gov.br/#/central/acesso", nome: "Recibo e demonstrativo do CAR", dica: "Central do Proprietário, com o login de quem cadastrou" },
  ];
  return (
    <div className="space-y-2">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-texto-2">Documentos no órgão oficial</p>
      <button type="button" onClick={copiar}
        className="inline-flex items-center gap-1.5 rounded-full border border-linha px-3 py-1 text-xs font-semibold text-texto hover:border-[#D9BD6F]">
        {copiado ? <Check className="size-3.5 text-verde" /> : <Copy className="size-3.5" />}
        {copiado ? "Código copiado" : "Copiar o código do CAR"}
      </button>
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline">
              {l.nome} <ExternalLink className="size-3.5" aria-hidden />
            </a>
            <span className="block text-xs text-texto-2">{l.dica}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
