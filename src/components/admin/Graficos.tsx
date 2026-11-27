/**
 * Gráficos da Central, em SVG puro (sem biblioteca): renderizam no servidor,
 * seguem o tema (claro/escuro) pelas cores do design system via currentColor
 * e mostram o valor de cada ponto ao passar o mouse (<title>).
 *
 * Regras seguidas: uma série por gráfico (sem legenda, o título diz o que é),
 * traço fino, grade discreta, só o último valor escrito no gráfico e uma
 * tabela escondida para leitores de tela.
 */

export type Ponto = { rotulo: string; valor: number; dica?: string };

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Arredonda o topo da escala para um número "redondo" (1, 2, 5 × 10ⁿ). */
function topo(max: number) {
  if (max <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(max));
  const passo = [1, 2, 5, 10].find((m) => m * p >= max / 4)! * p;
  return Math.ceil(max / passo) * passo;
}

function Tabela({ titulo, pontos }: { titulo: string; pontos: Ponto[] }) {
  return (
    <table className="sr-only">
      <caption>{titulo}</caption>
      <tbody>{pontos.map((p) => <tr key={p.rotulo}><th>{p.rotulo}</th><td>{p.valor}</td></tr>)}</tbody>
    </table>
  );
}

/** Cartão com título, número de destaque e o gráfico. */
export function CartaoGrafico({ titulo, destaque, nota, children }: {
  titulo: string; destaque?: string; nota?: string; children: React.ReactNode;
}) {
  return (
    <section className="cartao p-5 md:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-texto">{titulo}</h3>
        {destaque && <span className="lp-display text-2xl tabular-nums text-texto">{destaque}</span>}
      </div>
      {nota && <p className="mt-0.5 text-xs text-texto-2">{nota}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Área + linha ao longo do tempo (um ponto por dia ou semana). */
export function GraficoArea({ titulo, pontos, cor = "text-verde", altura = 170 }: {
  titulo: string; pontos: Ponto[]; cor?: string; altura?: number;
}) {
  const W = 600, H = altura, E = 30, B = 22, T = 10;
  const max = topo(Math.max(0, ...pontos.map((p) => p.valor)));
  const n = Math.max(1, pontos.length - 1);
  const x = (i: number) => E + (i / n) * (W - E - 8);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const linha = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const area = pontos.length ? `${linha} L${x(pontos.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z` : "";
  const marcas = [0, max / 2, max];
  const cadaX = Math.max(1, Math.ceil(pontos.length / 6));
  const ultimo = pontos[pontos.length - 1];
  const faixa = (W - E - 8) / Math.max(1, pontos.length);
  const gid = "g" + titulo.replace(/[^a-z0-9]/gi, "").slice(0, 20);

  return (
    <div className={cor}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible" role="img" aria-label={titulo}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {marcas.map((m) => (
          <g key={m}>
            <line x1={E} x2={W - 8} y1={y(m)} y2={y(m)} className="stroke-texto/10" strokeWidth={1} />
            <text x={E - 6} y={y(m) + 3.5} textAnchor="end" className="fill-texto-2 text-[10px]">{fmt(Math.round(m))}</text>
          </g>
        ))}
        {area && <path d={area} fill={`url(#${gid})`} />}
        {linha && <path d={linha} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {pontos.map((p, i) => (
          i % cadaX === 0 || i === pontos.length - 1 ? (
            <text key={"x" + i} x={x(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle"}
              className="fill-texto-2 text-[10px]">{p.rotulo}</text>
          ) : null
        ))}
        {ultimo && (
          <g>
            <circle cx={x(pontos.length - 1)} cy={y(ultimo.valor)} r={4} fill="currentColor" className="stroke-superficie" strokeWidth={2} />
            <text x={x(pontos.length - 1) - 8} y={y(ultimo.valor) - 9} textAnchor="end" className="fill-texto text-[11px] font-semibold">
              {fmt(ultimo.valor)}
            </text>
          </g>
        )}
        {/* alvo de hover maior que o ponto: uma faixa vertical por dia */}
        {pontos.map((p, i) => (
          <g key={"h" + i} className="group">
            <rect x={x(i) - faixa / 2} y={T} width={faixa} height={H - T - B} fill="transparent" />
            <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1}
              className="opacity-0 group-hover:opacity-100" />
            <circle cx={x(i)} cy={y(p.valor)} r={4} fill="currentColor" className="opacity-0 group-hover:opacity-100" />
            <title>{p.dica ?? `${p.rotulo}: ${fmt(p.valor)}`}</title>
          </g>
        ))}
      </svg>
      <Tabela titulo={titulo} pontos={pontos} />
    </div>
  );
}

/** Barras verticais (uma série), ex.: cadastros por semana. */
export function GraficoColunas({ titulo, pontos, cor = "text-ouro", altura = 170 }: {
  titulo: string; pontos: Ponto[]; cor?: string; altura?: number;
}) {
  const W = 600, H = altura, E = 30, B = 22, T = 14;
  const max = topo(Math.max(0, ...pontos.map((p) => p.valor)));
  const faixa = (W - E - 8) / Math.max(1, pontos.length);
  const larg = Math.max(4, faixa - 6);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const cadaX = Math.max(1, Math.ceil(pontos.length / 6));
  return (
    <div className={cor}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={titulo}>
        {[0, max / 2, max].map((m) => (
          <g key={m}>
            <line x1={E} x2={W - 8} y1={y(m)} y2={y(m)} className="stroke-texto/10" strokeWidth={1} />
            <text x={E - 6} y={y(m) + 3.5} textAnchor="end" className="fill-texto-2 text-[10px]">{fmt(Math.round(m))}</text>
          </g>
        ))}
        {pontos.map((p, i) => {
          const bx = E + i * faixa + (faixa - larg) / 2;
          const topoY = y(p.valor);
          const h = Math.max(0, y(0) - topoY);
          const r = Math.min(4, larg / 2, h);
          return (
            <g key={i} className="group">
              <rect x={E + i * faixa} y={T} width={faixa} height={H - T - B} fill="transparent" />
              {h > 0 && (
                <path className="opacity-90 group-hover:opacity-100"
                  d={`M${bx},${y(0)} V${topoY + r} Q${bx},${topoY} ${bx + r},${topoY} H${bx + larg - r} Q${bx + larg},${topoY} ${bx + larg},${topoY + r} V${y(0)} Z`}
                  fill="currentColor" />
              )}
              {(i % cadaX === 0 || i === pontos.length - 1) && (
                <text x={bx + larg / 2} y={H - 5} textAnchor="middle" className="fill-texto-2 text-[10px]">{p.rotulo}</text>
              )}
              <title>{p.dica ?? `${p.rotulo}: ${fmt(p.valor)}`}</title>
            </g>
          );
        })}
      </svg>
      <Tabela titulo={titulo} pontos={pontos} />
    </div>
  );
}

/** Barras horizontais com o nome e o valor escritos (ex.: usuários por perfil). */
export function GraficoBarras({ titulo, pontos, cor = "bg-verde" }: { titulo: string; pontos: Ponto[]; cor?: string }) {
  const max = Math.max(1, ...pontos.map((p) => p.valor));
  return (
    <div role="img" aria-label={titulo}>
      <ul className="space-y-2.5">
        {pontos.map((p) => (
          <li key={p.rotulo} className="grid grid-cols-[minmax(7rem,10rem)_1fr_3rem] items-center gap-3 text-sm" title={p.dica ?? `${p.rotulo}: ${fmt(p.valor)}`}>
            <span className="truncate text-texto-2">{p.rotulo}</span>
            <span className="h-2.5 rounded-full bg-texto/8">
              <span className={"block h-2.5 rounded-full " + cor} style={{ width: `${p.valor ? Math.max(2, (p.valor / max) * 100) : 0}%` }} />
            </span>
            <span className="text-right font-semibold tabular-nums text-texto">{fmt(p.valor)}</span>
          </li>
        ))}
      </ul>
      <Tabela titulo={titulo} pontos={pontos} />
    </div>
  );
}
