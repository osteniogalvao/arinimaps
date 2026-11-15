"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { formatBRL } from "@/lib/format";
import { termoCredito, type LinhaCredito, type Espelho, type VagaPublica } from "@/lib/financiamento";

export default function Simular({codigo,valor,linhas}:{codigo:string;valor:number;linhas:LinhaCredito[]}) {
  const [linhaId,setLinha] = useState(linhas[0].id);
  const [resultado,setResultado] = useState<{id:string;espelho:Espelho;vaga:VagaPublica|null}>();
  const [ocupado,setOcupado] = useState(false);
  const [erro,setErro] = useState("");
  const [enviado,setEnviado] = useState(false);
  const tentativa = useRef({chave:"",id:""});
  const linha = linhas.find(l=>l.id===linhaId)!;
  async function enviar(evento:FormEvent<HTMLFormElement>,repasse:boolean) {
    evento.preventDefault();
    if (ocupado) return;
    setOcupado(true); setErro("");
    const f=new FormData(evento.currentTarget);
    try {
      const dados = repasse ? {acao:"repassar",id:resultado?.id,vaga:resultado?.vaga?.id,aceite:f.get("aceite")==="on",
        renda:f.get("renda") ? Number(f.get("renda")) : null,nascimento:f.get("nascimento")||null} :
        {acao:"simular",codigo,linha:linhaId,entrada:Number(f.get("entrada")),prazo:Number(f.get("prazo")),sistema:f.get("sistema")};
      const chave=JSON.stringify(dados);
      if (!repasse && tentativa.current.chave!==chave) tentativa.current={chave,id:crypto.randomUUID()};
      const r=await fetch("/api/financiamento",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(repasse ? dados : {...dados,id:tentativa.current.id})});
      const j=await r.json();
      if(!r.ok) throw Error(j.error || "Falha ao processar a solicitação.");
      if(repasse) setEnviado(true); else { setResultado(j); setEnviado(false); }
    } catch (e) { setErro(e instanceof Error ? e.message : "Confira sua conexão."); }
    finally { setOcupado(false); }
  }
  return <div className="space-y-5">
    <form className="cartao space-y-4 p-6" onSubmit={e=>enviar(e,false)} onChange={()=>{setResultado(undefined);setEnviado(false);}}>
      <p>Valor anunciado <strong>{formatBRL(valor)}</strong></p>
      <label className={ROTULO}>Banco e linha<select className={CAMPO} value={linhaId} onChange={e=>setLinha(e.target.value)}>
        {linhas.map(l=><option key={l.id} value={l.id}>{l.banco} · {l.nome}</option>)}</select></label>
      <p className="text-sm">Taxa nominal de {linha.taxa_nominal_aa}% ao ano · CET aproximado de {linha.cet_aa}% ao ano · até {linha.percentual_max}% do valor.
        {" "}Seguro mensal {formatBRL(linha.seguro_mensal)} · tarifa inicial {formatBRL(linha.tarifa_inicial)}.
        {" "}Fonte: {linha.fonte}. Vigência {linha.inicio} a {linha.fim}.</p>
      <label className={ROTULO}>Entrada (R$)<input key={linha.id} type="number" name="entrada" className={CAMPO}
        defaultValue={Math.ceil(valor*(100-linha.percentual_max))/100} min={0} max={valor-0.01} step=".01" required/></label>
      <label className={ROTULO}>Prazo em meses<input key={linha.id} type="number" name="prazo" className={CAMPO}
        min="1" max={linha.prazo_max} defaultValue={linha.prazo_max} required/></label>
      <label className={ROTULO}>Amortização<select name="sistema" className={CAMPO}>{linha.sistemas.map(s=><option key={s}>{s}</option>)}</select></label>
      <button className="btn-primario p-3" disabled={ocupado}>Calcular parcelas</button>
    </form>
    {resultado && <section className="cartao space-y-4 p-6" aria-live="polite">
      <h2 className="lp-display text-2xl">Resultado da simulação</h2>
      <p>Primeira parcela com seguro <strong>{formatBRL(resultado.espelho.parcela_inicial)}</strong></p>
      <p>Total com entrada, seguro e tarifa <strong>{formatBRL(resultado.espelho.total)}</strong></p>
      {enviado ? <p>Repasse autorizado. <Link className="text-verde" href={`/painel/financiamento/${resultado.id}`}>Acompanhar atendimento</Link></p> :
        resultado.vaga ? <form className="space-y-4" onSubmit={e=>enviar(e,true)}>
          <h3 className="font-semibold">Solicitar atendimento</h3>
          <label className={ROTULO}>Renda mensal (opcional)<input type="number" name="renda" min=".01" step=".01" className={CAMPO}/></label>
          <label className={ROTULO}>Nascimento (opcional)<input type="date" name="nascimento" className={CAMPO}/></label>
          <label className="flex items-start gap-2 text-sm"><input name="aceite" type="checkbox" required/>{termoCredito(resultado.vaga)}</label>
          <button disabled={ocupado} className="btn-primario p-3">Autorizar e solicitar atendimento</button>
        </form> : <p>Em breve haverá atendimento para esta linha na região. <Link className="text-verde" href={"/contato-perfil?perfil=comprar&oferta="+encodeURIComponent(resultado.espelho.banco+" · Financiamento · "+codigo)}>Avise-me</Link></p>}
    </section>}
    {erro && <p role="alert" className="text-critico">{erro}</p>}
  </div>;
}

