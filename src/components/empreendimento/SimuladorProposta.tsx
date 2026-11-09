"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, FileDown, Send, RotateCcw } from "lucide-react";
import { CAMPO, ROTULO, Etiqueta } from "@/components/ui/Pagina";
import MarcaArini from "@/components/marca/MarcaArini";
import { enviarJson } from "@/lib/api/enviar";
import {
  lerNumeroBR, numeroParaCampo, simular, somarMeses,
  PERIODICIDADE_LABEL, type EntradaSimulacao, type Periodicidade, type SistemaAmortizacao,
} from "@/lib/simulador";

/** Rodada já gravada que tem simulação (proposals.parcelamento.simulador). */
export type RodadaSimulada = {
  id: string;
  numero_rodada: number;
  autor_lado: string;
  status: string;
  valor: number;
  simulacao: EntradaSimulacao;
};

type Props = {
  /** sem oportunidade, o simulador só calcula e gera o PDF */
  oportunidadeId?: string | null;
  imovel: { codigo: string; titulo: string };
  valorTabela: number | null;
  cliente?: string | null;
  /** loteadora/incorporadora/anunciante, vai no cabeçalho do PDF */
  anunciante?: string | null;
  /** AAAA-MM-DD de hoje no fuso de Brasília (vem do servidor: evita diferença de hidratação) */
  hoje: string;
  rodadas?: RodadaSimulada[];
  /** quem está simulando: o anunciante contrapropõe como "vendedor" */
  ladoPadrao?: "comprador" | "vendedor";
};

type Form = {
  valorTabela: string; valorProposto: string;
  entradaTipo: "valor" | "percentual"; entrada: string;
  parcelas: string; periodicidade: Periodicidade; sistema: SistemaAmortizacao;
  juros: string; jurosBase: "am" | "aa";
  indice: string; correcao: string;
  dataBase: string; primeiraData: string;
  baloesQtd: string; baloesValor: string; baloesIntervalo: string;
  observacoes: string; lado: "comprador" | "vendedor";
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number, casas = 2) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const dataBR = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");

function formDe(e: EntradaSimulacao, lado: Form["lado"], hoje: string): Form {
  return {
    valorTabela: numeroParaCampo(e.valorTabela), valorProposto: numeroParaCampo(e.valorProposto),
    entradaTipo: e.entrada?.tipo ?? "percentual", entrada: numeroParaCampo(e.entrada?.valor ?? 0),
    parcelas: String(e.parcelas ?? 0), periodicidade: e.periodicidade ?? "mensal", sistema: e.sistema ?? "price",
    juros: numeroParaCampo(e.juros?.taxa ?? 0), jurosBase: e.juros?.base ?? "am",
    indice: e.correcao?.indice ?? "", correcao: numeroParaCampo(e.correcao?.taxaAnual ?? 0),
    // data-base passada vira hoje: a nova rodada parte de agora
    dataBase: e.dataBase && e.dataBase >= hoje ? e.dataBase : hoje,
    primeiraData: e.primeiraData && e.primeiraData > hoje ? e.primeiraData : somarMeses(hoje, 1),
    baloesQtd: String(e.baloes?.quantidade ?? 0), baloesValor: numeroParaCampo(e.baloes?.valor ?? 0),
    baloesIntervalo: String(e.baloes?.intervaloMeses ?? 6),
    observacoes: "", lado,
  };
}

function entradaDe(f: Form): EntradaSimulacao {
  const n = (s: string) => { const v = lerNumeroBR(s); return Number.isFinite(v) ? v : 0; };
  return {
    valorTabela: n(f.valorTabela), valorProposto: n(f.valorProposto),
    entrada: { tipo: f.entradaTipo, valor: n(f.entrada) },
    parcelas: Math.floor(n(f.parcelas)), periodicidade: f.periodicidade, sistema: f.sistema,
    juros: { taxa: n(f.juros), base: f.jurosBase },
    correcao: n(f.correcao) > 0 ? { indice: f.indice.trim() || "índice informado", taxaAnual: n(f.correcao) } : undefined,
    dataBase: f.dataBase, primeiraData: f.primeiraData,
    baloes: n(f.baloesQtd) > 0 && n(f.baloesValor) > 0
      ? { quantidade: Math.floor(n(f.baloesQtd)), valor: n(f.baloesValor), intervaloMeses: Math.floor(n(f.baloesIntervalo)) || 6 }
      : undefined,
  };
}

