"use client";

import { useState } from "react";
import { CAMPO } from "@/components/ui/Pagina";

/**
 * Ferramentas do painel do anunciante (modelos do Carlos, 25/11/2026).
 * Rural: conversor de área, lotação do pasto e arroba do boi.
 * Urbano: quanto sobra na venda, IPTU, quanto paga o comprador, medidas do lote
 * e o que dá para construir. Tudo é conta simples no navegador, sem valor de laudo.
 */
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = (v: number, casas = 2) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas });
const ler = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;

function Campo({ rotulo, valor, onChange, sufixo }: { rotulo: string; valor: string; onChange: (v: string) => void; sufixo?: string }) {
  return <label className="block text-xs font-semibold uppercase tracking-wide text-texto-2">{rotulo}{sufixo && <span className="normal-case"> ({sufixo})</span>}
    <input inputMode="decimal" className={CAMPO + " mt-1 !py-2 text-base"} value={valor} onChange={(e) => onChange(e.target.value)} />
  </label>;
}

function Cartao({ titulo, texto, children, resultado }: { titulo: string; texto: string; children: React.ReactNode; resultado: React.ReactNode }) {
  return <section className="cartao flex flex-col gap-3 p-5">
    <div><h3 className="font-bold text-texto">{titulo}</h3><p className="text-sm text-texto-2">{texto}</p></div>
    <div className="grid gap-3">{children}</div>
    <div className="mt-auto rounded-xl bg-verde/8 px-4 py-3 text-sm text-texto" aria-live="polite">{resultado}</div>
  </section>;
}

// Hectares por unidade. O alqueire varia por região.
const UNIDADES: [string, number][] = [
  ["Alqueire mineiro / goiano", 4.84], ["Alqueire paulista", 2.42], ["Alqueire baiano", 9.68], ["Hectare", 1], ["Metro quadrado", 0.0001],
];

function Rural() {
  const [qtd, setQtd] = useState("24,7");
  const [un, setUn] = useState(0);
  const ha = ler(qtd) * UNIDADES[un][1];
  const [pasto, setPasto] = useState("100");
  const [lot, setLot] = useState("1");
  const [peso, setPeso] = useState("450");
  const ua = ler(pasto) * ler(lot);
  const animais = ler(peso) > 0 ? (ua * 450) / ler(peso) : 0;
  const [vivo, setVivo] = useState("520");
  const [rend, setRend] = useState("54");
  const [arroba, setArroba] = useState("");
  const arrobas = (ler(vivo) * ler(rend)) / 100 / 15;
  return <>
    <Cartao titulo="Conversor de área" texto="Alqueire, hectare e metro quadrado." resultado={<ul className="space-y-0.5">
      <li><strong>{num(ha)} hectares</strong></li>
      {UNIDADES.filter((_, i) => i !== 3 && i !== un).map(([n, f]) => <li key={n}>{num(ha / f)} {n.toLowerCase()}</li>)}
    </ul>}>
      <Campo rotulo="Quantidade" valor={qtd} onChange={setQtd} />
      <label className="block text-xs font-semibold uppercase tracking-wide text-texto-2">Unidade
        <select className={CAMPO + " mt-1 !py-2 text-base"} value={un} onChange={(e) => setUn(Number(e.target.value))}>
          {UNIDADES.map(([n], i) => <option key={n} value={i}>{n}</option>)}
        </select></label>
    </Cartao>
    <Cartao titulo="Lotação do pasto" texto="Quantos animais a área comporta." resultado={<>
      <strong>{num(ua, 0)} UA</strong> (1 UA = 450 kg). Cerca de {num(animais, 0)} animais de {num(ler(peso), 0)} kg.</>}>
      <Campo rotulo="Área de pasto" sufixo="ha" valor={pasto} onChange={setPasto} />
      <Campo rotulo="Lotação" sufixo="UA por ha" valor={lot} onChange={setLot} />
      <Campo rotulo="Peso médio do animal" sufixo="kg" valor={peso} onChange={setPeso} />
    </Cartao>
    <Cartao titulo="Arroba do boi" texto="Quanto rende um animal no abate." resultado={<>
      <strong>{num(arrobas, 1)} arrobas</strong> de carcaça (1 @ = 15 kg).{" "}
      {ler(arroba) > 0 ? <>Valor estimado: <strong>{reais(arrobas * ler(arroba))}</strong>.</> : "Informe o preço da arroba para ver o valor."}</>}>
      <Campo rotulo="Peso vivo" sufixo="kg" valor={vivo} onChange={setVivo} />
      <Campo rotulo="Rendimento de carcaça" sufixo="%" valor={rend} onChange={setRend} />
      <Campo rotulo="Preço da arroba" sufixo="R$, opcional" valor={arroba} onChange={setArroba} />
    </Cartao>
  </>;
}

