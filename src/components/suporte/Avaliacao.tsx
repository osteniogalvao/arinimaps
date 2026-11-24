"use client";
import {useState} from "react";
import {CAMPO} from "@/components/ui/Pagina";
export type AvaliacaoSuporte={nota:number;comentario:string;created_at:string};
export default function Avaliacao({id,valor}:{id:string;valor:AvaliacaoSuporte|null}){
 const [salva,setSalva]=useState<AvaliacaoSuporte|null>(null),[nota,setNota]=useState(""),[comentario,setComentario]=useState(""),[ocupado,setOcupado]=useState(false),[erro,setErro]=useState("");
 const avaliacao=salva??valor;
 if(avaliacao)return <section className="rounded-xl border border-verde/30 bg-verde/5 p-4" aria-label="Avaliação do atendimento"><p className="font-semibold">Obrigado pela avaliação: {avaliacao.nota} de 5.</p>{avaliacao.comentario&&<p className="mt-2 whitespace-pre-wrap">{avaliacao.comentario}</p>}</section>;
 async function enviar(){
  if(ocupado)return;setOcupado(true);setErro("");
  try{
   const r=await fetch(`/api/suporte/${id}/avaliacao`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nota:Number(nota),comentario})});
   const d=await r.json();if(!r.ok){setErro(d.error??"Não foi possível avaliar.");return;}setSalva(d.avaliacao);
  }catch{setErro("Falha de conexão. Tente novamente.");}finally{setOcupado(false);}
 }
 return <form className="space-y-3 rounded-xl border border-verde/30 bg-verde/5 p-4" onSubmit={e=>{e.preventDefault();void enviar();}} aria-label="Avaliar atendimento">
  <h3 className="font-semibold">Seu chamado foi resolvido. Como foi o atendimento?</h3>
  <p className="text-sm">A avaliação é opcional. Escolha de 1 (muito insatisfeito) a 5 (muito satisfeito). Após enviar, ela fica registrada neste chamado.</p>
  <label className="block">Nota<select required className={CAMPO} value={nota} onChange={e=>setNota(e.target.value)} disabled={ocupado}><option value="">Selecione</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} de 5</option>)}</select></label>
  <label className="block">Comentário (opcional)<textarea rows={3} maxLength={1000} className={CAMPO} value={comentario} onChange={e=>setComentario(e.target.value)} disabled={ocupado}/></label>
  {erro&&<p role="alert" className="text-sm text-critico">{erro}</p>}
  <button className="lp-btn lp-btn-contorno" disabled={ocupado}>{ocupado?"Enviando…":"Enviar avaliação"}</button>
 </form>;
}
