"use client";

/**
 * Consulta das cotações (/mercado): lista com busca por produto, praça e região
 * à esquerda; série escolhida à direita, com o gráfico, o período (7d a 1 ano)
 * e o comparativo histórico. A série vai na URL (?serie=...), para poder ser
 * compartilhada; período e filtros ficam só na tela.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, ExternalLink, Minus, Search, TrendingDown, TrendingUp, X,
} from "lucide-react";
import {
  type CotacaoAtual, type PeriodoId, type PontoCotacao, PERIODOS, PRODUTOS,
  competenciaMensal, estatisticas, formatarData, formatarDataHora, formatarValor, formatarVariacao, localDaSerie, recortar, sentido,
} from "@/lib/mercado/formato";
import GraficoPrecos from "./GraficoPrecos";
import CalculadoraCotacao from "./CalculadoraCotacao";
import { ESTADOS, REGIOES, podeComparar, termosDaPraca, urlSerie } from "@/lib/mercado/pracas";

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const COR = { alta: "text-verde", baixa: "text-critico", estavel: "text-texto-2" } as const;

function Variacao({ v, grande = false }: { v: number | null; grande?: boolean }) {
  if (v == null) return <span className="text-texto-2">—</span>;
  const s = sentido(v);
  const Seta = s === "alta" ? ArrowUpRight : s === "baixa" ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${COR[s]} ${grande ? "text-base" : "text-sm"}`}>
      <Seta className={grande ? "size-4" : "size-3.5"} aria-hidden />
      <span className="sr-only">{s === "alta" ? "alta de" : s === "baixa" ? "queda de" : "estável,"}</span>
      {formatarVariacao(v)}
    </span>
  );
}

export default function PainelMercado({ catalogo, selecionada, pontos, periodoInicial, comparada, pontosComparados }: {
  catalogo: CotacaoAtual[];
  selecionada: CotacaoAtual;
  pontos: PontoCotacao[];
  periodoInicial: PeriodoId;
  comparada: CotacaoAtual | null;
  pontosComparados: PontoCotacao[];
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [produto, setProduto] = useState("todos");
  const [uf, setUf] = useState("todas");
  const [regiao, setRegiao] = useState("todas");
  const periodoUrl = useSearchParams().get("periodo");
  const periodo = PERIODOS.find(p => p.id === periodoUrl)?.id ?? periodoInicial;
  const mensal = competenciaMensal(selecionada);
  const detalhe = useRef<HTMLElement>(null);
  const primeira = useRef(true);

  // no celular a lista fica embaixo do gráfico: ao trocar de série, volta para ele
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    const el = detalhe.current;
    if (!el || el.getBoundingClientRect().top >= 0) return;
    const reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduz ? "auto" : "smooth", block: "start" });
  }, [selecionada.slug]);

  const produtos = useMemo(() => [...new Set(catalogo.map((c) => c.produto))], [catalogo]);
  const ufs = useMemo(
    () => [...new Set(catalogo.map((c) => c.uf).filter((u): u is string => !!u))].sort(),
    [catalogo],
  );

  const filtradas = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    return catalogo.filter((c) => {
      if (produto !== "todos" && c.produto !== produto) return false;
      if (uf !== "todas" && c.uf !== uf) return false;
      if (regiao !== "todas" && !REGIOES[regiao]?.includes(c.uf ?? "")) return false;
      if (!termos.length) return true;
      const alvo = semAcento([c.nome, PRODUTOS[c.produto], termosDaPraca(c), c.descricao, c.fonte].filter(Boolean).join(" "));
      return termos.every((t) => alvo.includes(t));
    });
  }, [catalogo, busca, produto, uf, regiao]);

  const grupos = useMemo(() => {
    const m = new Map<string, CotacaoAtual[]>();
    for (const c of filtradas) m.set(c.produto, [...(m.get(c.produto) ?? []), c]);
    return [...m.entries()];
  }, [filtradas]);

  const dias = PERIODOS.find((p) => p.id === periodo)!.dias;
  const recorte = useMemo(() => recortar(pontos, dias), [pontos, dias]);
  const est = estatisticas(recorte);
  const local = localDaSerie(selecionada);
  const curto = pontos.length > 0 && recorte.length === pontos.length && pontos.length < 60 && dias > 7;
  const filtrando = busca || produto !== "todos" || uf !== "todas" || regiao !== "todas";
  const compativeis = catalogo.filter((c) => podeComparar(selecionada, c));
  const porData = new Map(pontosComparados.map((p) => [p.data, p.valor]));
  const pontosEmComum = comparada ? recorte.filter((p) => porData.has(p.data)) : [];
  const ultimoComum = pontosEmComum.at(-1);
  const segundoValor = ultimoComum && porData.get(ultimoComum.data);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-10">
      {/* ---------------------------------------------------------------- série escolhida */}
      <section ref={detalhe} id="grafico" aria-labelledby="titulo-serie" className="cartao min-w-0 scroll-mt-28 p-5 md:p-7 lg:order-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ouro">{PRODUTOS[selecionada.produto] ?? selecionada.produto}</p>
            <h2 id="titulo-serie" className="lp-display mt-1 text-2xl text-texto md:text-3xl">
              {selecionada.nome}{local && <span className="text-texto-2"> · {local}</span>}
            </h2>
            {selecionada.descricao && <p className="mt-1 text-sm text-texto-2">{selecionada.descricao}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-3xl font-semibold tabular-nums text-texto md:text-4xl">
              {formatarValor(selecionada.valor, selecionada.casas)}
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-texto-2 sm:justify-end">
              <span>{selecionada.unidade}</span>
              <Variacao v={selecionada.variacao} />
            </p>
            <p className="mt-0.5 text-xs text-texto-2">{mensal ? "Competência" : "Fechamento de"} {formatarData(selecionada.data, false, mensal)}</p>
          </div>
        </div>

        {/* período */}
        <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Período do gráfico">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={periodo === p.id}
              onClick={() => window.history.replaceState(null, "", urlSerie(selecionada.slug, comparada?.slug, p.id))}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition sm:px-4 ${
                periodo === p.id ? "border-verde bg-verde text-fundo" : "border-linha-forte text-texto-3 hover:border-verde hover:text-verde"
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {recorte.length ? (
            <GraficoPrecos mensal={mensal} key={`${selecionada.slug}-${periodo}`} pontos={recorte} casas={selecionada.casas} unidade={selecionada.unidade} />
          ) : (
            <p className="rounded-xl border border-dashed border-linha-forte px-4 py-10 text-center text-sm text-texto-2">
              Ainda não há histórico desta série.
            </p>
          )}
          {curto && (
            <p className="mt-2 text-xs text-texto-2">
              A primeira observação disponível desta série é de {formatarData(pontos[0].data, false, mensal)}.
            </p>
          )}
        </div>

        {/* comparativo do período */}
        {est && (
          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-linha bg-linha md:grid-cols-4">
            <div className="bg-superficie p-4">
              <dt className="text-xs text-texto-2">Variação no período</dt>
              <dd className="mt-1">
                {est.n === 1 ? <span className="text-sm text-texto-2">Apenas um fechamento disponível</span> : <>
                <span className={`flex items-center gap-1.5 text-lg font-semibold tabular-nums ${COR[sentido(est.variacao)]}`}>
                  {sentido(est.variacao) === "alta" ? <TrendingUp className="size-5" aria-hidden /> : sentido(est.variacao) === "baixa" ? <TrendingDown className="size-5" aria-hidden /> : <Minus className="size-5" aria-hidden />}
                  {formatarVariacao(est.variacao)}
                </span>
                <span className="text-xs text-texto-2">
                  {sentido(est.variacao) === "alta" ? "Valorização" : sentido(est.variacao) === "baixa" ? "Desvalorização" : "Estável"} desde {formatarData(est.inicio.data, false, mensal)}
                </span>
                </>}
              </dd>
            </div>
            <div className="bg-superficie p-4">
              <dt className="text-xs text-texto-2">Máxima</dt>
              <dd className="mt-1">
                <span className="block text-lg font-semibold tabular-nums text-texto">{formatarValor(est.max.valor, selecionada.casas)}</span>
                <span className="text-xs text-texto-2">em {formatarData(est.max.data, false, mensal)}</span>
              </dd>
            </div>
            <div className="bg-superficie p-4">
              <dt className="text-xs text-texto-2">Mínima</dt>
              <dd className="mt-1">
                <span className="block text-lg font-semibold tabular-nums text-texto">{formatarValor(est.min.valor, selecionada.casas)}</span>
                <span className="text-xs text-texto-2">em {formatarData(est.min.data, false, mensal)}</span>
              </dd>
            </div>
            <div className="bg-superficie p-4">
              <dt className="text-xs text-texto-2">Média</dt>
              <dd className="mt-1">
                <span className="block text-lg font-semibold tabular-nums text-texto">{formatarValor(est.media, selecionada.casas)}</span>
                <span className="text-xs text-texto-2">{est.n} {est.n === 1 ? "observação" : "observações"}</span>
              </dd>
            </div>
          </dl>
        )}

        {compativeis.length > 0 && <section className="mt-6 space-y-3 border-t border-linha pt-4" aria-label="Comparativo entre praças">
          <label className="block text-sm font-semibold">Comparar com outra série
            <select className="mt-1 block w-full rounded-xl border border-linha-forte bg-superficie px-3 py-2 text-sm font-normal"
              value={comparada?.slug ?? ""} onChange={(e) => router.replace(urlSerie(selecionada.slug, e.target.value, periodo), { scroll: false })}>
              <option value="">Escolha uma praça ou indicador</option>
              {compativeis.map((c) => <option key={c.id} value={c.slug}>{[c.nome, localDaSerie(c), c.fonte].filter(Boolean).join(" · ")}</option>)}
            </select>
          </label>
          {comparada && (ultimoComum && segundoValor !== undefined ? <>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-texto-3">
              <span>━ {local ?? selecionada.nome}</span><span className="text-ouro">┄ {localDaSerie(comparada) ?? comparada.nome}</span>
            </div>
            <GraficoPrecos mensal={mensal} key={`${selecionada.slug}-${comparada.slug}-${periodo}`} pontos={pontosEmComum}
              casas={selecionada.casas} unidade={selecionada.unidade}
              comparacao={{ nome: localDaSerie(comparada) ?? comparada.nome, valores: pontosEmComum.map((p) => porData.get(p.data)!) }} />
            <p className="text-sm text-texto-2">Em {formatarData(ultimoComum.data, false, mensal)}, a primeira série fechou em {formatarValor(ultimoComum.valor, selecionada.casas)} e a segunda em {formatarValor(segundoValor, comparada.casas)} {selecionada.unidade}.
              {" "}Diferença de {formatarVariacao((ultimoComum.valor / segundoValor - 1) * 100)} sobre a segunda série. O gráfico reúne os fechamentos nas mesmas datas.</p>
          </> : <p className="text-sm text-texto-2">As duas séries não têm fechamentos na mesma data neste período.</p>)}
        </section>}

        {selecionada.unidade.startsWith("R$/") && <CalculadoraCotacao key={selecionada.id} serie={selecionada} />}

        {/* fonte */}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-linha pt-4 text-xs text-texto-2">
          <a href={selecionada.url_fonte} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-texto-3 hover:text-verde">
            Fonte: {selecionada.fonte} <ExternalLink className="size-3.5" aria-hidden />
          </a>
          {selecionada.atualizado_em && <span>Atualizado em {formatarDataHora(selecionada.atualizado_em)}</span>}
          <span>Valores em {selecionada.unidade}</span>
        </div>
      </section>

      {/* ---------------------------------------------------------------- lista e busca */}
      <section aria-label="Todas as cotações" className="min-w-0 lg:order-1">
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Buscar por produto, praça ou região</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-texto-2" aria-hidden />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Produto, praça ou região"
              className="w-full rounded-full border border-linha-forte bg-superficie py-3 pl-11 pr-4 text-[15px] text-texto outline-none transition placeholder:text-texto-2 focus:border-verde"
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Produto">
            {["todos", ...produtos].map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={produto === p}
                onClick={() => setProduto(p)}
                className={`rounded-full border px-3 py-1 text-sm font-semibold transition ${
                  produto === p ? "border-verde bg-verde text-fundo" : "border-linha text-texto-3 hover:border-verde hover:text-verde"
                }`}
              >
                {p === "todos" ? "Todos" : PRODUTOS[p] ?? p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex-1">
              <span className="sr-only">Estado</span>
              <select
                value={uf}
                onChange={(e) => setUf(e.target.value)}
                className="w-full rounded-full border border-linha-forte bg-superficie px-4 py-2.5 text-sm text-texto outline-none focus:border-verde"
              >
                <option value="todas">Todos os estados</option>
                {ufs.filter((u) => regiao === "todas" || REGIOES[regiao].includes(u)).map((u) => <option key={u} value={u}>{ESTADOS[u] ?? u} ({u})</option>)}
              </select>
            </label>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Região</span>
              <select value={regiao} onChange={(e) => { setRegiao(e.target.value); setUf("todas"); }}
                className="w-full rounded-full border border-linha-forte bg-superficie px-3 py-2.5 text-sm text-texto">
                <option value="todas">Todas as regiões</option>
                {Object.entries(REGIOES).filter(([, estados]) => ufs.some((u) => estados.includes(u)))
                  .map(([nome]) => <option key={nome}>{nome}</option>)}
              </select>
            </label>
            {filtrando && (
              <button
                type="button"
                onClick={() => { setBusca(""); setProduto("todos"); setUf("todas"); setRegiao("todas"); }}
                className="inline-flex items-center gap-1 text-sm font-semibold text-texto-2 hover:text-verde"
              >
                <X className="size-4" aria-hidden /> Limpar
              </button>
            )}
          </div>
          <p className="text-xs text-texto-2" aria-live="polite">
            {filtradas.length} {filtradas.length === 1 ? "cotação" : "cotações"}
          </p>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-linha bg-superficie">
          {grupos.length ? grupos.map(([prod, itens]) => (
            <div key={prod}>
              <h3 className="border-b border-linha bg-superficie-2 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-texto-2">
                {PRODUTOS[prod] ?? prod}
              </h3>
              <ul className="divide-y divide-linha">
                {itens.map((c) => {
                  const atual = c.slug === selecionada.slug;
                  const lugar = localDaSerie(c);
                  return (
                    <li key={c.id}>
                      <Link
                        href={urlSerie(c.slug, undefined, competenciaMensal(c) === mensal ? periodo : undefined)}
                        scroll={false}
                        aria-current={atual ? "true" : undefined}
                        className={`flex items-center gap-3 px-4 py-3 transition ${atual ? "bg-verde/10" : "hover:bg-superficie-2"}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-texto">
                            {c.nome}{lugar && <span className="font-normal text-texto-2"> · {lugar}</span>}
                          </span>
                          <span className="block truncate text-xs text-texto-2">{c.fonte} · {formatarData(c.data, false, competenciaMensal(c))}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[15px] font-semibold tabular-nums text-texto">
                            {formatarValor(c.valor, c.casas)} <span className="text-xs font-normal text-texto-2">{c.unidade}</span>
                          </span>
                          <Variacao v={c.variacao} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )) : (
            <p className="px-4 py-10 text-center text-sm text-texto-2">Nenhuma cotação com esses filtros.</p>
          )}
        </div>
      </section>
    </div>
  );
}