/** Texto curto do plano de pagamento (vai no "prazo" da rodada e no PDF). */
function planoTexto(e: EntradaSimulacao, primeira: number) {
  const partes: string[] = [];
  if (e.parcelas > 0) {
    partes.push(`${e.parcelas}x ${PERIODICIDADE_LABEL[e.periodicidade].toLowerCase()}${e.parcelas > 1 ? "s" : ""} (${e.sistema === "sac" ? "SAC" : "Price"}) a partir de ${dataBR(e.primeiraData)}, 1ª de ${brl(primeira)}`);
  }
  if (e.baloes) partes.push(`${e.baloes.quantidade} balão(ões) de ${brl(e.baloes.valor)} a cada ${e.baloes.intervaloMeses} meses`);
  return partes.join(" + ") || "À vista";
}

/**
 * Simulador de proposta para incorporadora/loteadora (segunda etapa, item 20):
 * valor de tabela × proposto, entrada, saldo, parcelas (Price ou SAC), balões,
 * juros/correção e a tabela de vencimentos. "Gerar proposta em PDF" abre a
 * versão de impressão (Salvar como PDF, mesmo caminho do relatório territorial);
 * "Enviar para aprovação" grava uma nova rodada no fluxo de propostas da
 * oportunidade, que o anunciante aceita, recusa ou contrapropõe.
 */
