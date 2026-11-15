"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {CAMPO,ROTULO} from "@/components/ui/Pagina";
export default function Decidir({id,revisao}:{id:string;revisao:number}){
 const [msg,setMsg]=useState(""),[ocupado,setOcupado]=useState(false);const router=useRouter();
 async function salvar(e:FormEvent<HTMLFormElement>){
   e.preventDefault();if(ocupado)return;setOcupado(true);setMsg("");
   try{const b=Object.fromEntries(new FormData(e.currentTarget));const r=await fetch("/api/admin/cadastros/verificacoes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,revisao,...b})});
     const j=await r.json();if(!r.ok)throw Error(j.error??"Falha ao registrar.");setMsg("Decisão registrada.");router.refresh();}
   catch(e){setMsg(e instanceof Error?e.message:"Confira a conexão.");}finally{setOcupado(false);}
 }
 return <form onSubmit={salvar} className="mt-3 space-y-2"><label className={ROTULO}>Decisão<select name="estado" className={CAMPO} defaultValue="" required>
   <option value="">Selecione</option><option value="APROVADA">Aprovar vínculo</option><option value="PENDENCIA">Pedir complemento</option><option value="REPROVADA">Reprovar vínculo</option></select></label>
   <label className={ROTULO}>Motivo comunicado ao solicitante<textarea name="motivo" required minLength={3} maxLength={600} className={CAMPO}/></label>
   <button className="btn-contorno p-2" disabled={ocupado}>Registrar decisão</button>{msg&&<p role="status">{msg}</p>}</form>;
}