function Urbano({ valorPedido }: { valorPedido: number | null }) {
  const inicial = valorPedido ? String(Math.round(valorPedido)) : "";
  const [venda, setVenda] = useState(inicial);
  const [comissao, setComissao] = useState("1,9");
  const [saldo, setSaldo] = useState("0");
  const [outros, setOutros] = useState("0");
  const liquido = ler(venda) - (ler(venda) * ler(comissao)) / 100 - ler(saldo) - ler(outros);
  const [venal, setVenal] = useState("");
  const [aliq, setAliq] = useState("1");
  const [itbi, setItbi] = useState("2");
  const [cartorio, setCartorio] = useState("1,5");
  const comprador = (ler(venda) * (ler(itbi) + ler(cartorio))) / 100;
  const [frente, setFrente] = useState("12");
  const [fundo, setFundo] = useState("30");
  const area = ler(frente) * ler(fundo);
  const [to, setTo] = useState("70");
  const [ca, setCa] = useState("1,4");
  return <>
    <Cartao titulo="Quanto sobra na venda" texto="O líquido depois da comissão, do saldo de financiamento e de outros custos." resultado={<>
      Sobra cerca de <strong>{reais(Math.max(0, liquido))}</strong>.</>}>
      <Campo rotulo="Valor de venda" sufixo="R$" valor={venda} onChange={setVenda} />
      <Campo rotulo="Comissão" sufixo="%" valor={comissao} onChange={setComissao} />
      <Campo rotulo="Saldo de financiamento" sufixo="R$" valor={saldo} onChange={setSaldo} />
      <Campo rotulo="Outros custos (certidões, reformas)" sufixo="R$" valor={outros} onChange={setOutros} />
    </Cartao>
    <Cartao titulo="Quanto custa o IPTU" texto="Valor venal vezes a alíquota da sua cidade." resultado={ler(venal) > 0 ? <>
      Cerca de <strong>{reais((ler(venal) * ler(aliq)) / 100)}</strong> por ano, ou {reais((ler(venal) * ler(aliq)) / 1200)} por mês.</> : "Informe o valor venal do carnê."}>
      <Campo rotulo="Valor venal" sufixo="R$" valor={venal} onChange={setVenal} />
      <Campo rotulo="Alíquota" sufixo="% ao ano" valor={aliq} onChange={setAliq} />
    </Cartao>
    <Cartao titulo="Quanto paga o comprador" texto="ITBI da prefeitura e escritura e registro em cartório." resultado={<>
      Além do preço, cerca de <strong>{reais(comprador)}</strong>, total de {reais(ler(venda) + comprador)}.</>}>
      <Campo rotulo="ITBI" sufixo="%" valor={itbi} onChange={setItbi} />
      <Campo rotulo="Escritura e registro" sufixo="% estimado" valor={cartorio} onChange={setCartorio} />
    </Cartao>
    <Cartao titulo="Medidas do lote" texto="Frente vezes fundo dá a área e o preço por m²." resultado={<>
      <strong>{num(area)} m²</strong>{ler(venda) > 0 && area > 0 && <>, {reais(ler(venda) / area)} por m²</>}.</>}>
      <Campo rotulo="Frente" sufixo="m" valor={frente} onChange={setFrente} />
      <Campo rotulo="Fundo" sufixo="m" valor={fundo} onChange={setFundo} />
    </Cartao>
    <Cartao titulo="O que dá para construir" texto="Taxa de ocupação e coeficiente de aproveitamento do plano diretor." resultado={<>
      Ocupação no chão até <strong>{num((area * ler(to)) / 100)} m²</strong>; área construída total até <strong>{num(area * ler(ca))} m²</strong>.</>}>
      <Campo rotulo="Taxa de ocupação" sufixo="%" valor={to} onChange={setTo} />
      <Campo rotulo="Coeficiente de aproveitamento" valor={ca} onChange={setCa} />
    </Cartao>
  </>;
}

export default function FerramentasImovel({ tipo, valorPedido }: { tipo: "rural" | "urbano"; valorPedido: number | null }) {
  return <div className="space-y-3">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tipo === "rural" ? <Rural /> : <Urbano valorPedido={valorPedido} />}</div>
    <p className="text-xs text-texto-2">Contas de apoio. Alíquotas, taxas e regras variam por cidade; confira com a prefeitura e o cartório. Não é laudo nem avaliação oficial.</p>
  </div>;
}
