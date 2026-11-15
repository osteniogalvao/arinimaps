"use client";
import { useState, type FormEvent } from "react";
import { CAMPO } from "@/components/ui/Pagina";
import type { PainelSafras } from "@/lib/territorio-contratado";
import { useOperacao } from "./useOperacao";

const moeda=(n:number)=>n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const quantia=(n:number)=>n.toLocaleString("pt-BR",{maximumFractionDigits:4});
export default function Safras({painel}:{painel:PainelSafras}) {
  const {enviar,mensagem,ocupado}=useOperacao();
  const [tipo,setTipo]=useState("fornecedor");
  const [correcao,setCorrecao]=useState("");
  const atual=painel.safras.find(s=>s.id===correcao);
  const areaDe=(id:string)=>painel.areas.find(a=>a.id===id)?.nome??"";
  const talhaoDe=(id:string)=>painel.talhoes.find(t=>t.id===id);
  async function salvar(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const form=e.currentTarget;
    const campos=Object.fromEntries(new FormData(form)) as Record<string,string|number|FormDataEntryValue>;
    if (atual && tipo==="safra") campos.revisao=atual.revisao;
    if (await enviar({acao:"lancamento",tipo,id:tipo==="safra"?atual?.id:undefined,campos},"Registro salvo.")) {setCorrecao("");form.reset();}
  }
  const numerico=(name:string,label:string,step:string,valor?:number)=><label className="block">{label}<input name={name} type="number" step={step}
    min={name==="hectares"?0.0001:0} defaultValue={valor} required className={CAMPO}/></label>;
  return <div className="space-y-6"><p role="status" className="text-verde">{mensagem}</p>
    <section className="cartao space-y-4 p-5"><h2 className="text-xl font-semibold">Lançamentos</h2>
      <div className="flex flex-wrap gap-2">{[["fornecedor","Fornecedor"],["area","Área"],["talhao","Talhão"],["safra","Safra"]].map(([id,n])=>
        <button type="button" key={id} aria-pressed={tipo===id} className={"rounded-full border border-linha px-4 py-2 "+(tipo===id?"bg-verde text-fundo":"")}
          onClick={()=>{setTipo(id);setCorrecao("");}}>{n}</button>)}</div>
      <form key={tipo+correcao} onSubmit={salvar} className="space-y-3">
        {tipo!=="safra" && <label className="block">Nome<input name="nome" required minLength={tipo==="talhao"?1:2} maxLength={140} className={CAMPO}/></label>}
        {tipo==="area" && <label className="block">Fornecedor<select name="fornecedor" required className={CAMPO}><option value="">Selecione o fornecedor</option>
          {painel.fornecedores.map(f=><option value={f.id} key={f.id}>{f.nome}</option>)}</select></label>}
        {tipo==="talhao" && <label className="block">Área de origem<select name="area" required className={CAMPO}><option value="">Selecione a área</option>
          {painel.areas.map(a=><option value={a.id} key={a.id}>{a.nome} · {quantia(a.hectares)} ha</option>)}</select></label>}
        {(tipo==="area" || tipo==="talhao") && numerico("hectares","Área (ha)","0.0001")}
        {tipo==="safra" && <>
          <label className="block">Talhão<select name="talhao" defaultValue={atual?.talhao??""} required disabled={!!atual} className={CAMPO}><option value="">Selecione o talhão</option>
            {painel.talhoes.map(t=><option value={t.id} key={t.id}>{areaDe(t.area)} · {t.nome}</option>)}</select></label>
          <label className="block">Ano de início da safra<input name="ano" type="number" min={1900} max={2200} defaultValue={atual?.ano??new Date().getFullYear()} required readOnly={!!atual} className={CAMPO}/></label>
          <label className="block">Cultura<input name="cultura" maxLength={100} minLength={2} required readOnly={!!atual} defaultValue={atual?.cultura} className={CAMPO}/></label>
          {numerico("toneladas","Produção colhida (t)","0.001",atual?.toneladas)}
          {numerico("custo","Custos totais (R$)","0.01",atual?.custo)}{numerico("receita","Receita total (R$)","0.01",atual?.receita)}
        </>}
        <button className="btn-verde px-4 py-2" disabled={ocupado || (tipo==="area" && !painel.fornecedores.length)
          || (tipo==="talhao" && !painel.areas.length) || (tipo==="safra" && !painel.talhoes.length)}>{atual?"Salvar correção":"Adicionar"}</button>
      </form></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Fornecedores e áreas</h2>
      {!painel.fornecedores.length && <p>Cadastre o fornecedor para incluir a primeira área.</p>}
      {painel.fornecedores.map(f=><div className="cartao p-4" key={f.id}><h3 className="font-semibold">{f.nome}</h3>
        {painel.areas.filter(a=>a.fornecedor===f.id).map(a=><div className="mt-3 border-t border-linha pt-2" key={a.id}>
          <p><strong>{a.nome}</strong> · {quantia(a.hectares)} ha</p>
          <p>{a.resultado===null?"Resultado disponível a partir de duas safras informadas.":"Resultado acumulado em "+a.safras+" safras: "+moeda(a.resultado)}</p>
          <ul>{painel.talhoes.filter(t=>t.area===a.id).map(t=><li key={t.id}>{t.nome} · {quantia(t.hectares)} ha</li>)}</ul>
        </div>)}</div>)}
    </section>
    <section className="space-y-2"><h2 className="text-xl font-semibold">Safras informadas</h2>
      {!painel.safras.length && <p>Nenhuma safra lançada.</p>}
      {painel.safras.map(s=><div className="cartao space-y-1 p-4" key={s.id}><strong>{s.ano}/{s.ano+1} · {s.cultura} · {talhaoDe(s.talhao)?.nome}</strong>
        <p>{quantia(s.toneladas)} t · {quantia(s.produtividade)} t/ha · Custo {moeda(s.custo)} · Receita {moeda(s.receita)}</p>
        <button className="underline" type="button" onClick={()=>{setTipo("safra");setCorrecao(s.id);window.scrollTo({top:0});}}>Corrigir lançamento</button>
      </div>)}</section></div>;
}