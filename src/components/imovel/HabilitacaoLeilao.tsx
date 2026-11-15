"use client";

import { useState } from "react";
import { enviarJson } from "@/lib/api/enviar";

export default function HabilitacaoLeilao({imovel,estado}:{imovel:string;estado:string|null}){
  const [situacao,setSituacao]=useState(estado);
  const [ocupado,setOcupado]=useState(false);const [erro,setErro]=useState("");
  if(situacao)return <p role="status">Sua habilitação neste leilão · {situacao}</p>;
  return <form className="grid gap-2 border-t border-linha pt-4" onSubmit={async e=>{
    e.preventDefault();setOcupado(true);setErro("");
    const contato = new FormData(e.currentTarget).get("contato");
    const r=await enviarJson("/api/leiloes","POST",{acao:"solicitar",imovel,revisao:0,dados:{aceite:true,contato}});
    setOcupado(false);if(r.ok)setSituacao("solicitada");else setErro(r.erro.mensagem);
  }}><label>E-mail de contato para este leilão<input className="input block" type="email" name="contato" required maxLength={200} /></label>
    <label className="flex items-start gap-2"><input type="checkbox" required className="mt-1"/> Autorizo compartilhar meu nome e o e-mail informado com o leiloeiro deste imóvel para solicitar a habilitação conforme o edital.</label>
    <button disabled={ocupado} className="btn-contorno">Solicitar habilitação</button>{erro&&<p role="alert">{erro}</p>}
  </form>;
}
