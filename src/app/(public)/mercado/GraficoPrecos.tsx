"use client";

/**
 * Gráfico de evolução de preço em SVG próprio (o projeto não tem biblioteca de
 * gráficos e não vale trazer uma só para isto). Linha + área, grade leve,
 * e leitura ponto a ponto com o mouse, o dedo ou as setas do teclado.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type PontoCotacao, formatarData, formatarValor, formatarVariacao, sentido,
} from "@/lib/mercado/formato";

const ALTURA = 280;
const M = { topo: 16, dir: 14, base: 30, esq: 64 };

export default function GraficoPrecos({ pontos, casas, unidade }: {
  pontos: PontoCotacao[];
  casas: number;
  unidade: string;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(720);
  const [foco, setFoco] = useState<number | null>(null);
  const idDesc = useId();

  // largura real da caixa: o SVG é desenhado em pixels (texto sem distorção)
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    // o ResizeObserver já avisa uma vez ao começar a observar
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // (a leitura volta a zero a cada série/período: quem usa passa uma `key`)

  const g = useMemo(() => {
    const n = pontos.length;
    const valores = pontos.map((p) => p.valor);
    let min = Math.min(...valores), max = Math.max(...valores);
    if (min === max) { min *= 0.99; max *= 1.01; }
    const folga = (max - min) * 0.08;
    min -= folga; max += folga;
    const w = largura - M.esq - M.dir, h = ALTURA - M.topo - M.base;
    const x = (i: number) => M.esq + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
    const y = (v: number) => M.topo + (1 - (v - min) / (max - min)) * h;
    const linha = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join("");
    const area = n > 1 ? `${linha}L${x(n - 1).toFixed(1)},${M.topo + h}L${x(0).toFixed(1)},${M.topo + h}Z` : "";
    const marcasY = Array.from({ length: 4 }, (_, k) => min + ((max - min) * (k + 0.5)) / 4);
    const qtdX = Math.min(n, largura < 520 ? 3 : 5);
    const marcasX = qtdX <= 1 ? [0] : Array.from({ length: qtdX }, (_, k) => Math.round((k * (n - 1)) / (qtdX - 1)));
    return { x, y, linha, area, marcasY, marcasX, w, h };
  }, [pontos, largura]);

  if (!pontos.length) return null;

  const indiceDoPonteiro = (clientX: number) => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r || pontos.length < 2) return 0;
    const rel = (clientX - r.left - M.esq) / g.w;
    return Math.max(0, Math.min(pontos.length - 1, Math.round(rel * (pontos.length - 1))));
  };

  const teclado = (e: React.KeyboardEvent) => {
    const ult = pontos.length - 1;
    const atual = foco ?? ult;
    const mapa: Record<string, number> = {
      ArrowLeft: Math.max(0, atual - 1), ArrowRight: Math.min(ult, atual + 1), Home: 0, End: ult,
    };
    if (e.key in mapa) { e.preventDefault(); setFoco(mapa[e.key]); }
    else if (e.key === "Escape") setFoco(null);
  };

  const p = foco == null ? null : pontos[foco];
  const ini = pontos[0], fim = pontos[pontos.length - 1];
  const resumo = `Gráfico de ${formatarData(ini.data)} a ${formatarData(fim.data)}: de ${formatarValor(ini.valor, casas)} para ${formatarValor(fim.valor, casas)} ${unidade}.`;

  return (
    <div ref={caixa} className="relative w-full select-none">
      <svg
        viewBox={`0 0 ${largura} ${ALTURA}`}
        // largura 100%: antes da 1ª medida o desenho só escala; depois, 1 unidade = 1 px
        className="block h-auto w-full touch-pan-y rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-verde"
        role="img"
        aria-label={resumo}
        aria-describedby={idDesc}
        tabIndex={0}
        onKeyDown={teclado}
        onPointerMove={(e) => setFoco(indiceDoPonteiro(e.clientX))}
        onPointerDown={(e) => setFoco(indiceDoPonteiro(e.clientX))}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setFoco(null); }}
        onBlur={() => setFoco(null)}
      >
        {/* grade e eixo dos valores */}
        {g.marcasY.map((v) => (
          <g key={v}>
            <line x1={M.esq} x2={largura - M.dir} y1={g.y(v)} y2={g.y(v)} stroke="var(--linha)" strokeDasharray="3 5" />
            <text x={M.esq - 10} y={g.y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--texto-2)" className="tabular-nums">
              {formatarValor(v, casas > 2 ? 2 : casas)}
            </text>
          </g>
        ))}
        {/* datas */}
        {g.marcasX.map((i, k) => (
          <text
            key={`${i}-${k}`}
            x={g.x(i)}
            y={ALTURA - 8}
            fontSize="11"
            fill="var(--texto-2)"
            textAnchor={k === 0 && g.marcasX.length > 1 ? "start" : k === g.marcasX.length - 1 && g.marcasX.length > 1 ? "end" : "middle"}
          >
            {formatarData(pontos[i].data, pontos.length < 200)}
          </text>
        ))}

        {g.area && <path d={g.area} fill="var(--verde)" fillOpacity="0.09" />}
        {pontos.length > 1 && (
          <path d={g.linha} fill="none" stroke="var(--verde)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {pontos.length === 1 && <circle cx={g.x(0)} cy={g.y(fim.valor)} r="5" fill="var(--verde)" />}

        {p && foco != null && (
          <g pointerEvents="none">
            <line x1={g.x(foco)} x2={g.x(foco)} y1={M.topo} y2={M.topo + g.h} stroke="var(--texto-2)" strokeOpacity="0.5" />
            <circle cx={g.x(foco)} cy={g.y(p.valor)} r="5" fill="var(--fundo)" stroke="var(--verde)" strokeWidth="2.5" />
          </g>
        )}
      </svg>

      {/* leitura do ponto */}
      {p && foco != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-xl border border-linha bg-superficie px-3 py-2 text-sm shadow-[0_12px_30px_-14px_var(--sombra-popup)]"
          style={g.x(foco) > largura / 2 ? { right: largura - g.x(foco) + 12 } : { left: g.x(foco) + 12 }}
        >
          <p className="text-xs text-texto-2">{formatarData(p.data)}</p>
          <p className="font-semibold tabular-nums text-texto">
            {formatarValor(p.valor, casas)} <span className="text-xs font-normal text-texto-2">{unidade}</span>
          </p>
          {p.variacao != null && (
            <p className={`text-xs font-semibold tabular-nums ${sentido(p.variacao) === "alta" ? "text-verde" : sentido(p.variacao) === "baixa" ? "text-critico" : "text-texto-2"}`}>
              {formatarVariacao(p.variacao)} no dia
            </p>
          )}
        </div>
      )}
      <p id={idDesc} className="sr-only">Use as setas para a esquerda e para a direita para ler cada dia.</p>
    </div>
  );
}
