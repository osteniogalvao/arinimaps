"use client";
import { useState } from "react";
import { CAMPO } from "@/components/ui/Pagina";
const ler = (v: string) => v.trim() ? Number(v.replace(",", ".")) : NaN;
const medida = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const reais = (n: number) => n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });

export default function Calculadora() {
  const [area, setArea] = useState("");
  const [unidadeArea, setUnidadeArea] = useState("ha");
  const [fator, setFator] = useState("");
  const [dose, setDose] = useState("");
  const [unidade, setUnidade] = useState("kg");
  const [preco, setPreco] = useState("");
  const ha = ler(area) * (unidadeArea === "ha" ? 1 : ler(fator));
  const quantidade = ha * ler(dose);
  const custo = quantidade * ler(preco);
  const valido = ha > 0 && ler(dose) > 0 && ler(area) > 0 && Number.isFinite(quantidade);
  const validoCusto = ler(preco) >= 0 && Number.isFinite(custo);
  return <section className="cartao max-w-3xl space-y-5 p-6"><div className="grid gap-4 sm:grid-cols-2">
    <label>Área<input className={CAMPO} inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></label>
    <label>Unidade da área<select className={CAMPO} value={unidadeArea} onChange={(e) => setUnidadeArea(e.target.value)}><option value="ha">Hectare</option><option value="alq">Alqueire</option></select></label>
    {unidadeArea === "alq" && <label>Hectares por alqueire na sua região<input className={CAMPO} inputMode="decimal" value={fator} onChange={(e) => setFator(e.target.value)} /></label>}
    <label>Unidade do insumo<select className={CAMPO} value={unidade} onChange={(e) => setUnidade(e.target.value)}>{["kg","L","t","unidades"].map((u) => <option key={u}>{u}</option>)}</select></label>
    <label>Dose em {unidade}/ha<input className={CAMPO} inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} /></label>
    <label>Preço em R$ por {unidade} (opcional)<input className={CAMPO} inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></label>
  </div><div aria-live="polite" className="border-t border-linha pt-4">
    {valido ? <><p>Área de {medida(ha)} ha</p><p className="text-lg font-semibold">Quantidade de insumo · {medida(quantidade)} {unidade}</p>
      {validoCusto && <p>Custo total de {reais(custo)} · {reais(ler(dose) * ler(preco))}/ha</p>}</> : <p>Informe valores positivos para área, dose e conversão utilizada.</p>}
  </div></section>;
}
