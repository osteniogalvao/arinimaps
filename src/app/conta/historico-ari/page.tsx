"use client";
import Link from "next/link";
import { useState,useEffect } from "react";
type Linha={id:string;titulo?:string;papel?:string;conteudo?:string};
export default function Historico() {
  const [id,setId]=useState(""); const [pg,paginar]=useState(0); const [dados,carregar]=useState<Linha[]>([]);
  const [erro,avisar]=useState(""); const [chave,atualizar]=useState(0);
  useEffect(()=>{let valido=true;carregar([]);avisar("");
    fetch("/api/conta/historico-ari?pagina="+pg+(id?"&id="+id:"")).then(async r=>{
      if(!r.ok)throw Error(r.status===401?"Entre na conta para abrir seu histórico.":"Não foi possível abrir o histórico."); const j=await r.json();if(valido)carregar(j.conversas??j.mensagens);
    }).catch(e=>{if(valido)avisar(e.message);}); return ()=>{valido=false;};},[id,pg,chave]);
  const abrir=(s:string)=>{setId(s);paginar(0);};
  async function apagar() {
    if (!window.confirm("Apagar definitivamente o conteúdo desta conversa?"))return;
    const r=await fetch("/api/conta/historico-ari?id="+id,{method:"DELETE"});
    if(r.ok){abrir("");atualizar(k=>k+1);}else avisar("Não foi possível apagar a conversa.");
  }
  return <main className="mx-auto w-full max-w-2xl space-y-4 px-5 py-12"><Link href="/privacidade/preferencias" className="underline">Preferências de privacidade</Link>
    <h1 className="lp-display text-3xl">Meu histórico da Ari</h1>{id&&<div className="flex gap-5"><button className="underline" onClick={()=>abrir("")}>Voltar às conversas</button><button className="text-critico underline" onClick={apagar}>Apagar conversa</button></div>}
    {dados.map(l=><article className="rounded-lg border border-linha p-3" key={l.id}>{id?<><strong>{l.papel==="user"?"Você":"Ari"}</strong><p className="whitespace-pre-wrap">{l.conteudo}</p></>:<button className="w-full text-left text-verde" onClick={()=>abrir(l.id)}>{l.titulo}</button>}</article>)}
    {erro?<p role="alert">{erro}</p>:!dados.length&&<p>Nenhum registro nesta página.</p>}
    <nav className="flex gap-4"><button disabled={!pg} className="disabled:opacity-40" onClick={()=>paginar(pg-1)}>Anterior</button><button disabled={dados.length<(id?50:20)} className="disabled:opacity-40" onClick={()=>paginar(pg+1)}>Próxima</button></nav></main>;
}
