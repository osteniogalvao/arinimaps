"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import { pacotesLeilao, type Credencial } from "@/lib/leiloes";

export default function Credenciar({id,nome,empresa,matricula,credencial:c}:{id:string;nome:string;empresa:string;matricula:string;credencial?:Credencial}){
  const [erro,setErro]=useState("");const [ocupado,setOcupado]=useState(false);const router=useRouter();
  return <form className="cartao grid gap-3 p-5" onSubmit={async ev=>{
    ev.preventDefault();const form=new FormData(ev.currentTarget);const ativo=(ev.nativeEvent as SubmitEvent).submitter?.getAttribute("value")!=="suspender";
    setErro("");setOcupado(true);
    const r=await enviarJson("/api/leiloes","POST",{acao:"credenciar",parceiro:id,ativo,revisao:c?.revisao??0,...Object.fromEntries(form),
      validade:form.get("dia")?String(form.get("dia"))+"T23:59:59-03:00":null});setOcupado(false);
    if(r.ok)router.refresh();else setErro(r.erro.mensagem);
  }}>
    <h2 className="font-semibold">{nome}</h2>
    {c&&<p>{pacotesLeilao[c.plano]} · {c.ativo?"vigência até "+new Date(c.validade).toLocaleDateString("pt-BR"):"suspenso"}</p>}
    <label>Matrícula profissional conferida<input className="input block" required name="matricula" defaultValue={c?.matricula??matricula}/></label>
    <label>Empresa conferida<input className="input block" required name="empresa" defaultValue={c?.empresa??empresa}/></label>
    <label>Referência da verificação e da contratação<input className="input block" required name="referencia" defaultValue={c?.referencia}/></label>
    <label>Pacote<select className="input block" name="plano" defaultValue={c?.plano}>{Object.entries(pacotesLeilao).map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></label>
    <label>Vencimento do pacote pago<input className="input block" type="date" name="dia" defaultValue={c?.validade.slice(0,10)}/></label>
    <div className="flex gap-2"><button className="btn btn-primario" disabled={ocupado}>Conceder pacote</button>
    {c?.ativo&&<button className="btn-contorno" value="suspender" formNoValidate disabled={ocupado}>Suspender acesso</button>}</div>
    {erro&&<p role="alert">{erro}</p>}
  </form>;
}
