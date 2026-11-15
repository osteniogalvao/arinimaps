"use client";
import { useState } from "react";
import Link from "next/link";
type Entrada = {id:string;nome:string;chamada:string;nicho:string};

export default function Escolha({atual,nicho,anteriores,entradas}:{atual:string|null;nicho:string|null;anteriores:string[];entradas:Entrada[]}) {
  const [selecionado,setSelecionado] = useState("");
  const [aceite,setAceite] = useState(false);
  const [erro,setErro] = useState("");
  const [enviando,setEnviando] = useState(false);
  const item=entradas.find(x=>x.id===selecionado);
  const termos=!!item && ["corretor","tecnico","leiloeiro"].includes(item.id) && item.nicho!==nicho && !anteriores.includes(item.nicho);
  async function abrir() {
    if (!item || enviando) return;
    setEnviando(true);setErro("");
    try {
      const r=await fetch("/api/conta/contexto",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entrada:item.id,aceite})});
      if (!r.ok) throw new Error((await r.json()).error);
      window.location.assign(item.id==="anunciar"?"/painel/novo":item.id==="comprar"?"/imoveis":["instituicao","empresa"].includes(item.id)?"/painel/territorio":"/planos?perfil="+item.id);
    } catch (e) {setErro(e instanceof Error?e.message:"Tente novamente.");setEnviando(false);}
  }
  return <><div className="grid gap-3 sm:grid-cols-2">
    {entradas.map(x=>["instituicao","empresa"].includes(x.id) && x.nicho!==nicho && !anteriores.includes(x.nicho)
      ? <Link key={x.id} href={"/planos?perfil="+x.id} className="rounded-xl border border-linha bg-superficie p-4"><b>{x.nome}</b><span className="block text-sm text-texto-2">Solicitar acesso institucional</span></Link>
      : <button type="button" key={x.id} aria-pressed={x.id===selecionado} onClick={()=>{setSelecionado(x.id);setErro("");setAceite(false);}}
        className={"rounded-xl border border-linha p-4 text-left "+(selecionado===x.id?"bg-[#124431] text-white":"bg-superficie")}>
        <strong>{x.nome}</strong>{(x.id===atual || !atual && x.nicho===nicho && x.id!=="anunciar") && <small> · Em uso</small>}
        <span className="mt-1 block text-sm">{x.chamada}</span>
      </button>)}</div>
    {termos && <label className="mt-5 flex items-center gap-2"><input type="checkbox" checked={aceite} onChange={e=>setAceite(e.target.checked)}/>Aceito os <Link href="/termos/parceiros" target="_blank" className="underline">termos de parceria</Link>.</label>}
    {erro && <p role="alert" className="my-3 text-critico">{erro}</p>}
    <button type="button" disabled={!item || enviando || termos&&!aceite} onClick={abrir} className="mt-5 rounded-full bg-verde px-6 py-3 font-bold text-white disabled:opacity-50">{enviando?"Abrindo…":"Usar perfil"}</button></>;
}
