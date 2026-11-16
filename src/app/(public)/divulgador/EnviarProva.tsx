"use client";

import { useState } from "react";
import { comprimirFoto } from "@/lib/midia/comprimirFoto";
import { entregar } from "./acoes";

export default function EnviarProva({reserva,etapa,campo,botao}:{reserva:string;etapa:number;campo:string;botao:string}) {
  const [aviso,setAviso]=useState("");
  return <form className="space-y-2" action={async form=>{
    const original=form.get("captura");
    if(!(original instanceof File))return;
    const imagem=await comprimirFoto(original);
    if(imagem.size>800*1024){setAviso("A captura ficou acima de 800 KB. Recorte a área da publicação e envie novamente.");return;}
    form.set("captura",imagem);
    await entregar(form);
  }}>
    <input type="hidden" name="reserva" value={reserva}/><input type="hidden" name="etapa" value={etapa}/>
    <label className="block">Link da publicação<input className={campo} name="link" type="url" required maxLength={1800}/></label>
    <label className="block">Captura da publicação<input className={campo} type="file" name="captura" accept="image/png,image/jpeg,image/webp" required/></label>
    {aviso&&<p role="alert">{aviso}</p>}<button className={botao}>Enviar comprovação</button>
  </form>;
}
