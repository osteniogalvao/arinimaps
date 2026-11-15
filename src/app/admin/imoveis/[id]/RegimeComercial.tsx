"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CAMPO,ROTULO } from "@/components/ui/Pagina";
import { REGIMES_IMOVEL, type RegimeImovel } from "@/lib/imovel/regime";
export default function RegimeComercial({id,atual,leilao}:{id:string;atual:RegimeImovel;leilao:boolean}) {
  const router=useRouter();const [regime,setRegime]=useState(atual);const [msg,setMsg]=useState("");const [busy,setBusy]=useState(false);
  async function salvar() {
    if(busy) return;setBusy(true);setMsg("");
    try {
      const r=await fetch("/api/admin/imoveis/regime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,atual,regime})});
      const j=await r.json();if(!r.ok) throw Error(j.error??"Falha ao salvar.");setMsg("Regime atualizado para novos interesses.");router.refresh();
    } catch(e){setMsg(e instanceof Error?e.message:"Confira a conexão.");} finally{setBusy(false);}
  }
  return <div className="space-y-3"><label className={ROTULO}>Quem recebe novos interesses?
    <select value={regime} onChange={e=>setRegime(e.target.value as RegimeImovel)} className={CAMPO}>
      {Object.entries(REGIMES_IMOVEL).filter(([k])=>k!=="LEILAO"||leilao).map(([k,v])=><option value={k} key={k}>{v}</option>)}
    </select></label><p className="text-sm text-texto-2">Na intermediação ARINI, a equipe conduz a venda. Nos demais regimes, o anunciante recebe o interesse e o fechamento não gera comissão para a ARINI.</p>
    <button className="btn-contorno p-2" disabled={busy||regime===atual} onClick={salvar}>Salvar regime</button>{msg && <p role="status">{msg}</p>}</div>;
}