export default function SimuladorProposta(props: Props) {
  const { hoje } = props;
  const router = useRouter();
  const docRef = useRef<HTMLDivElement>(null);
  const inicial = (): Form => formDe({
    valorTabela: props.valorTabela ?? 0, valorProposto: props.valorTabela ?? 0,
    entrada: { tipo: "percentual", valor: 10 }, parcelas: 36, periodicidade: "mensal", sistema: "price",
    juros: { taxa: 0, base: "am" }, dataBase: hoje, primeiraData: somarMeses(hoje, 1),
  }, props.ladoPadrao ?? "comprador", hoje);
  const [f, setF] = useState<Form>(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const muda = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const entrada = useMemo(() => entradaDe(f), [f]);
  const r = useMemo(() => simular(entrada), [entrada]);
  const ok = r.erros.length === 0;

  function gerarPdf() {
    const html = docRef.current?.innerHTML;
    if (!html || !ok) return;
    const w = window.open("", "_blank");
    if (!w) { setAviso({ erro: true, texto: "O navegador bloqueou a janela do PDF. Libere pop-ups para este site e tente de novo." }); return; }
    w.document.open();
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Proposta ${props.imovel.codigo}</title><style>${CSS_PDF}</style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  }

  async function enviar() {
    if (!props.oportunidadeId || !ok) return;
    setOcupado(true);
    setAviso(null);
    const plano = planoTexto(entrada, r.primeiraParcela);
    const res = await enviarJson(`/api/oportunidades/${props.oportunidadeId}`, "POST", {
      tipo: "proposta",
      autor_lado: f.lado,
      valor: entrada.valorProposto,
      entrada: r.entrada || null,
      prazo: plano.slice(0, 300),
      condicoes: [
        `Tabela ${brl(entrada.valorTabela)} · proposta ${brl(entrada.valorProposto)} (${r.diferenca >= 0 ? "+" : ""}${pct(r.diferencaPercentual)})`,
        `Entrada ${brl(r.entrada)} · saldo ${brl(r.saldo)} · ${r.taxaMensal > 0 ? `${pct(r.taxaMensal * 100, 4)} a.m.` : "sem juros"}${entrada.correcao ? ` (inclui ${entrada.correcao.indice} ${pct(entrada.correcao.taxaAnual)} a.a.)` : ""}`,
        `Total ${brl(r.totalPago)}`,
        f.observacoes.trim(),
      ].filter(Boolean).join("\n").slice(0, 2000),
      // entradas da simulação: a tabela é refeita a partir delas (src/lib/simulador.ts)
      parcelamento: {
        simulador: {
          versao: 1, entrada,
          resumo: { saldo: r.saldo, primeira_parcela: r.primeiraParcela, total_pago: r.totalPago, total_juros: r.totalJuros, linhas: r.linhas.length },
        },
      },
    });
    setOcupado(false);
    if (!res.ok) { setAviso({ erro: true, texto: res.erro.mensagem }); return; }
    setAviso({ erro: false, texto: "Rodada enviada. Ela aparece em Propostas e contrapropostas aguardando aprovação." });
    router.refresh();
  }

  const lin = "grid gap-3 sm:grid-cols-2";
  return (
    <section id="simulador" className="cartao scroll-mt-24 space-y-6 p-5 md:p-7">
      <header className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><Calculator className="size-5" /></span>
        <div className="min-w-0">
          <h2 className="lp-display text-xl md:text-2xl text-texto">Simulador de proposta</h2>
          <p className="mt-1 text-base text-texto-2">{props.imovel.codigo} — {props.imovel.titulo}</p>
        </div>
      </header>

      {!!props.rodadas?.length && (
        <div className="space-y-2">
          <p className={ROTULO}>Rodadas com simulação</p>
          <ul className="space-y-2">
            {props.rodadas.map((rd) => (
              <li key={rd.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-superficie-2 px-4 py-3 text-sm">
                <span className="font-mono text-xs">R{rd.numero_rodada}</span>
                <span className="flex-1">{rd.autor_lado === "vendedor" ? "Vendedor" : "Comprador"}: <strong>{brl(rd.valor)}</strong></span>
                <Etiqueta tom={rd.status === "aceita" ? "verde" : rd.status === "recusada" ? "critico" : "neutro"}>{rd.status === "enviada" ? "aguardando" : rd.status}</Etiqueta>
                <button type="button" className="inline-flex items-center gap-1 font-semibold text-verde hover:underline"
                  onClick={() => {
                    setF(formDe(rd.simulacao, rd.autor_lado === "vendedor" ? "comprador" : "vendedor", hoje));
                    setAviso({ erro: false, texto: `Rodada ${rd.numero_rodada} carregada. Ajuste e envie como contraproposta.` });
                  }}>
                  <RotateCcw className="size-3.5" /> contrapropor
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className={lin}>
            <Campo rotulo="Valor de tabela (R$)"><input className={CAMPO} inputMode="decimal" value={f.valorTabela} onChange={(e) => muda("valorTabela", e.target.value)} /></Campo>
            <Campo rotulo="Valor proposto (R$)"><input className={CAMPO} inputMode="decimal" value={f.valorProposto} onChange={(e) => muda("valorProposto", e.target.value)} /></Campo>
          </div>
          <div className={lin}>
            <Campo rotulo="Entrada">
              <div className="flex gap-2">
                <input className={CAMPO} inputMode="decimal" value={f.entrada} onChange={(e) => muda("entrada", e.target.value)} />
                <select className={`${CAMPO} !w-24`} value={f.entradaTipo} aria-label="Entrada em reais ou percentual"
                  onChange={(e) => muda("entradaTipo", e.target.value as Form["entradaTipo"])}>
                  <option value="percentual">%</option><option value="valor">R$</option>
                </select>
              </div>
            </Campo>
            <Campo rotulo="Sistema">
              <select className={CAMPO} value={f.sistema} onChange={(e) => muda("sistema", e.target.value as SistemaAmortizacao)}>
                <option value="price">Price (parcelas iguais)</option>
                <option value="sac">SAC (parcelas decrescentes)</option>
              </select>
            </Campo>
          </div>
          <div className={lin}>
            <Campo rotulo="Número de parcelas"><input className={CAMPO} inputMode="numeric" value={f.parcelas} onChange={(e) => muda("parcelas", e.target.value)} /></Campo>
            <Campo rotulo="Periodicidade">
              <select className={CAMPO} value={f.periodicidade} onChange={(e) => muda("periodicidade", e.target.value as Periodicidade)}>
                {(Object.keys(PERIODICIDADE_LABEL) as Periodicidade[]).map((p) => <option key={p} value={p}>{PERIODICIDADE_LABEL[p]}</option>)}
              </select>
            </Campo>
          </div>
          <div className={lin}>
            <Campo rotulo="Juros">
              <div className="flex gap-2">
                <input className={CAMPO} inputMode="decimal" value={f.juros} onChange={(e) => muda("juros", e.target.value)} />
                <select className={`${CAMPO} !w-28`} value={f.jurosBase} aria-label="Base dos juros"
                  onChange={(e) => muda("jurosBase", e.target.value as Form["jurosBase"])}>
                  <option value="am">% a.m.</option><option value="aa">% a.a.</option>
                </select>
              </div>
            </Campo>
            <Campo rotulo="Correção por índice (% a.a.)">
              <div className="flex gap-2">
                <input className={`${CAMPO} !w-28`} placeholder="IPCA" value={f.indice} onChange={(e) => muda("indice", e.target.value)} aria-label="Nome do índice" />
                <input className={CAMPO} inputMode="decimal" value={f.correcao} onChange={(e) => muda("correcao", e.target.value)} aria-label="Taxa anual do índice" />
              </div>
            </Campo>
          </div>
          <div className={lin}>
            <Campo rotulo="Data-base (entrada)"><input type="date" className={CAMPO} value={f.dataBase} onChange={(e) => muda("dataBase", e.target.value)} /></Campo>
            <Campo rotulo="1ª parcela"><input type="date" className={CAMPO} value={f.primeiraData} onChange={(e) => muda("primeiraData", e.target.value)} /></Campo>
          </div>
          <fieldset className="rounded-xl border border-linha p-4">
            <legend className="px-1 text-sm font-semibold text-texto">Balões (reforços), opcional</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Quantidade"><input className={CAMPO} inputMode="numeric" value={f.baloesQtd} onChange={(e) => muda("baloesQtd", e.target.value)} /></Campo>
              <Campo rotulo="Valor (R$)"><input className={CAMPO} inputMode="decimal" value={f.baloesValor} onChange={(e) => muda("baloesValor", e.target.value)} /></Campo>
              <Campo rotulo="A cada">
                <select className={CAMPO} value={f.baloesIntervalo} onChange={(e) => muda("baloesIntervalo", e.target.value)}>
                  <option value="6">6 meses</option><option value="12">12 meses</option>
                </select>
              </Campo>
            </div>
            <p className="mt-2 text-xs text-texto-2">Cada balão abate essa parte do saldo e é pago com os juros até o vencimento.</p>
          </fieldset>
          {props.oportunidadeId && (
            <div className={lin}>
              <Campo rotulo="Esta rodada é">
                <select className={CAMPO} value={f.lado} onChange={(e) => muda("lado", e.target.value as Form["lado"])}>
                  <option value="comprador">Proposta do comprador</option>
                  <option value="vendedor">Contraproposta do vendedor</option>
                </select>
              </Campo>
              <Campo rotulo="Observações"><input className={CAMPO} value={f.observacoes} onChange={(e) => muda("observacoes", e.target.value)} maxLength={500} /></Campo>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3">
            <Numero rotulo="Diferença p/ tabela" valor={`${r.diferenca > 0 ? "+" : ""}${brl(r.diferenca)}`}
              extra={`${r.diferenca > 0 ? "+" : ""}${pct(r.diferencaPercentual)}`} alerta={r.diferenca < 0} />
            <Numero rotulo="Entrada" valor={brl(r.entrada)} extra={pct(r.entradaPercentual)} />
            <Numero rotulo="Saldo" valor={brl(r.saldo)} extra={r.taxaMensal > 0 ? `${pct(r.taxaMensal * 100, 4)} a.m.` : "sem juros"} />
            <Numero rotulo={f.sistema === "sac" ? "1ª / última parcela" : "Parcela"}
              valor={brl(r.primeiraParcela)} extra={f.sistema === "sac" && r.ultimaParcela ? `última ${brl(r.ultimaParcela)}` : undefined} />
            <Numero rotulo="Juros e correção" valor={brl(r.totalJuros)} />
            <Numero rotulo="Total pago" valor={brl(r.totalPago)} />
          </dl>
          {!ok && (
            <ul role="alert" className="space-y-1 rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">
              {r.erros.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          <div className="max-h-80 overflow-auto rounded-xl border border-linha">
            <table className="w-full min-w-[480px] text-sm tabular-nums">
              <thead className="sticky top-0 bg-superficie-2 text-left text-xs text-texto-2">
                <tr><th className="px-3 py-2">Nº</th><th className="px-3 py-2">Vencimento</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2 text-right">Juros</th><th className="px-3 py-2 text-right">Amortização</th><th className="px-3 py-2 text-right">Saldo</th></tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {r.linhas.map((l) => (
                  <tr key={l.numero} className={l.tipo === "balao" ? "bg-ouro/10" : undefined}>
                    <td className="px-3 py-1.5">{l.numero}{l.tipo === "balao" && <span className="ml-1 text-xs text-texto-2">balão</span>}</td>
                    <td className="px-3 py-1.5">{dataBR(l.data)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-texto">{brl(l.valor)}</td>
                    <td className="px-3 py-1.5 text-right text-texto-2">{brl(l.juros)}</td>
                    <td className="px-3 py-1.5 text-right text-texto-2">{brl(l.amortizacao)}</td>
                    <td className="px-3 py-1.5 text-right text-texto-2">{brl(l.saldoDevedor)}</td>
                  </tr>
                ))}
                {!r.linhas.length && <tr><td colSpan={6} className="px-3 py-4 text-texto-2">{ok ? "Pagamento à vista." : "Corrija os campos para ver as parcelas."}</td></tr>}
              </tbody>
            </table>
          </div>
          {aviso && <p role={aviso.erro ? "alert" : "status"} className={`text-sm ${aviso.erro ? "text-critico" : "text-verde"}`}>{aviso.texto}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={!ok} onClick={gerarPdf} className="lp-btn lp-btn-contorno !px-5 !py-3 text-[0.95rem] disabled:opacity-50">
              <FileDown /> Gerar proposta em PDF
            </button>
            {props.oportunidadeId ? (
              <button type="button" disabled={!ok || ocupado} onClick={enviar} className="lp-btn lp-btn-verde !px-5 !py-3 text-[0.95rem] disabled:opacity-50">
                <Send /> {ocupado ? "Enviando…" : "Enviar para aprovação"}
              </button>
            ) : (
              <p className="self-center text-sm text-texto-2">Para enviar para aprovação, abra o simulador dentro da negociação do lote.</p>
            )}
          </div>
        </div>
      </div>

      {/* documento da proposta: copiado para a janela de impressão (Salvar como PDF) */}
      <div ref={docRef} hidden>
        <div className="doc">
          <header className="cab">
            <span className="marca"><MarcaArini titulo="Arini Imóveis Brasil" /></span>
            {props.anunciante && <span className="anunciante"><small>Empreendedor</small><strong>{props.anunciante}</strong></span>}
          </header>
          <h1>Proposta de compra</h1>
          <p className="sub">{props.imovel.codigo} — {props.imovel.titulo}{props.cliente ? ` · Proponente: ${props.cliente}` : ""}</p>
          <table className="resumo">
            <tbody>
              <tr><th>Valor de tabela</th><td>{brl(entrada.valorTabela)}</td><th>Valor proposto</th><td>{brl(entrada.valorProposto)}</td></tr>
              <tr><th>Diferença</th><td>{brl(r.diferenca)} ({pct(r.diferencaPercentual)})</td><th>Entrada</th><td>{brl(r.entrada)} ({pct(r.entradaPercentual)}) em {dataBR(entrada.dataBase)}</td></tr>
              <tr><th>Saldo</th><td>{brl(r.saldo)}</td><th>Taxa</th><td>{r.taxaMensal > 0 ? `${pct(r.taxaMensal * 100, 4)} a.m.` : "sem juros"}{entrada.correcao ? ` (inclui ${entrada.correcao.indice} ${pct(entrada.correcao.taxaAnual)} a.a.)` : ""}</td></tr>
              <tr><th>Plano</th><td colSpan={3}>{planoTexto(entrada, r.primeiraParcela)}</td></tr>
              <tr><th>Total a pagar</th><td>{brl(r.totalPago)}</td><th>Juros e correção</th><td>{brl(r.totalJuros)}</td></tr>
            </tbody>
          </table>
          {f.observacoes.trim() && <p className="obs">{f.observacoes.trim()}</p>}
          {!!r.linhas.length && (
            <table className="parcelas">
              <thead><tr><th>Nº</th><th>Vencimento</th><th>Valor</th><th>Juros</th><th>Amortização</th><th>Saldo</th></tr></thead>
              <tbody>
                {r.linhas.map((l) => (
                  <tr key={l.numero} className={l.tipo === "balao" ? "balao" : undefined}>
                    <td>{l.numero}{l.tipo === "balao" ? " (balão)" : ""}</td><td>{dataBR(l.data)}</td><td>{brl(l.valor)}</td>
                    <td>{brl(l.juros)}</td><td>{brl(l.amortizacao)}</td><td>{brl(l.saldoDevedor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="rodape">
            Simulação emitida em {dataBR(hoje)} pela plataforma Arini Imóveis Brasil. Valores estimados: a correção por índice
            usa a taxa informada e pode variar. Esta proposta só vale depois de aprovada pelo empreendedor e formalizada em contrato.
          </p>
          <div className="assin"><span>Proponente</span><span>Empreendedor</span></div>
        </div>
      </div>
    </section>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <label className="block"><span className={ROTULO}>{rotulo}</span>{children}</label>;
}

function Numero({ rotulo, valor, extra, alerta = false }: { rotulo: string; valor: string; extra?: string; alerta?: boolean }) {
  return (
    <div className="rounded-xl border border-linha bg-superficie-2 px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-texto-2">{rotulo}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${alerta ? "text-alerta" : "text-texto"}`}>{valor}</dd>
      {extra && <dd className="text-xs tabular-nums text-texto-2">{extra}</dd>}
    </div>
  );
}

/** Estilo da janela de impressão (fora do Tailwind: a janela não carrega o CSS do site). */
const CSS_PDF = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Quicksand", "Segoe UI", Arial, sans-serif; color: #10241B; font-size: 11pt; }
.doc { max-width: 190mm; margin: 0 auto; }
.cab { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #D9BD6F; padding-bottom: 10px; }
.marca { color: #1F4D3A; display: block; width: 150px; }
.marca svg { width: 150px; height: auto; display: block; }
.anunciante { text-align: right; }
.anunciante small { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: .12em; color: #5B6B62; }
.anunciante strong { font-size: 13pt; }
h1 { font-size: 18pt; margin: 18px 0 2px; color: #1F4D3A; }
.sub { margin: 0 0 14px; color: #5B6B62; }
table { width: 100%; border-collapse: collapse; }
.resumo th { text-align: left; font-weight: 600; color: #5B6B62; width: 18%; padding: 5px 6px; font-size: 9.5pt; }
.resumo td { padding: 5px 6px; font-variant-numeric: tabular-nums; }
.resumo tr { border-bottom: 1px solid #E3E6DF; }
.obs { margin: 12px 0; padding: 8px 10px; background: #F4F3EC; border-radius: 6px; }
.parcelas { margin-top: 16px; font-size: 9pt; font-variant-numeric: tabular-nums; }
.parcelas th { background: #1F4D3A; color: #F2F2EC; padding: 5px; text-align: right; }
.parcelas th:first-child, .parcelas th:nth-child(2), .parcelas td:first-child, .parcelas td:nth-child(2) { text-align: left; }
.parcelas td { padding: 3px 5px; border-bottom: 1px solid #E3E6DF; text-align: right; }
.parcelas tr.balao td { background: #FBF4DD; font-weight: 600; }
.parcelas thead { display: table-header-group; }
.parcelas tr { break-inside: avoid; }
.rodape { margin-top: 18px; font-size: 8.5pt; color: #5B6B62; }
.assin { display: flex; gap: 40px; margin-top: 46px; }
.assin span { flex: 1; border-top: 1px solid #10241B; padding-top: 4px; text-align: center; font-size: 9pt; }
`;
