"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function useOperacao() {
  const [mensagem,setMensagem]=useState("");
  const [ocupado,setOcupado]=useState(false);
  const bloqueio=useRef(false);
  const tentativa=useRef({ dados:"",id:"" });
  const router=useRouter();
  async function enviar(campos:Record<string,unknown>, sucesso:string) {
    if (bloqueio.current) return false;
    bloqueio.current=true;setOcupado(true);setMensagem("");
    const dados=JSON.stringify(campos);
    if (tentativa.current.dados!==dados) tentativa.current={dados,id:crypto.randomUUID()};
    try {
      const r=await fetch("/api/territorio",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...campos,id:campos.id??tentativa.current.id,chave:tentativa.current.id})});
      const j=await r.json();
      if (!r.ok) throw new Error(j.error || "Não foi possível salvar.");
      setMensagem(campos.acao==="protocolar" ? "Pedido recebido. Protocolo nº "+j.resultado+"." : sucesso);
      tentativa.current={dados:"",id:""};router.refresh();return true;
    } catch(e) {setMensagem(e instanceof Error ? e.message : "Falha de conexão.");return false;}
    finally {bloqueio.current=false;setOcupado(false);}
  }
  return {enviar,ocupado,mensagem};
}
