"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { estadoLegivel, MOTIVOS_PERDA, termoCredito, type VagaPublica } from "@/lib/financiamento";

type Doc={id:string;titulo:string;estado:string;comentario:string|null;nome_arquivo:string|null};
type Props={id:string;proprio:boolean;estado:string|null;revogado:boolean;documentos:Doc[];modelos:string[];vaga:VagaPublica|null};
const proximos: Record<string,string[]> = {REPASSADO:["EM_ATENDIMENTO"],EM_ATENDIMENTO:["EM_ANALISE_BANCO"],
  DOCUMENTOS_RECEBIDOS:["EM_ANALISE_BANCO"],EM_ANALISE_BANCO:["APROVADO","REPROVADO"],APROVADO:["CONTRATADO"]};
const encerrados=["PERDIDO","REPROVADO","CONTRATADO"];

export default function Acoes({id,proprio,estado,revogado,documentos,modelos,vaga}:Props) {
  const [msg,setMsg]=useState(""); const [ocupado,setOcupado]=useState(false); const router=useRouter();
  async function executar(acao:string,extra:Record<string,unknown>={},arquivo?:File) {
    if(ocupado) return; setOcupado(true); setMsg("");
    try {
      const r=arquivo ? await fetch("/api/financiamento/documento?id="+extra.doc,{method:"POST",headers:{"X-Nome-Arquivo":encodeURIComponent(arquivo.name)},body:arquivo}) :
        await fetch("/api/financiamento",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,acao,...extra})});
      const j=await r.json();
      if(!r.ok) throw Error(j.error??"Falha ao registrar a operação.");
      setMsg("Registrado."); router.refresh();
    } catch(e) {setMsg(e instanceof Error ? e.message : "Confira sua conexão.");} finally{setOcupado(false);}
  }
  function enviarDoc(evento:FormEvent<HTMLFormElement>,doc:string) {
    evento.preventDefault(); const f=new FormData(evento.currentTarget).get("arquivo");
    if(f instanceof File && f.size && f.size<=10*1024*1024) void executar("upload",{doc},f);
    else setMsg("Selecione um PDF, JPG ou PNG de até 10 MB.");
  }
  const opera=!!estado && !revogado && !encerrados.includes(estado);
  return <div className="space-y-4">
    {vaga && <form className="cartao space-y-3 p-5" onSubmit={event=>{ event.preventDefault(); void executar("repassar",{vaga:vaga.id,aceite:true}); }}>
      <label className="flex gap-2"><input type="checkbox" required/>{termoCredito(vaga)}</label>
      <button disabled={ocupado} className="btn-primario p-3">Solicitar atendimento</button>
    </form>}
    {!!documentos.length && <section className="cartao space-y-4 p-5"><h2 className="lp-display text-xl">Documentos de financiamento</h2>
      {documentos.map(d=><div key={d.id} className="space-y-2 border-t border-linha pt-3">
        <p><strong>{d.titulo}</strong> · {estadoLegivel(d.estado)}</p>{d.comentario && <p>{d.comentario}</p>}
        {d.nome_arquivo && <a href={`/api/financiamento/documento?id=${d.id}`} className="text-verde" download>{d.nome_arquivo}</a>}
        {proprio && opera && ["PENDENTE","REFAZER"].includes(d.estado) && <form onSubmit={ev=>enviarDoc(ev,d.id)} className="flex flex-wrap gap-2">
          <input name="arquivo" type="file" required aria-label={"Arquivo para "+d.titulo} accept=".pdf,.png,.jpg,.jpeg"/>
          <button className="btn-contorno p-2" disabled={ocupado}>Enviar documento</button></form>}
        {!proprio && opera && d.estado==="ENVIADO" && <div className="space-y-2">
          <button className="btn-contorno p-2" disabled={ocupado} onClick={()=>executar("APROVAR_DOCUMENTO",{doc:d.id})}>Aprovar documento</button>
          <form onSubmit={ev=>{ev.preventDefault(); void executar("REFAZER_DOCUMENTO",{doc:d.id,nota:new FormData(ev.currentTarget).get("nota")});}}>
            <label className={ROTULO}>O que precisa ser corrigido?<input className={CAMPO} name="nota" required maxLength={400}/></label>
            <button className="btn-contorno p-2" disabled={ocupado}>Pedir correção</button>
          </form></div>}
      </div>)}
    </section>}
    {proprio && estado && !revogado && <button className="btn-contorno p-3" disabled={ocupado} onClick={()=>executar("REVOGAR")}>Revogar compartilhamento com a correspondente</button>}
    {!proprio && opera && estado && <section className="cartao space-y-4 p-5"><h2 className="lp-display text-xl">Atualizar atendimento</h2>
      <div className="flex flex-wrap gap-2">{(proximos[estado]??[]).map(p=><button key={p} disabled={ocupado} onClick={()=>executar(p)}
        className="btn-contorno p-2">{estadoLegivel(p)}</button>)}</div>
      {["EM_ATENDIMENTO","DOCUMENTOS_SOLICITADOS","DOCUMENTOS_RECEBIDOS"].includes(estado) && <form onSubmit={ev=>{
        ev.preventDefault(); void executar("SOLICITAR_DOCUMENTO",{nota:new FormData(ev.currentTarget).get("titulo")});}}>
        <label className={ROTULO}>Documento necessário<input className={CAMPO} name="titulo" list="modelos-documentos" minLength={2} maxLength={180} required/></label>
        <datalist id="modelos-documentos">{modelos.map(m=><option key={m}>{m}</option>)}</datalist>
        <button disabled={ocupado} className="btn-contorno mt-2 p-2">Solicitar documento</button></form>}
      <form onSubmit={ev=>{ev.preventDefault(); void executar("PERDIDO",{nota:new FormData(ev.currentTarget).get("nota")});}}>
        <label className={ROTULO}>Motivo do encerramento<select name="nota" className={CAMPO} required defaultValue=""><option value="">Selecione</option>{MOTIVOS_PERDA.map(m=><option key={m}>{m}</option>)}</select></label>
        <button className="btn-contorno mt-2 p-2" disabled={ocupado}>Encerrar como perdido</button>
      </form>
    </section>}
    {msg && <p role="status" className="text-sm">{msg}</p>}
  </div>;
}

