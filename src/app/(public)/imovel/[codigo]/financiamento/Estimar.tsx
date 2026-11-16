"use client";
import { useState, type FormEvent } from "react";
import { formatBRLFinanceiro } from "@/lib/format";
import { simular, somarMeses, type ResultadoSimulacao } from "@/lib/simulador";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";

export default function Estimar({valor,aceita}:{valor:number;aceita:boolean}) {
  const [resultado,setResultado] = useState<ResultadoSimulacao|null>(null);
  function calcular(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f=new FormData(e.currentTarget), preco=valor>0?valor:Number(f.get("preco"));
    const data=new Date().toISOString().slice(0,10);
    setResultado(simular({valorTabela:preco,valorProposto:preco,entrada:{tipo:"valor",valor:Number(f.get("entrada"))},
      parcelas:Number(f.get("prazo")),periodicidade:"mensal",sistema:f.get("sistema")==="sac"?"sac":"price",
      juros:{base:"aa",taxa:Number(f.get("taxa"))},dataBase:data,primeiraData:somarMeses(data,1)}));
  }
  return <form className="cartao space-y-4 p-6" onSubmit={calcular} onChange={()=>setResultado(null)}>
    <h2 className="lp-display text-xl">Planeje a compra</h2>
    <p>{aceita ? "Use uma taxa de sua escolha para estimar as parcelas." : "O anúncio não indica aceite de financiamento. Esta estimativa serve apenas para o seu planejamento."} O cálculo fica no seu navegador e não gera pedido de crédito.</p>
    {valor>0 ? <p>Valor anunciado: <strong>{formatBRLFinanceiro(valor)}</strong></p> : <label className={ROTULO}>Preço estimado do imóvel (R$)<input className={CAMPO} name="preco" required type="number" min="0.01" step=".01" /></label>}
    <label className={ROTULO}>Entrada (R$)<input className={CAMPO} name="entrada" type="number" defaultValue={0} min="0" step=".01" required /></label>
    <label className={ROTULO}>Prazo (meses)<input className={CAMPO} name="prazo" type="number" min="1" max="600" required /></label>
    <label className={ROTULO}>Taxa efetiva anual que deseja simular (%)<input className={CAMPO} name="taxa" type="number" min="0" max="100" step=".01" required /></label>
    <label className={ROTULO}>Sistema de amortização<select className={CAMPO} name="sistema"><option value="price">Price (parcelas constantes)</option><option value="sac">SAC (parcelas decrescentes)</option></select></label>
    <button className="btn-verde p-3" type="submit">Calcular estimativa</button>
    {resultado && <div role="status" className="space-y-1">{resultado.erros.length ? resultado.erros.join(" ") : <>
      <p>Primeira parcela: <strong>{formatBRLFinanceiro(resultado.primeiraParcela)}</strong></p><p>Última parcela: {formatBRLFinanceiro(resultado.ultimaParcela)}</p>
      <p>Total com entrada: {formatBRLFinanceiro(resultado.totalPago)}</p><p>Não inclui seguros, impostos ou tarifas bancárias.</p></>}</div>}
  </form>;
}
