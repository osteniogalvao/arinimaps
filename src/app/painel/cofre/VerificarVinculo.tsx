"use client";
import {useState,type FormEvent} from "react";
import {CAMPO,ROTULO} from "@/components/ui/Pagina";

export default function VerificarVinculo({id,codigo,atualizar}:{id:string;codigo:string;atualizar:()=>void}){
  const [erro,setErro]=useState("");const [ocupado,setOcupado]=useState(false);
  async function enviar(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(ocupado)return;setErro("");setOcupado(true);
    try {
      const f=new FormData(e.currentTarget);const arq=f.get("arquivo");
      if(!(arq instanceof File)||!arq.size||arq.size>10*1024*1024)throw Error("Escolha um PDF, PNG ou JPG de até 10 MB.");
      const q=new URLSearchParams({id,codigo:String(f.get("codigo")??"").trim(),vinculo:String(f.get("vinculo"))});
      const r=await fetch("/api/painel/cofre/vinculo?"+q,{method:"POST",headers:{"X-Nome-Arquivo":encodeURIComponent(arq.name)},body:arq});
      const j=await r.json();if(!r.ok)throw Error(j.error??"Falha ao protocolar.");atualizar();
    }catch(e){setErro(e instanceof Error?e.message:"Confira a conexão.");}finally{setOcupado(false);}
  }
  return <form onSubmit={enviar} className="space-y-3 border-t border-linha pt-3">
    <label className={ROTULO}>Seu vínculo com o imóvel<select name="vinculo" className={CAMPO}>
      {[["proprietario","Proprietário"],["coproprietario","Coproprietário"],["herdeiro","Herdeiro"],["procurador","Procurador"],["arrendatario","Arrendatário"],["representante","Representante legal"]]
        .map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
    <label className={ROTULO}>Código do anúncio ARINI (se houver)<input name="codigo" className={CAMPO} defaultValue={codigo} maxLength={50}/></label>
    <label className={ROTULO}>Comprovante do vínculo, incluindo procuração se aplicável<input name="arquivo" type="file" accept=".pdf,.png,.jpg,.jpeg" required className={CAMPO}/></label>
    <button className="btn-contorno p-2" disabled={ocupado}>Enviar para verificação</button>
    {erro&&<p role="alert">{erro}</p>}
  </form>;
}

