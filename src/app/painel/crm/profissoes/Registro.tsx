"use client";
import {useRef,useState,type FormEvent} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {botaoTecnico as botao,inputTecnico as campo,etapasTecnicas,type ModeloTecnico,type RegistroTecnico} from "@/lib/modelos-tecnicos";
import {gravarRegistro,pedirProfissao} from "./acoes";

export default function Registro({modelos,registro:r,atendimento=null,profissaoInicial}:{modelos:ModeloTecnico[];registro?:RegistroTecnico;atendimento?:string|null;profissaoInicial?:string}) {
 const router=useRouter(); const fixo=r?.modelo;
 const [profissao,selecao]=useState(fixo?.profissao??profissaoInicial??modelos[0]?.profissao??"");
 const atuais=modelos.filter(m=>m.profissao===profissao);
 const [id,selecionar]=useState(r?.modulo??atuais[0]?.id??"");
 const m=fixo??atuais.find(x=>x.id===id);
 const [salvando,setSalvando]=useState(false),[aviso,setAviso]=useState("");
 const chave=useRef<string|null>(null);
 async function salvar(e:FormEvent<HTMLFormElement>) {
   e.preventDefault();if(!m)return;setSalvando(true);setAviso("");
   const form=new FormData(e.currentTarget),v=(k:string)=>String(form.get(k)??"");
   chave.current??=r?.id??crypto.randomUUID();
   try {const resultado=await gravarRegistro({id:chave.current,modulo:r?.modulo??id,revisao:m.versao,versao:r?.versao??0,titulo:v("titulo"),etapa:v("etapa"),
      documento:v("documento")||null,atendimento:r?.atendimento??atendimento,campos:Object.fromEntries(m.campos.map(c=>[c.id,v(c.id)]))});
    if(resultado.erro)setAviso(resultado.erro);else {setAviso("Registro salvo.");router.push("/painel/crm/profissoes?id="+resultado.id);router.refresh();}
   }catch{setAviso("A conexão foi interrompida. Você pode reenviar o registro.");}finally{setSalvando(false);}
 }
 return <form onSubmit={salvar} className="cartao max-w-3xl space-y-4 p-5">
  <h2 className="text-xl font-semibold">{r?"Editar registro":"Novo registro técnico"}</h2>
  {!r&&<div className="grid gap-3 sm:grid-cols-2"><label>Profissão<select className={campo} value={profissao} onChange={e=>{selecao(e.target.value);selecionar(modelos.find(x=>x.profissao===e.target.value)?.id??"");}}>
  {Array.from(new Set(modelos.map(m=>m.profissao))).map(p=><option key={p}>{p}</option>)}<option>Corretagem</option></select></label>
  {profissao!=="Corretagem"&&<label>Módulo<select className={campo} value={id} onChange={e=>selecionar(e.target.value)}>{atuais.map(m=><option key={m.id} value={m.id}>{m.nome}</option>)}</select></label>}</div>}
  {profissao==="Corretagem"&&<div className="flex flex-wrap gap-3"><Link href="/conta/perfis" className={botao}>Selecionar meu perfil de corretor ou imobiliária</Link><Link href="/planos?perfil=corretor" className="underline">Ver planos do corretor</Link></div>}
  {m&&profissao!=="Corretagem"&&<div key={(r?.id??id)+":"+(r?.versao??0)} className="space-y-4">
   {r&&<p>{m.profissao} · {m.nome}</p>}<label className="block">Título do registro<input className={campo} name="titulo" maxLength={180} defaultValue={r?.titulo} required/></label>
   <label className="block">Situação<select className={campo} name="etapa" defaultValue={r?.etapa??"aberto"}>{Object.entries(etapasTecnicas).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   {m.campos.map(c=><label key={c.id} className="block">{c.nome}{c.obrigatorio?" *":""}
      {c.tipo==="texto"?<textarea className={campo} name={c.id} maxLength={2000} required={c.obrigatorio} defaultValue={r?.campos[c.id]??""} rows={2}/>:
        <input className={campo} type={c.tipo==="data"?"date":"number"} step={c.tipo==="numero"?"any":undefined} name={c.id} required={c.obrigatorio} defaultValue={r?.campos[c.id]??""}/>}</label>)}
   {!!m.documentos.length&&<label className="block">Documento operacional<select name="documento" className={campo} defaultValue={r?.documento??""}><option value="">Somente registro</option>{m.documentos.map(d=><option key={d}>{d}</option>)}</select></label>}
   <button className={botao} disabled={salvando}>{salvando?"Salvando…":"Salvar registro"}</button>
   {r?.documento&&<Link className="ml-3 underline" href={"/painel/crm/profissoes/documento/"+r.id}>Abrir documento para revisão e impressão</Link>}
  </div>}{aviso&&<p role="status">{aviso}</p>}</form>;
}
export function NovaProfissao({sugerida}:{sugerida?:string}){
 const router=useRouter(),chave=useRef<string|null>(null);const [aviso,set]=useState(""),[ocupado,ocupar]=useState(false);
 async function enviar(e:FormEvent<HTMLFormElement>){e.preventDefault();ocupar(true);const f=e.currentTarget,fd=new FormData(f);chave.current??=crypto.randomUUID();
  try{const r=await pedirProfissao(chave.current,String(fd.get("nome")),String(fd.get("descricao")));set(r.erro??"Pedido registrado.");if(!r.erro){f.reset();chave.current=null;router.refresh();}}catch{set("Falha de conexão.");}finally{ocupar(false);}}
 return <details open={sugerida ? true : undefined} className="cartao space-y-3 p-5"><summary className="cursor-pointer font-semibold">Solicitar outra profissão</summary>
 <form className="max-w-2xl space-y-3" onSubmit={enviar}><label className="block">Profissão<input name="nome" defaultValue={sugerida} className={campo} minLength={3} maxLength={100} required/></label>
 <label className="block">Módulos e documentos que precisa usar<textarea name="descricao" className={campo} minLength={8} maxLength={2000} required/></label>
 <button className={botao} disabled={ocupado}>Enviar pedido</button>{aviso&&<p role="status">{aviso}</p>}</form></details>;
}
export function Imprimir(){return <button type="button" className={botao+" print:hidden"} onClick={()=>window.print()}>Imprimir ou salvar em PDF</button>;}
