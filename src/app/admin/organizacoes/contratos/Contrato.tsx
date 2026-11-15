"use client";
import { useActionState } from "react";
import { salvarContrato } from "./acoes";

export type ContratoAtual = { territorio:string; referencia:string; revisao:number; ativo:boolean };
export default function Contrato({ org, nome, modulo, atual }: { org:string; nome:string; modulo:"balcao"|"safras"; atual?:ContratoAtual }) {
  const [aviso, acao, enviando] = useActionState(salvarContrato, "");
  return <form action={acao} className="cartao grid max-w-3xl gap-4 p-5">
    <div><h2 className="font-bold">{nome}</h2><p className="text-sm text-texto-2">{modulo==="balcao"?"Balcão digital":"Gestão de fornecedores e safras"}</p></div>
    <input type="hidden" name="org" value={org}/><input type="hidden" name="modulo" value={modulo}/>
    <input type="hidden" name="revisao" value={atual?.revisao ?? 0}/>
    <label>Município ou território contratado<input className="input w-full" name="territorio" maxLength={200} required defaultValue={atual?.territorio}/></label>
    <label>Referência do contrato<input className="input w-full" name="referencia" maxLength={200} required defaultValue={atual?.referencia}/></label>
    <label><input type="checkbox" name="ativo" defaultChecked={atual?.ativo}/> Módulo contratado e ativo</label>
    <div><button disabled={enviando} className="rounded-full bg-verde px-5 py-2 font-bold text-white">Salvar contrato</button></div>
    {aviso && <p role="status">{aviso}</p>}
  </form>;
}
