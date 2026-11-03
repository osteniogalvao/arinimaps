/**
 * Municípios atendidos (revisão do Carlos, 29/10): carrossel contínuo em duas
 * fileiras que andam em sentidos opostos, para a lista crescer sem ocupar mais
 * espaço na página. Cada cartão junta a cartografia urbana (satélite da sede)
 * com a rural (mapa topográfico com relevo) num corte diagonal, e o clique
 * abre o mapa principal já na cidade (#pos=zoom/lat/lng).
 *
 * Só CSS (.lp-marquee): pausa com o mouse em cima e para com
 * prefers-reduced-motion. Com poucos municípios, a lista é repetida até
 * encher a fileira.
 */

import Link from "next/link";
import { ArrowUpRight, Building2, MapPin } from "lucide-react";
import MosaicoSatelite from "./MosaicoSatelite";

export type MunicipioCartao = {
  id: string;
  nome: string;
  uf: string;
  lng: number;
  lat: number;
  imoveis: number;
  lotes: number;
};

function Cartao({ m, oculto }: { m: MunicipioCartao; oculto?: boolean }) {
  return (
    <Link
      href={`/mapa#pos=13.5/${m.lat.toFixed(5)}/${m.lng.toFixed(5)}`}
      tabIndex={oculto ? -1 : undefined}
      aria-label={`Abrir ${m.nome} no mapa`}
      className="spotlight lp-escuro group relative mx-2 block aspect-[16/10] w-[17rem] shrink-0 overflow-hidden rounded-2xl bg-[#124431] ring-1 ring-linha transition hover:ring-2 hover:ring-[#6FB08F] md:mx-2.5 md:w-[21rem]"
    >
      <div className="absolute inset-0 transition duration-700 ease-out group-hover:scale-[1.06]">
        {/* rural: topográfico com relevo */}
        <MosaicoSatelite lng={m.lng} lat={m.lat} z={12} camada="relevo" />
        {/* urbano: satélite da sede, num corte diagonal */}
        <div className="absolute inset-0 [clip-path:polygon(0_0,62%_0,38%_100%,0_100%)]">
          <MosaicoSatelite lng={m.lng} lat={m.lat} z={15} />
        </div>
        <div className="absolute inset-0 [background:linear-gradient(105deg,transparent_49.6%,#D9BD6F_49.8%,#D9BD6F_50.2%,transparent_50.4%)] opacity-80" />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,17,13,0)_30%,rgba(7,17,13,.55)_62%,rgba(7,17,13,.95)_100%)]" />
      <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">Urbano</span>
      <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90 transition group-hover:opacity-0">Rural</span>
      <span className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-black/55 text-white opacity-0 transition duration-300 group-hover:rotate-45 group-hover:opacity-100">
        <ArrowUpRight className="size-5" />
      </span>
      <span className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 text-white">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#6FB08F] text-[#124431]">
          {m.lotes > 0 ? <Building2 className="size-5" strokeWidth={1.8} /> : <MapPin className="size-5" strokeWidth={1.8} />}
        </span>
        <span className="min-w-0">
          <span className="lp-display block truncate text-xl leading-tight md:text-2xl">{m.nome} <span className="text-white/60">· {m.uf}</span></span>
          <span className="mt-1 block truncate text-[14px] text-white/80">
            {m.imoveis > 0
              ? `${m.imoveis} ${m.imoveis === 1 ? "imóvel publicado" : "imóveis publicados"}`
              : "Satélite e malha do CAR no mapa"}
            {m.lotes > 0 && ` · ${m.lotes.toLocaleString("pt-BR")} lotes`}
          </span>
        </span>
      </span>
    </Link>
  );
}

function Fileira({ itens, reversa, dur }: { itens: MunicipioCartao[]; reversa?: boolean; dur: number }) {
  if (!itens.length) return null;
  // repete até ter pelo menos 6 cartões por volta (a faixa não pode "acabar" na tela)
  const volta: MunicipioCartao[] = [];
  while (volta.length < 6) volta.push(...itens);
  return (
    <div className="lp-marquee-grupo relative flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_5%,#000_95%,transparent)]">
      <div
        className="lp-marquee flex w-max shrink-0 items-center"
        style={{ ["--lp-marquee-dur" as string]: `${dur}s`, animationDirection: reversa ? "reverse" : undefined }}
      >
        <ul className="flex shrink-0">{volta.map((m, k) => <li key={`a${k}`}><Cartao m={m} oculto={k >= itens.length} /></li>)}</ul>
        <ul className="flex shrink-0" aria-hidden="true">{volta.map((m, k) => <li key={`b${k}`}><Cartao m={m} oculto /></li>)}</ul>
      </div>
    </div>
  );
}

export default function Municipios({ municipios }: { municipios: MunicipioCartao[] }) {
  // fileira de cima com a metade de índice par, a de baixo com a ímpar
  const cima = municipios.filter((_, k) => k % 2 === 0);
  const baixo = municipios.length > 1 ? municipios.filter((_, k) => k % 2 === 1) : [];
  return (
    <div className="space-y-4 md:space-y-5">
      <Fileira itens={cima} dur={Math.max(40, cima.length * 9)} />
      <Fileira itens={baixo} reversa dur={Math.max(44, baixo.length * 9)} />
    </div>
  );
}
