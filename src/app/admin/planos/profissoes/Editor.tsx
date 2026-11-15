"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {publicarModelo,responderProfissao} from "./acoes";
import {botaoTecnico as botao,inputTecnico as campo,estadosProfissao,type ModeloTecnico,type CampoTecnico,type PedidoTecnico} from "@/lib/modelos-tecnicos";
function Formulario({modelo:m}:{modelo?:ModeloTecnico}){
 const router=useRouter(),[campos,lista]=useState<CampoTecnico[]>(m?.campos??[{id:"campo_1",nome:"",tipo:"texto",obrigatorio:true}]);
 const [msg,set]=useState(""),[ocupado,ocupar]=useState(false);
 const alterar=(i:number,t:Partial<CampoTecnico>)=>lista(campos.map((c,n)=>n===i?{...c,...t}:c));
 async function salvar(e:FormEvent<HTMLFormElement>){e.preventDefault();ocupar(true);const f=new FormData(e.currentTarget),v=(k:string)=>String(f.get(k)??"");
  try{const r=await publicarModelo({id:m?.id??crypto.randomUUID(),versao:m?.versao??0,nome:v("nome"),profissao:v("profissao"),campos,premium:f.has("premium"),ativo:f.has("ativo"),documentos:[...new Set(v("documentos").split("\n").map(d=>d.trim()).filter(Boolean))]});
   set(r.erro??"Modelo publicado.");if(!r.erro)router.refresh();}catch{set("Falha de conexão.");}finally{ocupar(false);}}
 return <form className="space-y-4" onSubmit={salvar}><div className="grid gap-3 sm:grid-cols-2">
 <label>Profissão<input name="profissao" className={campo} defaultValue={m?.profissao} minLength={3} maxLength={100} required/></label>
 <label>Nome do módulo<input name="nome" className={campo} defaultValue={m?.nome} minLength={3} maxLength={120} required/></label></div>
 <fieldset className="space-y-2"><legend className="font-semibold">Campos do registro e do documento</legend>
 {campos.map((c,i)=><div key={c.id} className="flex flex-wrap items-end gap-3"><label>Nome do campo<input className={campo} value={c.nome} minLength={2} maxLength={100} required onChange={e=>alterar(i,{nome:e.target.value})}/></label>
 <label>Tipo<select className={campo} value={c.tipo} onChange={e=>alterar(i,{tipo:e.target.value as CampoTecnico["tipo"]})}><option value="texto">Texto</option><option value="numero">Número</option><option value="data">Data</option></select></label>
 <label><input type="checkbox" checked={c.obrigatorio} onChange={e=>alterar(i,{obrigatorio:e.target.checked})}/> Obrigatório</label>
 <button type="button" className="underline" disabled={campos.length===1} onClick={()=>lista(campos.filter((_,n)=>n!==i))}>Remover campo</button></div>)}
 <button type="button" className={botao} disabled={campos.length>=24} onClick={()=>lista([...campos,{id:"campo_"+crypto.randomUUID().replaceAll("-","").slice(0,15),nome:"",tipo:"texto",obrigatorio:false}])}>Adicionar campo</button></fieldset>
 <label className="block">Modelos de documento (um nome por linha)<textarea className={campo} name="documentos" rows={4} defaultValue={m?.documentos.join("\n")}/></label>
 <div className="flex gap-4"><label><input type="checkbox" name="premium" defaultChecked={m?.premium}/> Exigir plano Premium</label>
 <label><input type="checkbox" name="ativo" defaultChecked={m?.ativo??true}/> Disponível para novos registros</label></div>
 <button className={botao} disabled={ocupado}>Salvar modelo</button>{msg&&<p role="status">{msg}</p>}</form>;
}
export function Editor({modelos}:{modelos:ModeloTecnico[]}){
 const [id,mudar]=useState("");const m=modelos.find(m=>m.id===id);
 return <section className="cartao space-y-4 p-5"><h2 className="text-xl font-semibold">Configurar profissão e módulo</h2>
 <label className="block">Escolher modelo existente ou criar<select className={campo} value={id} onChange={e=>mudar(e.target.value)}><option value="">Criar módulo</option>
 {modelos.map(m=><option key={m.id} value={m.id}>{m.profissao} · {m.nome}{m.ativo?"":" (inativo)"}</option>)}</select></label>
 <Formulario key={id+":"+(m?.versao??0)} modelo={m}/></section>;
}
export function Resposta({p,profissoes}:{p:PedidoTecnico;profissoes:string[]}){
 const router=useRouter();const [estado,mudar]=useState("em_analise"),[aviso,set]=useState(""),[ocupado,ocupar]=useState(false);
 async function salvar(e:FormEvent<HTMLFormElement>){e.preventDefault();ocupar(true);const v=new FormData(e.currentTarget);
 try{const r=await responderProfissao(p.id,p.versao,estado,String(v.get("resposta")),estado==="liberado"?String(v.get("modelo")):null);set(r.erro??"Resposta registrada.");if(!r.erro)router.refresh();}
 catch{set("Falha de conexão.");}finally{ocupar(false);}}
 return <form className="space-y-2" onSubmit={salvar}><label className="block">Situação<select className={campo} value={estado} onChange={e=>mudar(e.target.value)}>{["em_analise","liberado","devolvido"].map(k=><option key={k} value={k}>{estadosProfissao[k]}</option>)}</select></label>
 {estado==="liberado"&&<label className="block">Profissão publicada<select className={campo} required name="modelo"><option value="">Escolher</option>{profissoes.map(v=><option key={v}>{v}</option>)}</select></label>}
 <label className="block">Resposta ao titular<textarea className={campo} required name="resposta" minLength={4} maxLength={1000}/></label>
 <button disabled={ocupado} className={botao}>Registrar resposta</button>{aviso&&<p role="status">{aviso}</p>}</form>;
}